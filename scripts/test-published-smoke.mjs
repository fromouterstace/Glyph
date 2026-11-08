import test from 'node:test';
import assert from 'node:assert/strict';
import { publishedOrigins, runPublishedSmoke } from './lib/published-smoke.mjs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const origins = ['https://primary.example', 'https://alias.example'];

test('published checks require distinct bare HTTPS primary and alias origins', () => {
  assert.deepEqual(publishedOrigins(origins.map((v) => v + '/')), origins);
  for (const inputs of [
    [],
    [origins[0]],
    [origins[0], origins[0] + '/'],
    [origins[0], 'http://alias.example'],
    [origins[0], 'https://user:synthetic-secret@alias.example'],
    [origins[0], origins[1] + '/emails'],
    [origins[0], origins[1] + '?token=synthetic-secret'],
    [origins[0], origins[1] + '#fragment'],
  ])
    assert.throws(
      () => publishedOrigins(inputs),
      (e) => !e.message.includes('synthetic-secret'),
    );
});

test('an unhealthy primary cannot skip the alias or yield a successful release result', async () => {
  const visited = [];
  const rows = [];
  await assert.rejects(
    runPublishedSmoke({
      origins,
      smoke: async ({ base }) => {
        visited.push(base);
        if (base === origins[0]) throw new Error('missing CSP');
      },
      report: (row) => rows.push(row),
    }),
    /failed for: https:\/\/primary.example/,
  );
  assert.deepEqual(visited, origins);
  assert.deepEqual(
    rows.filter((r) => r.outcome !== 'started').map((r) => r.outcome),
    ['failed', 'passed'],
  );
});

test('an unhealthy alias fails after a healthy primary and both failures remain visible', async () => {
  for (const failBoth of [false, true]) {
    const visited = [];
    const rows = [];
    await assert.rejects(
      runPublishedSmoke({
        origins,
        smoke: async ({ base }) => {
          visited.push(base);
          if (failBoth || base === origins[1]) throw new Error('missing CSP');
        },
        report: (row) => rows.push(row),
      }),
      /https:\/\/alias.example/,
    );
    assert.deepEqual(visited, origins);
    assert.equal(
      rows.filter((r) => r.outcome === 'failed').length,
      failBoth ? 2 : 1,
    );
  }
});

test('published checks report success only after every origin passes', async () => {
  const rows = [];
  await runPublishedSmoke({
    origins,
    smoke: async ({ report }) => report({ path: '/emails', status: 200 }),
    report: (row) => rows.push(row),
  });
  assert.deepEqual(
    rows.filter((r) => r.outcome === 'passed').map((r) => r.origin),
    origins,
  );
  assert.equal(rows.filter((r) => r.path === '/emails').length, 2);
});

test('the real published CLI fails closed without an alias, before any network request', () => {
  const result = spawnSync(
    process.execPath,
    [
      fileURLToPath(new URL('./published-smoke.mjs', import.meta.url)),
      origins[0],
    ],
    { encoding: 'utf8' },
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /requires the primary and alias HTTPS origins/);
  assert.doesNotMatch(result.stdout, /passed/);
});

test('the real CLI probes both origins and exits nonzero for headerless documents', () => {
  // Child-only transport fixture: no network, credentials or application bypass.
  const preload = `
    globalThis.fetch = async (input) => {
      const path = new URL(input).pathname;
      if (path === '/api/healthz') return Response.json({ status: 'ok' });
      if (path === '/api/readyz') return Response.json(
        { status: 'ready' }, { headers: { 'cache-control': 'no-store' } });
      return new Response('<html><div id="root"></div></html>',
        { headers: { 'content-type': 'text/html' } });
    };
  `;
  const result = spawnSync(
    process.execPath,
    [
      `--import=data:text/javascript,${encodeURIComponent(preload)}`,
      fileURLToPath(new URL('./published-smoke.mjs', import.meta.url)),
      ...origins,
    ],
    { encoding: 'utf8', timeout: 5_000 },
  );
  assert.equal(result.status, 1);
  const rows = result.stdout
    .trim()
    .split('\n')
    .map((row) => JSON.parse(row));
  assert.deepEqual(
    rows.filter((row) => row.outcome === 'failed').map((row) => row.origin),
    origins,
  );
  assert.match(result.stdout, /missing CSP/);
  assert.doesNotMatch(result.stdout, /"outcome":"passed"/);
});
