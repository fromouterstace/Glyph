import { beforeAll, afterAll, expect, test } from 'vitest';
import { serviceHarness, mailbox, edge } from './helpers/service-harness.mjs';
import { messageFixture } from '../lib/database-fixture.mjs';
import {
  consumeTrackingBudget,
  TRACKING_BUDGETS,
} from '../../artifacts/api-server/src/lib/tracking-budget.ts';

let h;
beforeAll(async () => {
  h = await serviceHarness();
});
afterAll(async () => {
  await h?.close();
});

test('owner detail reports persisted outcomes but does not attribute anonymous unknown tokens', async () => {
  const owner = h.identity();
  const other = h.identity();
  const message = await messageFixture(h.sql, { ownerId: owner });
  // A pre-instrumentation message/event remains unchanged by a detail read.
  await h.sql(
    "INSERT INTO glyph_events(id,message_id,type,source,fingerprint) VALUES ($1,$1,'open','fixture',$1)",
    [message.id],
  );
  let response = await h.request(`/messages/${message.id}`, { user: owner });
  let detail = await response.json();
  expect(response.status).toBe(200);
  expect(detail.message.opens).toBe(1);
  expect(detail.diagnostics.preparedTrackingOrigin).toBeNull();
  expect(
    detail.diagnostics.pixelOutcomes.find((row) => row.outcome === 'recorded')
      .requests,
  ).toBe(0);
  await h.request(`/t/${message.token}.gif`);
  await h.request(`/t/${'f'.repeat(48)}.gif`);
  response = await h.request(`/messages/${message.id}`, { user: owner });
  detail = await response.json();
  expect(detail.message.opens).toBe(2);
  expect(
    detail.diagnostics.pixelOutcomes.find((row) => row.outcome === 'recorded')
      .requests,
  ).toBe(1);
  expect(
    detail.diagnostics.pixelOutcomes.find(
      (row) => row.outcome === 'unknown_token',
    ).requests,
  ).toBeNull();
  expect(
    (await h.request(`/messages/${message.id}`, { user: other })).status,
  ).toBe(404);
  expect((await h.request(`/messages/${message.id}`)).status).toBe(401);
  const { rows } = await h.sql(
    'SELECT prepared_tracking_origin, pixel_token FROM glyph_messages WHERE id=$1',
    [message.id],
  );
  expect(rows).toEqual([
    { prepared_tracking_origin: null, pixel_token: message.token },
  ]);
});

test('native prepare and reapply save the actual origin without rotating the existing token', async () => {
  const user = h.identity();
  const body = {
    composeKey: 'diagnostics-compose',
    senderEmail: mailbox,
    recipientEmail: 'recipient@example.invalid',
    recipientName: 'Recipient',
    subject: 'Diagnostic fixture',
    body: 'Synthetic fixture',
    trackOpens: true,
    trackClicks: true,
    urls: ['https://example.invalid'],
  };
  let response = await h.request('/native/prepare', {
    user,
    method: 'POST',
    body,
  });
  expect(response.status).toBe(200);
  const prepared = await response.json();
  const original = (
    await h.sql('SELECT pixel_token FROM glyph_messages WHERE id=$1', [
      prepared.messageId,
    ])
  ).rows[0];
  const headers = {
    origin: 'https://alias.example',
    'x-forwarded-host': 'alias.example',
  };
  response = await h.request('/native/prepare', {
    user,
    method: 'POST',
    body: { ...body, subject: 'Updated fixture' },
    headers,
  });
  expect(response.status).toBe(200);
  const reapplied = await response.json();
  expect(reapplied.messageId).toBe(prepared.messageId);
  expect(reapplied.pixelUrl).toBe(
    `https://alias.example/api/glyph/t/${original.pixel_token}.gif`,
  );
  const detail = await (
    await h.request(`/messages/${prepared.messageId}`, { user })
  ).json();
  expect(detail.diagnostics.preparedTrackingOrigin).toBe(
    'https://alias.example',
  );
  expect(
    (
      await h.sql('SELECT pixel_token FROM glyph_messages WHERE id=$1', [
        prepared.messageId,
      ])
    ).rows,
  ).toEqual([original]);
});

test('native send verification limits remain distinct from unconfirmed sends', async () => {
  const message = await messageFixture(h.sql, {
    ownerId: h.identity(),
    source: 'gmail',
    status: 'draft',
  });
  await consumeTrackingBudget(message.id, 'reconcile');
  await h.sql(
    'UPDATE glyph_tracking_budgets SET day_count=$2 WHERE message_id=$1',
    [message.id, TRACKING_BUDGETS.reconcile.dayLimit],
  );
  const response = await h.request(`/t/${message.token}.gif`);
  expect(response.status).toBe(200);
  expect(
    (
      await h.sql(
        'SELECT outcome, requests FROM glyph_pixel_diagnostics WHERE message_id=$1',
        [message.id],
      )
    ).rows,
  ).toEqual([
    { outcome: 'native_reconciliation_budget_exceeded', requests: 1 },
  ]);
  expect(
    (
      await h.sql('SELECT id FROM glyph_events WHERE message_id=$1', [
        message.id,
      ])
    ).rows,
  ).toEqual([]);
});

test('failed native send verification is persisted without an invented open', async () => {
  const message = await messageFixture(h.sql, {
    ownerId: h.identity(),
    source: 'gmail',
    status: 'draft',
  });
  edge.proxy.mockRejectedValueOnce(new Error('Synthetic provider failure'));
  const response = await h.request(`/t/${message.token}.gif`);
  expect(response.status).toBe(200);
  expect(
    (
      await h.sql(
        'SELECT outcome, requests FROM glyph_pixel_diagnostics WHERE message_id=$1',
        [message.id],
      )
    ).rows,
  ).toEqual([{ outcome: 'native_reconciliation_failed', requests: 1 }]);
  expect(
    (
      await h.sql('SELECT id FROM glyph_events WHERE message_id=$1', [
        message.id,
      ])
    ).rows,
  ).toEqual([]);
});
