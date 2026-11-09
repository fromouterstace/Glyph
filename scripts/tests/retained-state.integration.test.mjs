import { afterAll, beforeAll, expect, test } from 'vitest';
import { db, glyphLinks, glyphMessages } from '@workspace/db';
import { messageFixture, fixtureId } from '../lib/database-fixture.mjs';
import { serviceHarness } from './helpers/service-harness.mjs';
import { claimDraftForSend } from '../../artifacts/api-server/src/lib/message-lifecycle.ts';

let h;
beforeAll(async () => {
  h = await serviceHarness();
});
afterAll(async () => {
  await h?.close();
});

test('deleting an unsent draft archives it without erasing it or exposing it in active reads', async () => {
  const user = h.identity();
  const created = await h.request('/messages', {
    user,
    method: 'POST',
    body: {
      recipientEmail: 'retained@example.invalid',
      recipientName: '',
      subject: 'Retained draft',
      body: 'Never sent',
      trackOpens: true,
      trackClicks: true,
    },
  });
  expect(created.status).toBe(201);
  const message = await created.json();

  expect(
    (
      await h.request(`/messages/${message.id}`, {
        user,
        method: 'DELETE',
      })
    ).status,
  ).toBe(204);

  const [stored] = (
    await h.sql(
      'SELECT archived_at FROM glyph_messages WHERE id=$1 AND owner_id=$2',
      [message.id, user],
    )
  ).rows;
  expect(stored.archived_at).not.toBeNull();
  expect((await h.request(`/messages/${message.id}`, { user })).status).toBe(
    404,
  );
  const active = await (await h.request('/messages', { user })).json();
  expect(active.items.some((item) => item.id === message.id)).toBe(false);
});

test('replaced tracked links are retired, while unchanged links keep their token', async () => {
  const message = await messageFixture(h.sql, {
    ownerId: h.identity(),
    source: 'web',
    status: 'draft',
  });
  const snapshot = (await db.select().from(glyphMessages)).find(
    (row) => row.id === message.id,
  );
  const makeLink = (url) => ({
    id: fixtureId(),
    messageId: message.id,
    token: fixtureId().replaceAll('-', '').padEnd(48, '0').slice(0, 48),
    url,
  });
  const original = makeLink('https://example.invalid/old');
  const replacement = makeLink('https://example.invalid/new');

  expect(await claimDraftForSend(snapshot, [original])).toBe(true);
  await h.sql("UPDATE glyph_messages SET status='draft' WHERE id=$1", [
    message.id,
  ]);
  expect(await claimDraftForSend(snapshot, [replacement])).toBe(true);

  const rows = (await db.select().from(glyphLinks)).filter(
    (row) => row.messageId === message.id,
  );
  expect(rows).toHaveLength(2);
  expect(rows.find((row) => row.id === original.id).retiredAt).not.toBeNull();
  expect(rows.find((row) => row.id === replacement.id).retiredAt).toBeNull();

  await h.sql("UPDATE glyph_messages SET status='draft' WHERE id=$1", [
    message.id,
  ]);
  expect(await claimDraftForSend(snapshot, [replacement])).toBe(true);
  const active = (
    await h.sql(
      'SELECT id FROM glyph_links WHERE message_id=$1 AND retired_at IS NULL',
      [message.id],
    )
  ).rows;
  expect(active.map((row) => row.id)).toEqual([replacement.id]);
  expect(
    (await h.request(`/l/${original.token}`, { redirect: 'manual' })).status,
  ).toBe(404);
  expect(
    (await h.request(`/l/${replacement.token}`, { redirect: 'manual' })).status,
  ).toBe(302);
});

test('archiving a draft prevents a stale snapshot from being sent', async () => {
  const message = await messageFixture(h.sql, {
    ownerId: h.identity(),
    status: 'draft',
  });
  const snapshot = (await db.select().from(glyphMessages)).find(
    (row) => row.id === message.id,
  );
  await h.sql('UPDATE glyph_messages SET archived_at=now() WHERE id=$1', [
    message.id,
  ]);
  expect(await claimDraftForSend(snapshot, [])).toBe(false);
  expect(
    (
      await h.request(`/messages/${message.id}/send`, {
        user: message.ownerId,
        method: 'POST',
      })
    ).status,
  ).toBe(404);
  const state = await h.sql('SELECT status FROM glyph_messages WHERE id=$1', [
    message.id,
  ]);
  expect(state.rows[0].status).toBe('draft');
});

test('a reused link ID cannot silently change destination or token', async () => {
  const message = await messageFixture(h.sql, {
    status: 'draft',
    ownerId: h.identity(),
  });
  const snapshot = (await db.select().from(glyphMessages)).find(
    (row) => row.id === message.id,
  );
  const link = {
    id: fixtureId(),
    messageId: message.id,
    token: fixtureId().replaceAll('-', '').padEnd(48, '0'),
    url: 'https://example.invalid/original',
  };
  await db.insert(glyphLinks).values(link);
  await expect(
    claimDraftForSend(snapshot, [
      {
        ...link,
        url: 'https://example.invalid/changed',
      },
    ]),
  ).rejects.toThrow('immutable');
  const state = await h.sql('SELECT status FROM glyph_messages WHERE id=$1', [
    message.id,
  ]);
  expect(state.rows[0].status).toBe('draft');
  const stored = await h.sql(
    'SELECT url, retired_at FROM glyph_links WHERE id=$1',
    [link.id],
  );
  expect(stored.rows[0]).toEqual({ url: link.url, retired_at: null });
});
