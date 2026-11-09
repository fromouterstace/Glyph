import { afterAll, beforeAll, expect, test } from 'vitest';
import { and, eq, isNull } from 'drizzle-orm';
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
    deliverySource: 'web',
    status: 'draft',
  });
  const [snapshot] = await db
    .select()
    .from(glyphMessages)
    .where(eq(glyphMessages.id, message.id));
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

  const rows = await db
    .select()
    .from(glyphLinks)
    .where(eq(glyphLinks.messageId, message.id));
  expect(rows).toHaveLength(2);
  expect(rows.find((row) => row.id === original.id).retiredAt).not.toBeNull();
  expect(rows.find((row) => row.id === replacement.id).retiredAt).toBeNull();

  await h.sql("UPDATE glyph_messages SET status='draft' WHERE id=$1", [
    message.id,
  ]);
  expect(await claimDraftForSend(snapshot, [replacement])).toBe(true);
  const active = await db
    .select()
    .from(glyphLinks)
    .where(
      and(eq(glyphLinks.messageId, message.id), isNull(glyphLinks.retiredAt)),
    );
  expect(active.map((row) => row.id)).toEqual([replacement.id]);
});
