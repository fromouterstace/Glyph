import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import FakeTimers from '@sinonjs/fake-timers';
import { createReadinessProbe } from '../artifacts/api-server/src/lib/database-readiness.ts';

function assertProbeQuery(text) {
  if (text.includes('LIMIT 0')) {
    for (const column of [
      'glyph_messages',
      'glyph_events',
      'glyph_links',
      'glyph_system_events',
      'glyph_attachments',
      'glyph_settings',
      'glyph_tracking_budgets',
      'glyph_contacts',
      'glyph_label_imports',
      'glyph_deliveries',
      'm.body_html',
      'm.attachments',
      'a.generation',
      'd.event_id',
      'd.rfc_message_id',
      'o.expires_at',
      'g.generation',
    ])
      assert.ok(text.includes(column), `missing ${column}`);
    return;
  }
  assert.match(text, /pg_index/);
  assert.match(text, /i\.indpred IS NULL AND i\.indexprs IS NULL/);
  assert.match(text, /tbl\.relname = required\.table_name/);
  for (const constraint of [
    'glyph_messages_pkey',
    'glyph_events_pkey',
    'glyph_links_pkey',
    'glyph_settings_pkey',
    'glyph_system_events_pkey',
    'glyph_attachments_pkey',
    'glyph_gmail_connections_pkey',
    'glyph_gmail_oauth_states_pkey',
    'glyph_deliveries_pkey',
    'glyph_tracking_budgets_message_id_kind_pk',
    'glyph_messages_pixel_token_unique',
    'glyph_events_fingerprint_unique',
    'glyph_links_token_unique',
    'glyph_native_compose_idx',
    'glyph_gmail_connections_email_idx',
    'glyph_delivery_signal_idx',
    'glyph_deliveries_rfc_message_id_key',
    'glyph_events_message_id_glyph_messages_id_fk',
    'glyph_links_message_id_glyph_messages_id_fk',
    'glyph_tracking_budgets_message_id_glyph_messages_id_fk',
    'glyph_deliveries_message_id_fkey',
    'glyph_deliveries_event_id_fkey',
    'glyph_tracking_budgets_kind_check',
    'glyph_tracking_budgets_counts_check',
    'c.confdeltype = required.expected',
    'ref.relname = required.reference_table',
  ])
    assert.ok(text.includes(constraint), `missing ${constraint}`);
}

test('readiness references every table in the latest reviewed schema inventory', async () => {
  const reviewDir = new URL('../lib/db/schema-reviews/', import.meta.url);
  const files = (await readdir(reviewDir))
    .filter((file) => /^\d{4}\.shape\.json$/.test(file))
    .sort();
  const latest = files.at(-1);
  assert.ok(latest, 'no reviewed database shape is available');
  const shape = JSON.parse(
    await readFile(new URL(latest, reviewDir), 'utf8'),
  );
  let schemaQuery = '';
  const probe = createReadinessProbe(
    async () => ({
      query: async ({ text }) => {
        if (text.includes('LIMIT 0')) schemaQuery = text;
        return { rows: [] };
      },
      release: () => {},
    }),
    { cacheMs: 0 },
  );

  assert.equal(await probe(), true);
  for (const table of Object.keys(shape)) {
    assert.ok(schemaQuery.includes(table), `readiness omits ${table}`);
  }
});

test('database readiness checks critical schema, coalesces callers and briefly caches results', async () => {
  let calls = 0;
  let released = 0;
  let now = 0;
  const probe = createReadinessProbe(
    async () => {
      calls++;
      return {
        query: async ({ text }) => {
          assertProbeQuery(text);
          return { rows: [] };
        },
        release: () => {
          released++;
        },
      };
    },
    { now: () => now },
  );
  assert.deepEqual(await Promise.all([probe(), probe()]), [true, true]);
  assert.equal(await probe(), true);
  assert.equal(calls, 1);
  now = 1_001;
  assert.equal(await probe(), true);
  assert.equal(calls, 2);
  assert.equal(released, 2);
});

test('missing or invalid integrity constraints fail readiness without leaking catalog details', async () => {
  let queries = 0;
  const probe = createReadinessProbe(async () => ({
    query: async ({ text }) => {
      queries++;
      if (text.includes('pg_index'))
        return { rows: [{ name: 'private-index-name' }] };
      return { rows: [] };
    },
    release: () => {},
  }));
  assert.equal(await probe(), false);
  assert.equal(queries, 2);
});

test('unreachable PostgreSQL and missing schema fail readiness without leaking errors', async () => {
  const failedConnect = createReadinessProbe(async () => {
    throw new Error('private connection details');
  });
  assert.equal(await failedConnect(), false);
  let released = false;
  const failedQuery = createReadinessProbe(async () => ({
    query: async () => {
      throw new Error('private schema details');
    },
    release: () => {
      released = true;
    },
  }));
  assert.equal(await failedQuery(), false);
  assert.equal(released, true);
});

test('a late database connection is destroyed after the bounded readiness timeout', async (t) => {
  const clock = FakeTimers.install({ toFake: ['setTimeout', 'clearTimeout'] });
  t.after(() => clock.uninstall());
  let resolveConnection;
  let destroyed = false;
  let queried = false;
  const probe = createReadinessProbe(
    () =>
      new Promise((resolve) => {
        resolveConnection = resolve;
      }),
  );
  const result = probe();
  await clock.tickAsync(1_001);
  assert.equal(await result, false);
  resolveConnection({
    query: async () => {
      queried = true;
    },
    release: (destroy) => {
      destroyed = destroy;
    },
  });
  await clock.tickAsync(0);
  assert.equal(destroyed, true);
  assert.equal(queried, false);
});

test('a hanging readiness query times out and does not release a busy client for reuse', async (t) => {
  const clock = FakeTimers.install({ toFake: ['setTimeout', 'clearTimeout'] });
  t.after(() => clock.uninstall());
  let finish;
  let destroyed = false;
  const probe = createReadinessProbe(async () => ({
    query: () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
    release: (destroy) => {
      destroyed = destroy;
    },
  }));
  const result = probe();
  await clock.tickAsync(1_001);
  assert.equal(await result, false);
  finish();
  await clock.tickAsync(0);
  assert.equal(destroyed, true);
});

test('timed-out readiness does not accumulate unresolved pool waiters', async (t) => {
  const clock = FakeTimers.install({ toFake: ['setTimeout', 'clearTimeout'] });
  t.after(() => clock.uninstall());
  let attempts = 0;
  const probe = createReadinessProbe(
    () => {
      attempts++;
      return new Promise(() => {});
    },
    { now: () => clock.now },
  );
  const first = probe();
  await clock.tickAsync(1_001);
  assert.equal(await first, false);
  await clock.tickAsync(5_000);
  assert.deepEqual(await Promise.all([probe(), probe(), probe()]), [
    false,
    false,
    false,
  ]);
  assert.equal(attempts, 1);
});
