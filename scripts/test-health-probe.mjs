import test from 'node:test';
import assert from 'node:assert/strict';
import { smokeOrigin, waitForHealth } from './lib/health-probe.mjs';

test('smoke targets reject credentials, non-HTTPS remote hosts and ambiguous paths', () => {
  for (const value of [
    'http://example.org',
    'https://u:p@example.org',
    'https://example.org/path',
    'https://example.org/?x=1',
    'https://example.org/#x',
    'file:///tmp/test',
  ]) {
    assert.throws(() => smokeOrigin(value));
  }
  assert.equal(smokeOrigin('https://example.org/'), 'https://example.org');
  assert.equal(smokeOrigin('http://127.0.0.1:80'), 'http://127.0.0.1');
});

test('health preflight tolerates a startup 502 but requires healthy JSON', async () => {
  let clock = 0;
  const statuses = [502, 200, 200];
  await waitForHealth({
    base: 'http://localhost',
    now: () => clock,
    sleep: async (ms) => {
      clock += ms;
    },
    fetchImpl: async (_url, options) => {
      assert.equal(options.redirect, 'manual');
      const status = statuses.shift();
      return Response.json(
        { status: statuses.length ? 'starting' : 'ok' },
        { status },
      );
    },
  });
  assert.equal(statuses.length, 0);
  assert.equal(clock, 500);
});

test('health failures exhaust a bounded fake-clock budget instead of hanging', async () => {
  let clock = 0;
  let calls = 0;
  await assert.rejects(
    waitForHealth({
      base: 'http://localhost',
      budgetMs: 500,
      now: () => clock,
      sleep: async (ms) => {
        clock += ms;
      },
      fetchImpl: async () => {
        calls++;
        throw new Error('synthetic connection failure');
      },
    }),
    /timed out after 500ms/,
  );
  assert.equal(clock, 500);
  assert.equal(calls, 2);
});

test('invalid health JSON and redirects cannot satisfy the startup preflight', async () => {
  for (const response of [
    new Response('<html>login</html>'),
    new Response(null, { status: 302, headers: { location: '/sign-in' } }),
  ]) {
    let clock = 0;
    await assert.rejects(
      waitForHealth({
        base: 'http://localhost',
        budgetMs: 1,
        now: () => clock,
        sleep: async (ms) => {
          clock += ms;
        },
        fetchImpl: async () => response,
      }),
      /timed out/,
    );
  }
});
