import { beforeEach, afterEach, expect, test, vi } from 'vitest';
import {
  edge,
  gmailConnections,
  json,
  mailbox,
} from './helpers/service-harness.mjs';

let gmail;
beforeEach(async () => {
  vi.resetModules();
  edge.proxy.mockReset();
  edge.connections.mockReset();
  edge.connections.mockResolvedValue(gmailConnections());
  edge.getUser.mockReset();
  edge.now = Date.UTC(2026, 10, 4, 12);
  vi.spyOn(Date, 'now').mockImplementation(() => edge.now);
  gmail = await import('../../artifacts/api-server/src/lib/gmail.ts');
});
afterEach(() => vi.restoreAllMocks());

test('GET preserves the connector response and the exact Gmail request contract', async () => {
  const response = json({ messages: [] });
  edge.proxy.mockResolvedValue(response);
  expect(await gmail.gmailRequest('/messages?maxResults=1')).toBe(response);
  expect(edge.proxy).toHaveBeenCalledWith(
    'google-mail',
    '/gmail/v1/users/me/messages?maxResults=1',
    {},
  );
});

test('the actual adapter honors Retry-After and blocks queued upstream reads', async () => {
  edge.proxy
    .mockResolvedValueOnce(json({}, 429, { 'Retry-After': '120' }))
    .mockResolvedValue(json({}));
  const results = await Promise.allSettled([
    gmail.gmailRequest('/messages'),
    gmail.gmailRequest('/profile'),
  ]);
  expect(results.every((r) => r.status === 'rejected')).toBe(true);
  edge.now += 119_999;
  await expect(gmail.gmailRequest('/profile')).rejects.toThrow(
    'temporarily rate-limited',
  );
  edge.now++;
  expect((await gmail.gmailRequest('/profile')).status).toBe(200);
  expect(edge.proxy).toHaveBeenCalledTimes(2);
});

test('a rate-limited send is returned unchanged and never automatically retried', async () => {
  edge.proxy.mockResolvedValue(json({}, 429));
  expect(
    (await gmail.gmailRequest('/messages/send', { method: 'POST', body: '{}' }))
      .status,
  ).toBe(429);
  expect(edge.proxy).toHaveBeenCalledTimes(1);
});

test('a send transport failure is surfaced without repeating the send', async () => {
  edge.proxy.mockRejectedValue(new Error('Transport offline'));
  await expect(
    gmail.gmailRequest('/messages/send', { method: 'POST' }),
  ).rejects.toThrow('Transport offline');
  expect(edge.proxy).toHaveBeenCalledTimes(1);
});

test('permission failures are not converted into cooldowns or hidden success', async () => {
  edge.proxy.mockResolvedValueOnce(json({}, 403)).mockResolvedValue(json({}));
  expect((await gmail.gmailRequest('/messages')).status).toBe(403);
  expect((await gmail.gmailRequest('/messages')).status).toBe(200);
});

test('an invalid mailbox profile fails explicitly and is not cached', async () => {
  edge.proxy
    .mockResolvedValueOnce(json({}))
    .mockResolvedValue(json({ emailAddress: 'sender@example.invalid' }));
  await expect(gmail.mailboxEmail()).rejects.toThrow(
    'did not return an account email',
  );
  expect(await gmail.mailboxEmail()).toBe('sender@example.invalid');
  await gmail.mailboxEmail();
  expect(edge.proxy).toHaveBeenCalledTimes(2);
});

test('a failed provider profile is not treated as a connected mailbox', async () => {
  edge.proxy.mockResolvedValue(json({}, 503));
  await expect(gmail.mailboxEmail()).rejects.toThrow(
    'connection unavailable (503)',
  );
  expect(edge.proxy).toHaveBeenCalledTimes(1);
});

test('mailbox authorization refreshes identity and separates account caches', async () => {
  const active = {
    connectionId: 'gmail-connection-a',
    email: 'account-a@example.invalid',
  };
  const accounts = new Map([
    ['owner-a', 'account-a@example.invalid'],
    ['owner-b', 'account-b@example.invalid'],
  ]);
  edge.connections.mockImplementation(async () =>
    gmailConnections(active.connectionId),
  );
  edge.proxy.mockImplementation((_integration, path) =>
    path.endsWith('/profile') ? json({ emailAddress: active.email }) : json({}),
  );
  edge.getUser.mockImplementation(async (userId) => ({
    emailAddresses: [
      {
        emailAddress: accounts.get(userId),
        verification: { status: 'verified' },
      },
    ],
  }));

  expect(await gmail.ownsMailbox('owner-a')).toBe(true);
  active.email = 'account-b@example.invalid';
  expect(await gmail.ownsMailbox('owner-a')).toBe(false);
  expect(await gmail.ownsMailbox('owner-b')).toBe(true);
  expect(
    edge.connections.mock.calls.every(
      ([options]) =>
        options.connector_names === 'google-mail' &&
        options.refresh_policy === 'force',
    ),
  ).toBe(true);
});

test('unknown connector identity fails closed and clears cached ownership', async () => {
  edge.proxy.mockImplementation(async () => json({ emailAddress: mailbox }));
  edge.getUser.mockResolvedValue({
    emailAddresses: [
      { emailAddress: mailbox, verification: { status: 'verified' } },
    ],
  });
  expect(await gmail.ownsMailbox('owner-a')).toBe(true);
  edge.connections.mockRejectedValue(new Error('connection API unavailable'));
  expect(await gmail.safeMailboxOwnership('owner-a')).toBe(false);
  edge.connections.mockResolvedValue(gmailConnections());
  await gmail.ownsMailbox('owner-a');
  expect(edge.proxy).toHaveBeenCalledTimes(2);
});
