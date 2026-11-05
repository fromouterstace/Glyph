import { beforeAll, afterAll, expect, test } from 'vitest';
import {
  serviceHarness,
  edge,
  defaultProvider,
  mailbox,
} from './helpers/service-harness.mjs';
import { messageFixture, fixtureId } from '../lib/database-fixture.mjs';

let h;
beforeAll(async () => {
  h = await serviceHarness();
});
afterAll(async () => {
  await h?.close();
});

async function twoOwners() {
  edge.proxy.mockImplementation(defaultProvider);
  const owner = h.identity(),
    other = h.identity();
  const own = await messageFixture(h.sql, { ownerId: owner });
  const foreign = await messageFixture(h.sql, { ownerId: other });
  await h.sql(
    "INSERT INTO glyph_events(id,message_id,type,source,fingerprint) VALUES ($1,$2,'open','fixture',$3)",
    [fixtureId(), foreign.id, fixtureId()],
  );
  await h.sql(
    'INSERT INTO glyph_links(id,message_id,token,url) VALUES ($1,$2,$3,$4)',
    [
      fixtureId(),
      foreign.id,
      fixtureId().replaceAll('-', '').padStart(48, '0'),
      'https://example.invalid/private',
    ],
  );
  return { owner, other, own, foreign };
}

test('anonymous account reads require authentication before returning user data', async () => {
  const f = await twoOwners();
  for (const path of [
    '/overview',
    '/messages',
    `/messages/${f.own.id}`,
    '/activity',
    '/settings',
    '/connection',
  ]) {
    const response = await h.request(path);
    expect(response.status, `${path} must require sign-in`).toBe(401);
  }
});

test('a signed-in owner lists only their own messages', async () => {
  const f = await twoOwners();
  const rows = await (await h.request('/messages', { user: f.owner })).json();
  expect(rows.map((row) => row.id)).toEqual([f.own.id]);
});

test('a foreign message detail cannot expose its body, links or events', async () => {
  const f = await twoOwners();
  const response = await h.request(`/messages/${f.foreign.id}`, {
    user: f.owner,
  });
  expect(response.status).toBe(404);
  expect(await response.json()).toEqual({ error: 'Email not found' });
});

test('the rightful owner can retrieve their message with its links and events', async () => {
  const f = await twoOwners();
  const response = await h.request(`/messages/${f.foreign.id}`, {
    user: f.other,
  });
  const detail = await response.json();
  expect(response.status).toBe(200);
  expect(detail.message.id).toBe(f.foreign.id);
  expect([detail.links.length, detail.events.length]).toEqual([1, 1]);
});

test('overview counts only the authenticated owner’s engagement', async () => {
  const f = await twoOwners();
  const overview = await (
    await h.request('/overview', { user: f.owner })
  ).json();
  expect(overview.totalSent).toBe(1);
  expect(overview.totalOpens).toBe(0);
});

for (const method of ['PATCH', 'DELETE', 'POST']) {
  test(`${method} cannot change or send another owner's message`, async () => {
    const f = await twoOwners();
    const path = `/messages/${f.foreign.id}${method === 'POST' ? '/send' : ''}`;
    const response = await h.request(path, {
      user: f.owner,
      method,
      body:
        method === 'PATCH'
          ? {
              recipientEmail: 'intruder@example.invalid',
              recipientName: 'Intrusion',
              subject: 'Intrusion',
              body: 'Intrusion',
              trackOpens: true,
              trackClicks: true,
            }
          : undefined,
    });
    expect(response.status).toBe(method === 'DELETE' ? 409 : 404);
    const row = (
      await h.sql('SELECT subject,status FROM glyph_messages WHERE id=$1', [
        f.foreign.id,
      ])
    ).rows[0];
    expect(row).toEqual({ subject: 'Fixture subject', status: 'sent' });
    expect(
      edge.proxy.mock.calls.some(([, path]) => path.endsWith('/messages/send')),
    ).toBe(false);
  });
}

test('activity does not expose another owner’s signals', async () => {
  const f = await twoOwners();
  const activity = await (
    await h.request('/activity', { user: f.owner })
  ).json();
  expect(activity).toEqual([]);
});

test('marking activity read cannot update another owner’s event', async () => {
  const f = await twoOwners();
  await h.sql(
    "INSERT INTO glyph_events(id,message_id,type,source,fingerprint) VALUES ($1,$2,'open','fixture',$3)",
    [fixtureId(), f.own.id, fixtureId()],
  );
  const response = await h.request('/activity/read', {
    user: f.owner,
    method: 'POST',
    body: {},
  });
  expect(response.status).toBe(200);
  const { rows } = await h.sql(
    'SELECT message_id,read FROM glyph_events WHERE message_id=ANY($1) ORDER BY message_id',
    [[f.own.id, f.foreign.id]],
  );
  expect(rows).toEqual([
    { message_id: f.own.id, read: true },
    { message_id: f.foreign.id, read: false },
  ]);
});

test('settings updates derive the owner from the authenticated identity, not input', async () => {
  const f = await twoOwners();
  await h.sql(
    'INSERT INTO glyph_settings(owner_id,default_track_opens) VALUES ($1,false)',
    [f.other],
  );
  const settings = await (
    await h.request('/settings', { user: f.owner })
  ).json();
  const response = await h.request('/settings', {
    user: f.owner,
    method: 'PATCH',
    body: { ...settings, ownerId: f.other, defaultTrackOpens: true },
  });
  expect(response.status).toBe(200);
  const { rows } = await h.sql(
    'SELECT default_track_opens FROM glyph_settings WHERE owner_id=$1',
    [f.other],
  );
  expect(rows).toEqual([{ default_track_opens: false }]);
  const own = await h.sql(
    'SELECT default_track_opens FROM glyph_settings WHERE owner_id=$1',
    [f.owner],
  );
  expect(own.rows).toEqual([{ default_track_opens: true }]);
});

test('settings reads never substitute another owner’s preferences', async () => {
  const f = await twoOwners();
  await h.sql(
    'INSERT INTO glyph_settings(owner_id,default_track_opens) VALUES ($1,false),($2,true)',
    [f.owner, f.other],
  );
  const settings = await (
    await h.request('/settings', { user: f.owner })
  ).json();
  expect(settings.defaultTrackOpens).toBe(false);
  expect(settings.readOnly).toBe(false);
});

test('native compose identity is scoped to its authenticated owner', async () => {
  const f = await twoOwners();
  const composeKey = 'fixture-cross-owner-compose';
  await h.sql(
    "UPDATE glyph_messages SET status='draft',delivery_source='gmail',native_compose_key=$2 WHERE id=$1",
    [f.foreign.id, composeKey],
  );
  const response = await h.request('/native/prepare', {
    user: f.owner,
    method: 'POST',
    body: {
      composeKey,
      senderEmail: mailbox,
      recipientEmail: 'recipient@example.invalid',
      recipientName: 'Recipient',
      subject: 'Own draft',
      body: 'Own draft',
      urls: [],
      trackOpens: true,
      trackClicks: false,
    },
  });
  const prepared = await response.json();
  expect(response.status).toBe(200);
  expect(prepared.messageId).not.toBe(f.foreign.id);
  const { rows } = await h.sql(
    'SELECT owner_id,subject FROM glyph_messages WHERE id=$1',
    [f.foreign.id],
  );
  expect(rows).toEqual([{ owner_id: f.other, subject: 'Fixture subject' }]);
});
