import test from 'node:test';
import assert from 'node:assert/strict';
import { runSmoke } from './lib/smoke-checks.mjs';

function fixture(overrides = new Map(), calls = []) {
  return async (input) => {
    const { pathname } = new URL(input);
    calls.push(pathname);
    if (overrides.has(pathname)) return overrides.get(pathname)();
    if (pathname === '/api/healthz') return Response.json({ status: 'ok' });
    if (pathname === '/api/readyz')
      return Response.json(
        { status: 'ready' },
        { headers: { 'cache-control': 'no-store' } },
      );
    if (pathname.startsWith('/api/glyph/t/'))
      return new Response(
        Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(37)]),
        { headers: { 'content-type': 'image/gif' } },
      );
    if (pathname.startsWith('/api/glyph/l/'))
      return Response.json({ error: 'Not found' }, { status: 404 });
    if (pathname.startsWith('/api/'))
      return Response.json({ error: 'Sign in' }, { status: 401 });
    if (pathname === '/glyph-extension.zip')
      return new Response(Buffer.from('504b0304', 'hex'));
    if (pathname === '/assets/app.js')
      return new Response('console.log("fixture")', {
        headers: { 'content-type': 'application/javascript' },
      });
    if (pathname === '/assets/app.css')
      return new Response('body{}', {
        headers: { 'content-type': 'text/css' },
      });
    return new Response(
      '<html><div id="root"></div><script src="/assets/app.js"></script><link rel="stylesheet" href="/assets/app.css"></html>',
      { headers: { 'content-type': 'text/html' } },
    );
  };
}

test('smoke checks pages, assets, download and anonymous APIs using only safe reads', async () => {
  const calls = [];
  const reports = [];
  await runSmoke({
    base: 'http://localhost',
    fetchImpl: fixture(new Map(), calls),
    report: (row) => reports.push(row),
  });
  assert.ok(calls.includes('/gmail'));
  assert.ok(calls.includes('/system'));
  assert.ok(calls.includes('/api/glyph/system/access'));
  assert.ok(calls.includes('/api/glyph/system/summary'));
  assert.ok(calls.includes('/assets/app.css'));
  for (const path of [
    '/system',
    '/api/glyph/system/access',
    '/api/glyph/system/summary',
  ]) {
    assert.ok(reports.some((report) => report.path === path));
  }
  assert.equal(calls.filter((path) => path.includes('/t/')).length, 1);
  assert.ok(calls.includes('/api/glyph/t/smoke-invalid-token.gif'));
});

for (const resource of ['messages', 'attachments']) {
  test(`anonymous ${resource} detail access cannot pass composer smoke`, async () => {
    const path = `/api/glyph/${resource}/00000000-0000-4000-8000-000000000000`;
    const overrides = new Map([
      [path, () => Response.json({ secret: 'synthetic' })],
    ]);
    await assert.rejects(
      runSmoke({ base: 'http://localhost', fetchImpl: fixture(overrides) }),
      /unexpected HTTP status/,
    );
  });
}

test('an SPA fallback returned for a missing JavaScript bundle fails smoke', async () => {
  const overrides = new Map([
    [
      '/assets/app.js',
      () =>
        new Response('<html>fallback</html>', {
          headers: { 'content-type': 'text/html' },
        }),
    ],
  ]);
  await assert.rejects(
    runSmoke({ base: 'http://localhost', fetchImpl: fixture(overrides) }),
    /wrong asset type/,
  );
});

test('anonymous API redirects and accidental access fail smoke instead of appearing healthy', async () => {
  for (const status of [200, 302, 500]) {
    const overrides = new Map([
      ['/api/glyph/messages', () => Response.json({}, { status })],
    ]);
    await assert.rejects(
      runSmoke({ base: 'http://localhost', fetchImpl: fixture(overrides) }),
      /unexpected HTTP status/,
    );
  }
});

test('an HTML fallback cannot masquerade as an extension download', async () => {
  const overrides = new Map([
    ['/glyph-extension.zip', () => new Response('<html>fallback</html>')],
  ]);
  await assert.rejects(
    runSmoke({ base: 'http://localhost', fetchImpl: fixture(overrides) }),
    /not a ZIP/,
  );
});

test('a blank frontend shell cannot produce a false-green smoke result', async () => {
  const overrides = new Map([
    [
      '/',
      () =>
        new Response('<html><div id="root"></div></html>', {
          headers: { 'content-type': 'text/html' },
        }),
    ],
  ]);
  await assert.rejects(
    runSmoke({ base: 'http://localhost', fetchImpl: fixture(overrides) }),
    /No local JavaScript entry/,
  );
});
