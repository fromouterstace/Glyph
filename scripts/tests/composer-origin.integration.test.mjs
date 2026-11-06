import { beforeAll, afterAll, expect, test } from 'vitest';
import { serviceHarness, edge } from './helpers/service-harness.mjs';
let h;
beforeAll(async () => {
  h = await serviceHarness();
});
afterAll(async () => {
  await h?.close();
});
const input = {
  recipientEmail: 'recipient@example.invalid',
  recipientName: '',
  subject: 'Origin fixture',
  body: 'Retain this draft',
  trackOpens: true,
  trackClicks: true,
};
test('Preview permits draft saving but blocks send before claiming or submitting to Gmail', async () => {
  const user = h.identity();
  const headers = {
    origin: 'https://preview.replit.dev',
    'x-forwarded-host': 'preview.replit.dev',
  };
  const created = await h.request('/messages', {
    user,
    method: 'POST',
    body: input,
    headers,
  });
  expect(created.status).toBe(201);
  const message = await created.json();
  const send = await h.request(`/messages/${message.id}/send`, {
    user,
    method: 'POST',
    headers,
  });
  expect(send.status).toBe(409);
  const error = (await send.json()).error;
  expect(error).toContain('published Glyph web app');
  expect(error).not.toContain('reconnect');
  const detail = await (
    await h.request(`/messages/${message.id}`, { user })
  ).json();
  expect(detail.message.status).toBe('draft');
  expect(detail.message.body).toBe(input.body);
  expect(
    edge.proxy.mock.calls.some(([, path]) => path.endsWith('/messages/send')),
  ).toBe(false);
});
test('a stale production tracking override fails safely with settings-specific recovery', async () => {
  const user = h.identity();
  const message = await (
    await h.request('/messages', { user, method: 'POST', body: input })
  ).json();
  await h.request('/settings', { user });
  await h.sql(
    'INSERT INTO glyph_settings(tracking_base_url,owner_id) VALUES($1,$2) ON CONFLICT(owner_id) DO UPDATE SET tracking_base_url=excluded.tracking_base_url',
    ['https://other.example', user],
  );
  const send = await h.request(`/messages/${message.id}/send`, {
    user,
    method: 'POST',
  });
  expect(send.status).toBe(409);
  expect((await send.json()).error).toContain('Clear the custom Tracking URL');
  expect(
    edge.proxy.mock.calls.some(([, path]) => path.endsWith('/messages/send')),
  ).toBe(false);
  const settings = await (await h.request('/settings', { user })).json();
  const reset = await h.request('/settings', {
    user,
    method: 'PATCH',
    body: { ...settings, trackingBaseUrl: '' },
  });
  expect(reset.status).toBe(200);
  expect((await reset.json()).trackingBaseUrl).toBe('');
  const detail = await (
    await h.request(`/messages/${message.id}`, { user })
  ).json();
  expect(detail.message.status).toBe('draft');
});
