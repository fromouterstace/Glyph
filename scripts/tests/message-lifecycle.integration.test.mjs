import { beforeAll, afterAll, expect, test } from 'vitest';
import {
  serviceHarness,
  edge,
  json,
  defaultProvider,
} from './helpers/service-harness.mjs';
import { messageFixture, fixtureId } from '../lib/database-fixture.mjs';
import { db, glyphMessages } from '@workspace/db';
import {
  claimDraftForSend,
  confirmSentMessage,
} from '../../artifacts/api-server/src/lib/message-lifecycle.ts';

let h;
beforeAll(async () => {
  h = await serviceHarness();
});
afterAll(async () => {
  await h?.close();
});

async function draftScenario() {
  const message = await messageFixture(h.sql, {
    ownerId: h.identity(),
    status: 'draft',
  });
  const snapshot = (await db.select().from(glyphMessages)).find(
    (row) => row.id === message.id,
  );
  const link = {
    id: fixtureId(),
    messageId: message.id,
    token: fixtureId().replaceAll('-', '').padStart(48, '0'),
    url: 'https://example.invalid/proposal',
  };
  return { snapshot, link };
}

for (const [field, value] of [
  ['body', 'Changed body'],
  ['subject', 'Changed subject'],
  ['recipient_email', 'other@example.invalid'],
  ['recipient_name', 'Other'],
  ['track_opens', false],
  ['track_clicks', false],
  ['to_emails', ['changed@example.invalid']],
  ['cc_emails', ['copy@example.invalid']],
  ['bcc_emails', ['blind@example.invalid']],
  ['body_html', '<p><strong>Concurrent formatting change</strong></p>'],
  [
    'attachments',
    JSON.stringify([
      {
        id: 'changed-file',
        name: 'changed.txt',
        size: 1,
        contentType: 'text/plain',
      },
    ]),
  ],
]) {
  test(`a concurrent ${field} edit cannot send a stale rendered draft`, async () => {
    const f = await draftScenario();
    await h.sql(`UPDATE glyph_messages SET ${field}=$2 WHERE id=$1`, [
      f.snapshot.id,
      value,
    ]);
    expect(await claimDraftForSend(f.snapshot, [f.link])).toBe(false);
    const row = (
      await h.sql('SELECT status FROM glyph_messages WHERE id=$1', [
        f.snapshot.id,
      ])
    ).rows[0];
    expect(row.status).toBe('draft');
    expect(
      (
        await h.sql('SELECT id FROM glyph_links WHERE message_id=$1', [
          f.snapshot.id,
        ])
      ).rows,
    ).toEqual([]);
  });
}

test('concurrent claims allow exactly one send and one set of stored links', async () => {
  const f = await draftScenario();
  const results = await Promise.all([
    claimDraftForSend(f.snapshot, [f.link]),
    claimDraftForSend(f.snapshot, [f.link]),
  ]);
  expect(results.sort()).toEqual([false, true]);
  expect(
    (
      await h.sql('SELECT token FROM glyph_links WHERE message_id=$1', [
        f.snapshot.id,
      ])
    ).rows,
  ).toEqual([{ token: f.link.token }]);
});

test('a draft claim cannot use another owner’s identity', async () => {
  const f = await draftScenario();
  expect(
    await claimDraftForSend({ ...f.snapshot, ownerId: h.identity() }, [f.link]),
  ).toBe(false);
  expect(
    (
      await h.sql('SELECT status FROM glyph_messages WHERE id=$1', [
        f.snapshot.id,
      ])
    ).rows[0].status,
  ).toBe('draft');
});

test('a draft claim rejects links belonging to a different message', async () => {
  const f = await draftScenario();
  await expect(
    claimDraftForSend(f.snapshot, [{ ...f.link, messageId: fixtureId() }]),
  ).rejects.toThrow('must belong to the claimed draft');
  expect(
    (
      await h.sql('SELECT status FROM glyph_messages WHERE id=$1', [
        f.snapshot.id,
      ])
    ).rows[0].status,
  ).toBe('draft');
});

test('Sent confirmation cannot change another owner’s message', async () => {
  const f = await draftScenario();
  const changed = await confirmSentMessage(
    { ...f.snapshot, ownerId: h.identity() },
    {
      gmailId: 'confirmed',
      sentAt: new Date(edge.now),
      source: 'Fixture',
      expectedStatuses: ['draft'],
    },
  );
  expect(changed).toBe(false);
  expect(
    (
      await h.sql('SELECT status FROM glyph_messages WHERE id=$1', [
        f.snapshot.id,
      ])
    ).rows[0].status,
  ).toBe('draft');
  expect(
    (
      await h.sql('SELECT id FROM glyph_events WHERE message_id=$1', [
        f.snapshot.id,
      ])
    ).rows,
  ).toEqual([]);
});

test('Sent confirmation rolls back the status if its activity insert fails', async () => {
  const f = await draftScenario();
  await h.sql(
    `ALTER TABLE glyph_events ADD CONSTRAINT reject_fixture_sent CHECK (message_id <> '${f.snapshot.id}' OR type <> 'sent')`,
  );
  try {
    await expect(
      confirmSentMessage(f.snapshot, {
        gmailId: 'confirmed',
        sentAt: new Date(edge.now),
        source: 'Fixture',
        expectedStatuses: ['draft'],
      }),
    ).rejects.toThrow();
    expect(
      (
        await h.sql('SELECT status FROM glyph_messages WHERE id=$1', [
          f.snapshot.id,
        ])
      ).rows[0].status,
    ).toBe('draft');
  } finally {
    await h.sql('ALTER TABLE glyph_events DROP CONSTRAINT reject_fixture_sent');
  }
});

test('uncertain send reconciliation records Sent once without resending', async () => {
  const owner = h.identity();
  const message = await messageFixture(h.sql, {
    ownerId: owner,
    status: 'uncertain',
  });
  edge.proxy.mockImplementation((integration, path) =>
    path.includes('/messages?')
      ? json({ messages: [{ id: 'provider-confirmed-send' }] })
      : defaultProvider(integration, path),
  );
  const response = await h.request(`/messages/${message.id}/send`, {
    user: owner,
    method: 'POST',
  });
  expect(response.status).toBe(200);
  await h.request(`/messages/${message.id}/send`, {
    user: owner,
    method: 'POST',
  });
  const { rows } = await h.sql(
    'SELECT type,read FROM glyph_events WHERE message_id=$1',
    [message.id],
  );
  expect(rows).toEqual([{ type: 'sent', read: true }]);
  expect(
    edge.proxy.mock.calls.some(([, path]) => path.endsWith('/messages/send')),
  ).toBe(false);
});
