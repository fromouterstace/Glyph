import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool } from '@workspace/db';
import { isolatedDatabase, messageFixture } from './lib/database-fixture.mjs';
import { startProcess, waitUntil } from './tests/helpers/process-harness.mjs';

let database;
let schema;
before(async () => {
  database = await isolatedDatabase();
  schema = (await database.query('SELECT current_schema() AS name')).rows[0]
    .name;
});
after(async () => database?.close());

test('SIGINT closes an idle API and its database pool cleanly', async (t) => {
  const worker = await startProcess(schema);
  t.after(() => worker.stop());
  assert.equal((await fetch(`${worker.base}/api/readyz`)).status, 200);
  worker.child.kill('SIGINT');
  assert.deepEqual(await worker.exit, [0, null]);
});

test('real API readiness fails on missing schema while liveness remains healthy', async (t) => {
  await database.query('ALTER TABLE glyph_links RENAME TO unavailable_links');
  t.after(() =>
    database.query('ALTER TABLE unavailable_links RENAME TO glyph_links'),
  );
  const worker = await startProcess(schema);
  t.after(() => worker.stop());
  const live = await fetch(`${worker.base}/api/healthz`);
  const ready = await fetch(`${worker.base}/api/readyz`);
  assert.equal(live.status, 200);
  assert.equal(ready.status, 503);
  assert.deepEqual(await ready.json(), { status: 'not_ready' });
  assert.equal(ready.headers.get('cache-control'), 'no-store');
});

test('SIGTERM drains an actual blocked pixel write before closing PostgreSQL and exiting', async (t) => {
  const fixture = await messageFixture(database.query);
  const worker = await startProcess(schema);
  t.after(() => worker.stop());
  assert.equal((await fetch(`${worker.base}/api/readyz`)).status, 200);
  const lock = await pool.connect();
  t.after(async () => {
    await lock.query('ROLLBACK');
    lock.release();
  });
  await lock.query('BEGIN');
  await lock.query('LOCK TABLE glyph_events IN ACCESS EXCLUSIVE MODE');
  const request = fetch(`${worker.base}/api/glyph/t/${fixture.token}.gif`, {
    signal: AbortSignal.timeout(10_000),
  });
  await waitUntil(
    async () =>
      (
        await database.query(
          'SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type=$2) AS waiting',
          [worker.applicationName, 'Lock'],
        )
      ).rows[0].waiting,
  );
  const draining = worker.message('draining');
  worker.child.kill('SIGTERM');
  await draining;
  await lock.query('COMMIT');
  const response = await request;
  assert.equal(response.status, 200);
  assert.equal((await response.arrayBuffer()).byteLength, 43);
  assert.deepEqual(await worker.exit, [0, null]);
  const stored = await database.query(
    'SELECT type FROM glyph_events WHERE message_id=$1',
    [fixture.id],
  );
  assert.deepEqual(stored.rows, [{ type: 'open' }]);
});

test('a shutdown deadline exits nonzero rather than hanging on a blocked database write', async (t) => {
  const fixture = await messageFixture(database.query);
  const worker = await startProcess(schema, 250);
  t.after(() => worker.stop());
  const lock = await pool.connect();
  t.after(async () => {
    await lock.query('ROLLBACK');
    lock.release();
  });
  await lock.query('BEGIN');
  await lock.query('LOCK TABLE glyph_events IN ACCESS EXCLUSIVE MODE');
  const request = fetch(`${worker.base}/api/glyph/t/${fixture.token}.gif`, {
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);
  await waitUntil(
    async () =>
      (
        await database.query(
          'SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type=$2) AS waiting',
          [worker.applicationName, 'Lock'],
        )
      ).rows[0].waiting,
  );
  const started = Date.now();
  worker.child.kill('SIGTERM');
  assert.deepEqual(await worker.exit, [1, null]);
  assert.ok(Date.now() - started < 3_000);
  await lock.query('ROLLBACK');
  await request;
  const stored = await database.query(
    'SELECT type FROM glyph_events WHERE message_id=$1',
    [fixture.id],
  );
  assert.deepEqual(stored.rows, []);
});

test('a committed sending claim survives SIGKILL and restart confirmation stays idempotent', async (t) => {
  const fixture = await messageFixture(database.query, { status: 'draft' });
  const first = await startProcess(schema);
  t.after(() => first.stop());
  assert.equal((await first.command('claim', fixture.id)).result, true);
  first.child.kill('SIGKILL');
  await first.exit;
  const second = await startProcess(schema);
  t.after(() => second.stop());
  const stored = await database.query(
    'SELECT status FROM glyph_messages WHERE id=$1',
    [fixture.id],
  );
  assert.equal(stored.rows[0].status, 'sending');
  assert.equal((await second.command('confirm', fixture.id)).result, true);
  assert.equal((await second.command('confirm', fixture.id)).result, false);
  const events = await database.query(
    'SELECT type FROM glyph_events WHERE message_id=$1',
    [fixture.id],
  );
  assert.deepEqual(events.rows, [{ type: 'sent' }]);
});
