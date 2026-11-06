import { afterAll, beforeAll, expect, test } from 'vitest';
import {
  serviceHarness,
  edge,
  defaultProvider,
} from './helpers/service-harness.mjs';
import { messageFixture, fixtureId } from '../lib/database-fixture.mjs';

const previousAdminEmails = process.env.GLYPH_ADMIN_EMAILS;
process.env.GLYPH_ADMIN_EMAILS = 'admin@example.invalid';

let h;
beforeAll(async () => {
  h = await serviceHarness();
  edge.getCount.mockResolvedValue(7);
  edge.proxy.mockImplementation(defaultProvider);
});
afterAll(async () => {
  await h?.close();
  if (previousAdminEmails === undefined) delete process.env.GLYPH_ADMIN_EMAILS;
  else process.env.GLYPH_ADMIN_EMAILS = previousAdminEmails;
});

async function addEvent(message, type) {
  await h.sql(
    `INSERT INTO glyph_events(id,message_id,type,source,fingerprint)
     VALUES ($1,$2,$3,'system-test',$4)`,
    [fixtureId(), message.id, type, fixtureId()],
  );
}

test('system access requires sign-in and only exposes metrics to the verified configured admin', async () => {
  const anonymous = await h.request('/system/access');
  expect(anonymous.status).toBe(401);

  const regular = await h.request('/system/access', { user: 'regular_user' });
  expect(regular.status).toBe(200);
  expect(await regular.json()).toEqual({ isSystemAdmin: false });

  const admin = await h.request('/system/access', { user: 'system_admin' });
  expect(admin.status).toBe(200);
  expect(await admin.json()).toEqual({ isSystemAdmin: true });

  const denied = await h.request('/system/summary', {
    user: 'regular_user',
    session: 'not-admin-session',
  });
  expect(denied.status).toBe(403);
  expect(await denied.json()).toEqual({
    error: 'System access is restricted.',
  });
});

test('system metrics are aggregate-only and session observations are idempotent', async () => {
  const message = await messageFixture(h.sql, { ownerId: 'another_owner' });
  await h.sql('UPDATE glyph_messages SET sent_at=now() WHERE id=$1', [
    message.id,
  ]);
  await addEvent(message, 'open');
  await addEvent(message, 'click');
  await addEvent(message, 'reply');

  for (const [user, session] of [
    ['regular_user', 'observed-session'],
    ['regular_user', 'observed-session'],
    ['system_admin', 'admin-session'],
  ]) {
    const response = await h.request('/system/session', {
      user,
      session,
      method: 'POST',
    });
    expect(response.status).toBe(200);
  }

  await h.request('/system/summary', {
    user: 'regular_user',
    session: 'not-admin-session',
  });
  await h.request('/system/summary', {
    user: 'regular_user',
    session: 'not-admin-session',
  });

  const response = await h.request('/system/summary', {
    user: 'system_admin',
  });
  const body = await response.text();
  expect(response.status, body).toBe(200);
  const summary = JSON.parse(body);
  expect(summary.usersTotal).toBe(7);
  expect(summary.loginSessionsTotal).toBe(2);
  expect(summary.emailsSentTotal).toBeGreaterThan(0);
  expect(summary.emailsSentLast30Days).toBeGreaterThan(0);
  expect(summary.pixelLoadsTotal).toBeGreaterThan(0);
  expect(summary.linkClicksTotal).toBeGreaterThan(0);
  expect(summary.repliesTotal).toBeGreaterThan(0);
  expect(summary.adminAccessDeniedSessions).toBe(1);
  expect(JSON.stringify(summary)).not.toContain('recipient@example.invalid');
  expect(JSON.stringify(summary)).not.toContain('another_owner');
});

test('session observation rejects cross-origin writes and anonymous requests', async () => {
  const anonymous = await h.request('/system/session', {
    method: 'POST',
    user: null,
  });
  expect(anonymous.status).toBe(401);

  const crossOrigin = await h.request('/system/session', {
    method: 'POST',
    user: 'regular_user',
    headers: { origin: 'https://attacker.example' },
  });
  expect(crossOrigin.status).toBe(403);
});
