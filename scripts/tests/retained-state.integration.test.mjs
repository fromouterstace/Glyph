import { afterAll, beforeAll, expect, test } from 'vitest';
import { db, glyphMessages } from '@workspace/db';
import { messageFixture, fixtureId } from '../lib/database-fixture.mjs';
import { mailbox, serviceHarness } from './helpers/service-harness.mjs';
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
  const snapshot = (await db.select().from(glyphMessages)).find(
    (row) => row.id === message.id,
  );

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
  expect(await claimDraftForSend(snapshot, [])).toBe(false);
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

  const { rows } = await h.sql(
    'SELECT id, retired_at FROM glyph_links WHERE message_id=$1',
    [message.id],
  );
  expect(rows).toHaveLength(2);
  expect(rows.find((row) => row.id === original.id).retired_at).not.toBeNull();
  expect(rows.find((row) => row.id === replacement.id).retired_at).toBeNull();
  expect(
    (
      await h.request(`/l/${original.token}`, {
        redirect: 'manual',
      })
    ).status,
  ).toBe(404);

  await h.sql("UPDATE glyph_messages SET status='draft' WHERE id=$1", [
    message.id,
  ]);
  expect(await claimDraftForSend(snapshot, [replacement])).toBe(true);
  const { rows: active } = await h.sql(
    'SELECT id FROM glyph_links WHERE message_id=$1 AND retired_at IS NULL',
    [message.id],
  );
  expect(active.map((row) => row.id)).toEqual([replacement.id]);
});

test('native reapplication retains unchanged tokens and retires removed links outside the send path', async () => {
  const user = h.identity();
  const input = {
    composeKey: fixtureId(),
    senderEmail: mailbox,
    recipientEmail: 'native@example.invalid',
    recipientName: '',
    toEmails: ['native@example.invalid'],
    ccEmails: [],
    bccEmails: [],
    subject: 'Retained native links',
    body: 'Native compose fixture',
    trackOpens: true,
    trackClicks: true,
    urls: ['https://example.invalid/keep', 'https://example.invalid/remove'],
  };
  const prepare = async (body) => {
    const result = await h.request('/native/prepare', {
      user,
      method: 'POST',
      body,
    });
    expect(result.status).toBe(200);
    return result.json();
  };
  const first = await prepare(input);
  const next = await prepare({
    ...input,
    urls: ['https://example.invalid/keep', 'https://example.invalid/new'],
  });
  expect(next.links[0].trackingUrl).toBe(first.links[0].trackingUrl);
  const removed = new URL(first.links[1].trackingUrl).pathname.split('/').pop();
  expect(
    (await h.request(`/l/${removed}`, { redirect: 'manual' })).status,
  ).toBe(404);
  const { rows } = await h.sql(
    'SELECT count(*)::int AS total, count(*) FILTER (WHERE retired_at IS NULL)::int AS active FROM glyph_links WHERE message_id=$1',
    [first.messageId],
  );
  expect(rows[0]).toEqual({ total: 3, active: 2 });
});
