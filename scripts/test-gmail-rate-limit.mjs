import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createGmailReadGate,
  GmailRateLimitError,
} from '../artifacts/api-server/src/lib/gmail-rate-limit.ts';
import {
  createHeaderReader,
  scanHeaderPage,
} from '../artifacts/api-server/src/lib/reply-header-scan.ts';

const response = (status, retryAfter = null) => ({
  status,
  headers: { get: () => retryAfter },
});
function fixture() {
  let clock = Date.parse('2026-01-01T00:00:00Z');
  const waits = [];
  const gate = createGmailReadGate({
    now: () => clock,
    sleep: async (ms) => {
      waits.push(ms);
      clock += ms;
    },
  });
  return {
    gate,
    waits,
    now: () => clock,
    advance: (ms) => {
      clock += ms;
    },
  };
}

test('queued reads stop after one 429 instead of sending the rest of a burst', async () => {
  const { gate } = fixture();
  let calls = 0;
  const request = async () => {
    calls++;
    return response(429, '60');
  };
  const results = await Promise.allSettled([
    gate.run(request),
    gate.run(request),
    gate.run(request),
  ]);
  assert.equal(calls, 1);
  assert.ok(
    results.every(
      (r) => r.status === 'rejected' && r.reason instanceof GmailRateLimitError,
    ),
  );
});

test('idle gate eviction cannot discard a queued read or an active cooldown', async () => {
  const f = fixture();
  assert.equal(f.gate.isIdle(), true);
  const latch = Promise.withResolvers();
  const running = f.gate.run(() => latch.promise);
  assert.equal(f.gate.isIdle(), false);
  latch.resolve(response(200));
  await running;
  assert.equal(f.gate.isIdle(), true);
  await assert.rejects(f.gate.run(async () => response(429, '60')));
  assert.equal(f.gate.isIdle(), false);
  f.advance(60_000);
  assert.equal(f.gate.isIdle(), true);
});

test('numeric Retry-After prevents reads until the complete retry window expires', async () => {
  const f = fixture();
  await assert.rejects(f.gate.run(async () => response(429, '120')));
  f.advance(119_000);
  await assert.rejects(
    f.gate.run(async () => response(200)),
    GmailRateLimitError,
  );
  f.advance(1_000);
  assert.equal((await f.gate.run(async () => response(200))).status, 200);
});

test('HTTP-date Retry-After is honored without using the real clock', async () => {
  const f = fixture();
  const until = f.now() + 180_000;
  await assert.rejects(
    f.gate.run(async () => response(429, new Date(until).toUTCString())),
    (error) => error.retryAt === until,
  );
});

for (const header of [
  null,
  '',
  'not-a-date',
  '0',
  'Wed, 01 Jan 2020 00:00:00 GMT',
]) {
  test(`missing or unusable Retry-After ${JSON.stringify(header)} uses bounded backoff`, async () => {
    const f = fixture();
    await assert.rejects(
      f.gate.run(async () => response(429, header)),
      (error) => error.retryAt === f.now() + 60_000,
    );
    f.advance(60_000);
    await assert.rejects(
      f.gate.run(async () => response(429, header)),
      (error) => error.retryAt === f.now() + 120_000,
    );
  });
}

test('successful reads are serialized and spaced without automatic retries', async () => {
  const f = fixture();
  let active = 0,
    peak = 0;
  const request = async () => {
    active++;
    peak = Math.max(peak, active);
    await Promise.resolve();
    active--;
    return response(200);
  };
  await Promise.all([
    f.gate.run(request),
    f.gate.run(request),
    f.gate.run(request),
  ]);
  assert.equal(peak, 1);
  assert.deepEqual(f.waits, [250, 250]);
});

test('a network exception is not retried and does not poison subsequent reads', async () => {
  const f = fixture();
  let calls = 0;
  await assert.rejects(
    f.gate.run(async () => {
      calls++;
      throw new Error('offline');
    }),
    /offline/,
  );
  await f.gate.run(async () => response(200));
  assert.equal(calls, 1);
});

test('ordinary provider permission errors are not mislabeled as rate limits', async () => {
  const f = fixture();
  assert.equal((await f.gate.run(async () => response(403))).status, 403);
});

test('a header scan commits successful replies before a later read fails', async () => {
  const saved = [];
  await assert.rejects(
    scanHeaderPage(
      ['one', 'two', 'three'],
      async (id) => {
        if (id === 'three') throw new Error('429');
        return id;
      },
      async (candidate) => {
        saved.push(candidate);
      },
    ),
    /429/,
  );
  assert.deepEqual(saved, ['one', 'two']);
});

test('a per-pass header budget yields an honest partial result without extra reads', async () => {
  const saved = [];
  const read = createHeaderReader(
    async (id) => id,
    () => false,
    2,
  );
  const complete = await scanHeaderPage(
    ['one', 'two', 'three'],
    read,
    async (value) => {
      saved.push(value);
    },
  );
  assert.equal(complete, false);
  assert.deepEqual(saved, ['one', 'two']);
});

test('cached headers do not consume the next pass budget, allowing forward progress', async () => {
  const read = createHeaderReader(
    async (id) => id,
    (id) => id === 'cached',
    1,
  );
  const saved = [];
  assert.equal(
    await scanHeaderPage(['cached', 'fresh'], read, async (value) => {
      saved.push(value);
    }),
    true,
  );
  assert.deepEqual(saved, ['cached', 'fresh']);
});
