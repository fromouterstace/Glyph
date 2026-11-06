import { beforeAll, afterAll, expect, test } from 'vitest';
import {
  serviceHarness,
  edge,
  defaultProvider,
  json,
} from './helpers/service-harness.mjs';

let h;
beforeAll(async () => {
  h = await serviceHarness();
});
afterAll(async () => {
  await h?.close();
});
const input = {
  recipientEmail: 'first@example.invalid',
  recipientName: '',
  subject: 'Recipient fixture',
  body: 'Shared message',
  trackOpens: true,
  trackClicks: true,
  toEmails: ['first@example.invalid', 'second@example.invalid'],
  ccEmails: ['copy@example.invalid'],
  bccEmails: ['hidden@example.invalid'],
};
test('To, Cc and Bcc round-trip privately, can be cleared, and cannot be read by another owner', async () => {
  const user = h.identity();
  const created = await h.request('/messages', {
    user,
    method: 'POST',
    body: input,
  });
  expect(created.status).toBe(201);
  const message = await created.json();
  expect(message.toEmails).toEqual(input.toEmails);
  expect(message.ccEmails).toEqual(input.ccEmails);
  expect(message.bccEmails).toEqual(input.bccEmails);
  expect(message.recipientName).toBe('Shared message (4 recipients)');
  const reopened = await (
    await h.request(`/messages/${message.id}`, { user })
  ).json();
  expect(reopened.message.bccEmails).toEqual(input.bccEmails);
  const foreign = await h.request(`/messages/${message.id}`, {
    user: h.identity(),
  });
  expect(foreign.status).toBe(404);
  expect(await foreign.text()).not.toContain('hidden@example.invalid');
  const edited = await h.request(`/messages/${message.id}`, {
    user,
    method: 'PATCH',
    body: { ...input, ccEmails: [], bccEmails: [] },
  });
  expect((await edited.json()).bccEmails).toEqual([]);
});
test('invalid addresses, header injection, cross-role duplicates and empty groups fail before saving', async () => {
  const user = h.identity();
  for (const change of [
    { ccEmails: ['invalid'] },
    { bccEmails: ['hidden@example.invalid\r\nInjected: bad'] },
    { ccEmails: ['FIRST@example.invalid'] },
    { toEmails: [], ccEmails: [], bccEmails: [] },
    { toEmails: Array.from({ length: 101 }, (_, i) => `${i}@example.invalid`) },
  ]) {
    const response = await h.request('/messages', {
      user,
      method: 'POST',
      body: { ...input, ...change },
    });
    expect(response.status).toBe(400);
  }
});
test('Gmail receives one MIME send for every role, including Bcc-only without exposing it in To', async () => {
  const user = h.identity();
  const submissions = [];
  edge.proxy.mockImplementation((integration, path, options) => {
    if (path.endsWith('/messages/send')) {
      submissions.push(
        Buffer.from(JSON.parse(options.body).raw, 'base64url').toString(),
      );
      return json({ id: `synthetic-group-${submissions.length}` });
    }
    return defaultProvider(integration, path);
  });
  for (const body of [
    input,
    {
      ...input,
      recipientEmail: 'hidden@example.invalid',
      toEmails: [],
      ccEmails: [],
    },
  ]) {
    const message = await (
      await h.request('/messages', { user, method: 'POST', body })
    ).json();
    const sent = await h.request(`/messages/${message.id}/send`, {
      user,
      method: 'POST',
    });
    expect(sent.status).toBe(200);
    expect((await sent.json()).status).toBe('sent');
  }
  expect(submissions).toHaveLength(2);
  expect(submissions[0]).toContain(
    'To: first@example.invalid, second@example.invalid\r\n',
  );
  expect(submissions[0]).toContain('Cc: copy@example.invalid\r\n');
  for (const raw of submissions) {
    expect(raw).toContain('Bcc: hidden@example.invalid\r\n');
    expect(raw).not.toMatch(/\r\n(?:To|Cc): [^\r\n]*hidden/);
  }
  expect(submissions[1]).toContain('To: undisclosed-recipients:;\r\n');
});
