import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest';
import { edge, json, mailbox } from './helpers/service-harness.mjs';

let h;
beforeAll(async () => {
  h = await (await import('./helpers/service-harness.mjs')).serviceHarness();
});
afterAll(async () => {
  await h?.close();
});
beforeEach(() => {
  edge.now += 180_000;
});

function provider({
  ids = ['label-email'],
  nextPageToken,
  labels = [{ id: 'label-glyph', name: 'Glyph' }],
  fail = false,
  messageLabels = ['label-glyph'],
} = {}) {
  edge.proxy.mockImplementation((_integration, path) => {
    if (path.endsWith('/profile')) return json({ emailAddress: mailbox });
    if (path.endsWith('/labels')) return json({ labels });
    if (path.includes('/messages?'))
      return json({ messages: ids.map((id) => ({ id })), nextPageToken });
    if (path.includes('/messages/')) {
      if (fail) return json({ error: 'unavailable' }, 503);
      const id = path.split('/messages/')[1].split('?')[0];
      return json({
        id,
        internalDate: String(edge.now),
        labelIds: messageLabels,
        payload: {
          mimeType: 'text/plain',
          headers: [
            { name: 'From', value: 'Ada Lovelace <ada@example.invalid>' },
            { name: 'To', value: mailbox },
            { name: 'Message-ID', value: `<${id}@example.invalid>` },
            { name: 'Subject', value: 'Imported correspondence' },
          ],
          body: {
            data: Buffer.from('Actual fixture body').toString('base64url'),
          },
        },
      });
    }
    throw new Error('Unexpected Gmail fixture request');
  });
}

test('label import endpoints require sign-in and same-origin writes', async () => {
  for (const path of ['/contacts', '/label-import'])
    expect((await h.request(path)).status).toBe(401);
  expect(
    (
      await h.request('/label-import', {
        user: h.identity(),
        method: 'POST',
        headers: { origin: 'https://attacker.invalid' },
      })
    ).status,
  ).toBe(403);
});

test('repeated imports create one owner message/contact with no tracking or false sent metrics', async () => {
  provider();
  const user = h.identity();
  expect(
    (await h.request('/label-import', { user, method: 'POST' })).status,
  ).toBe(200);
  edge.now += 60_000;
  await h.request('/label-import', { user, method: 'POST' });
  const messages = (
    await h.sql('SELECT * FROM glyph_messages WHERE owner_id=$1', [user])
  ).rows;
  expect(messages).toHaveLength(1);
  expect(messages[0]).toMatchObject({
    delivery_source: 'import',
    track_opens: false,
    track_clicks: false,
    body: 'Actual fixture body',
  });
  expect(
    (
      await h.sql('SELECT * FROM glyph_events WHERE message_id=$1', [
        messages[0].id,
      ])
    ).rows,
  ).toHaveLength(0);
  const contacts = await (await h.request('/contacts', { user })).json();
  expect(contacts.total).toBe(1);
  expect(contacts.contacts[0]).toMatchObject({
    firstName: 'Ada',
    lastName: 'Lovelace',
    email: 'ada@example.invalid',
    emailSuffix: 'example.invalid',
  });
  expect(contacts.contacts[0]).not.toHaveProperty('ownerId');
  const overview = await (await h.request('/overview', { user })).json();
  expect(overview.totalSent).toBe(0);
});

test('the same provider message and contact stay isolated across owners and searches', async () => {
  provider();
  const a = h.identity();
  const b = h.identity();
  await h.request('/label-import', { user: a, method: 'POST' });
  expect((await (await h.request('/contacts', { user: b })).json()).total).toBe(
    0,
  );
  await h.request('/label-import', { user: b, method: 'POST' });
  expect(
    (
      await h.sql(
        'SELECT owner_id FROM glyph_contacts WHERE owner_id=$1 OR owner_id=$2',
        [a, b],
      )
    ).rows,
  ).toHaveLength(2);
  expect(
    (await (await h.request('/contacts?search=Ada', { user: a })).json()).total,
  ).toBe(1);
  expect(
    (await (await h.request('/contacts?search=%25', { user: a })).json()).total,
  ).toBe(0);
  expect((await h.request('/contacts?offset=-1', { user: a })).status).toBe(
    400,
  );
});

test('missing labels do not erase history and labeled drafts are not represented as delivered', async () => {
  provider({ labels: [] });
  const user = h.identity();
  expect(
    (await (await h.request('/label-import', { user, method: 'POST' })).json())
      .status,
  ).toBe('label_missing');
  provider({ messageLabels: ['label-glyph', 'DRAFT'] });
  await h.request('/label-import', { user, method: 'POST' });
  expect(
    (await h.sql('SELECT id FROM glyph_messages WHERE owner_id=$1', [user]))
      .rows,
  ).toHaveLength(0);
});

test('partial pages resume durably and provider failures preserve the cursor and stored records', async () => {
  provider({ nextPageToken: 'second-page' });
  const user = h.identity();
  expect(
    (await (await h.request('/label-import', { user, method: 'POST' })).json())
      .status,
  ).toBe('syncing');
  edge.now += 60_000;
  provider({ ids: ['later-email'], fail: true });
  expect(
    (await h.request('/label-import', { user, method: 'POST' })).status,
  ).toBe(502);
  const state = (
    await h.sql(
      'SELECT page_token, status FROM glyph_label_imports WHERE owner_id=$1',
      [user],
    )
  ).rows[0];
  expect(state).toEqual({ page_token: 'second-page', status: 'error' });
  expect(
    edge.proxy.mock.calls.some(([, path]) =>
      path.includes('pageToken=second-page'),
    ),
  ).toBe(true);
  expect(
    (await h.sql('SELECT id FROM glyph_messages WHERE owner_id=$1', [user]))
      .rows,
  ).toHaveLength(1);
});

test('contacts enrich names without duplicating already tracked messages', async () => {
  provider();
  const user = h.identity();
  await h.request('/label-import', { user, method: 'POST' });
  await h.sql(
    "UPDATE glyph_messages SET delivery_source='gmail' WHERE owner_id=$1",
    [user],
  );
  await h.sql(
    "UPDATE glyph_contacts SET first_name='', last_name='' WHERE owner_id=$1",
    [user],
  );
  edge.now += 60_000;
  await h.request('/label-import', { user, method: 'POST' });
  const rows = (
    await h.sql(
      'SELECT delivery_source FROM glyph_messages WHERE owner_id=$1',
      [user],
    )
  ).rows;
  expect(rows).toEqual([{ delivery_source: 'gmail' }]);
  expect(
    (await (await h.request('/contacts', { user })).json()).contacts[0]
      .firstName,
  ).toBe('Ada');
});
