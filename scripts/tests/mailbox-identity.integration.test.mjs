import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest';
import {
  defaultProvider,
  edge,
  gmailConnections,
  json,
} from './helpers/service-harness.mjs';
import { messageFixture } from '../lib/database-fixture.mjs';

let h;

beforeAll(async () => {
  h = await (await import('./helpers/service-harness.mjs')).serviceHarness();
});

beforeEach(() => {
  edge.now += 180_000;
  edge.connections.mockResolvedValue(gmailConnections('stable-connection'));
  edge.getUser.mockImplementation(async () => ({
    emailAddresses: [
      {
        emailAddress: 'account-a@example.invalid',
        verification: { status: 'verified' },
      },
    ],
  }));
  edge.proxy.mockImplementation(defaultProvider);
});

afterAll(async () => {
  await h?.close();
});

test('Sent candidate cache is isolated by mailbox even when connection ID stays the same', async () => {
  const ownerA = 'sent-owner-a';
  const ownerB = 'sent-owner-b';
  const emailA = 'account-a@example.invalid';
  const emailB = 'account-b@example.invalid';
  let activeEmail = emailA;
  const messageA = await messageFixture(h.sql, {
    ownerId: ownerA,
    source: 'gmail',
    status: 'draft',
  });
  const messageB = await messageFixture(h.sql, {
    ownerId: ownerB,
    source: 'gmail',
    status: 'draft',
  });
  const createdA = (
    await h.sql('SELECT created_at FROM glyph_messages WHERE id=$1', [
      messageA.id,
    ])
  ).rows[0].created_at;
  const createdB = (
    await h.sql('SELECT created_at FROM glyph_messages WHERE id=$1', [
      messageB.id,
    ])
  ).rows[0].created_at;
  edge.getUser.mockImplementation(async (userId) => ({
    emailAddresses: [
      {
        emailAddress: userId === ownerA ? emailA : emailB,
        verification: { status: 'verified' },
      },
    ],
  }));
  edge.proxy.mockImplementation((_integration, path) => {
    if (path.endsWith('/profile')) return json({ emailAddress: activeEmail });
    if (path.includes('/messages?'))
      return json({ messages: [{ id: 'shared-sent-id' }] });
    if (path.includes('/messages/shared-sent-id?format=full')) {
      const selected = activeEmail === emailA ? messageA : messageB;
      const createdAt = activeEmail === emailA ? createdA : createdB;
      return json({
        id: 'shared-sent-id',
        internalDate: String(createdAt.getTime() + 1000),
        payload: {
          mimeType: 'text/html',
          body: {
            data: Buffer.from(
              `<img src="https://glyph.example/gmail?glyph=${selected.token}">`,
            ).toString('base64url'),
          },
          headers: [
            { name: 'From', value: activeEmail },
            { name: 'To', value: 'recipient@example.invalid' },
          ],
        },
      });
    }
    return defaultProvider(_integration, path);
  });

  const { syncNative } =
    await import('../../artifacts/api-server/src/lib/gmail-native.ts');
  expect((await syncNative(ownerA)).confirmed).toBe(1);
  activeEmail = emailB;
  expect((await syncNative(ownerB)).confirmed).toBe(1);
  expect(
    edge.proxy.mock.calls.filter(([, path]) =>
      path.includes('/messages/shared-sent-id?format=full'),
    ),
  ).toHaveLength(2);
  const statuses = await h.sql(
    'SELECT id, status FROM glyph_messages WHERE id=$1 OR id=$2 ORDER BY id',
    [messageA.id, messageB.id],
  );
  expect(statuses.rows.map(({ status }) => status)).toEqual(['sent', 'sent']);
});

test('reply metadata cache and reply events do not cross mailbox identities', async () => {
  const ownerA = 'reply-owner-a';
  const ownerB = 'reply-owner-b';
  const emailA = 'account-a@example.invalid';
  const emailB = 'account-b@example.invalid';
  const originalA = '<original-a@mail.example>';
  const originalB = '<original-b@mail.example>';
  let activeEmail = emailA;
  const messageA = await messageFixture(h.sql, {
    ownerId: ownerA,
    source: 'gmail',
    status: 'sent',
  });
  const messageB = await messageFixture(h.sql, {
    ownerId: ownerB,
    source: 'gmail',
    status: 'sent',
  });
  for (const [message, original] of [
    [messageA, originalA],
    [messageB, originalB],
  ])
    await h.sql(
      'UPDATE glyph_messages SET sent_at=created_at, rfc_message_id=$2 WHERE id=$1',
      [message.id, original],
    );
  const sentAt = (
    await h.sql('SELECT sent_at FROM glyph_messages WHERE id=$1', [messageA.id])
  ).rows[0].sent_at;
  edge.getUser.mockImplementation(async (userId) => ({
    emailAddresses: [
      {
        emailAddress: userId === ownerA ? emailA : emailB,
        verification: { status: 'verified' },
      },
    ],
  }));
  edge.proxy.mockImplementation((_integration, path) => {
    if (path.endsWith('/profile')) return json({ emailAddress: activeEmail });
    if (path.includes('/messages?'))
      return json({ messages: [{ id: 'shared-reply-id' }] });
    if (path.includes('/messages/shared-reply-id?'))
      return json({
        id: 'shared-reply-id',
        internalDate: String(sentAt.getTime() + 1000),
        labelIds: ['INBOX'],
        payload: {
          headers: [
            { name: 'From', value: 'recipient@example.invalid' },
            { name: 'To', value: activeEmail },
            { name: 'Message-ID', value: '<shared-reply@mail.example>' },
            {
              name: 'In-Reply-To',
              value: activeEmail === emailA ? originalA : originalB,
            },
          ],
        },
      });
    return defaultProvider(_integration, path);
  });

  const { syncReplies } =
    await import('../../artifacts/api-server/src/lib/gmail-replies.ts');
  expect((await syncReplies(ownerA)).repliesDetected).toBe(1);
  activeEmail = emailB;
  expect((await syncReplies(ownerB)).repliesDetected).toBe(1);
  expect(
    edge.proxy.mock.calls.filter(([, path]) =>
      path.includes('/messages/shared-reply-id?'),
    ),
  ).toHaveLength(2);
  for (const message of [messageA, messageB]) {
    const result = await h.sql(
      'SELECT COUNT(*)::int AS count FROM glyph_events WHERE message_id=$1 AND type=$2',
      [message.id, 'reply'],
    );
    expect(result.rows[0].count).toBe(1);
  }
});
