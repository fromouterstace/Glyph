import test from 'node:test';
import assert from 'node:assert/strict';
import FakeTimers from '@sinonjs/fake-timers';
import { createReadinessProbe } from '../artifacts/api-server/src/lib/database-readiness.ts';

test('database readiness checks critical schema, coalesces callers and briefly caches results', async () => {
  let calls = 0;
  let released = 0;
  let now = 0;
  const probe = createReadinessProbe(
    async () => {
      calls++;
      return {
        query: async ({ text }) => {
          assert.match(text, /glyph_messages/);
          assert.match(text, /glyph_events/);
          assert.match(text, /glyph_links/);
          assert.match(text, /glyph_system_events/);
          assert.match(text, /glyph_attachments/);
          assert.match(text, /m.body_html/);
          assert.match(text, /m.attachments/);
          assert.match(text, /a.generation/);
          assert.match(text, /LIMIT 0/);
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
