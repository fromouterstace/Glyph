import test from 'node:test';
import assert from 'node:assert/strict';
import { pages, runSmoke, sensitivePublicPaths } from './lib/smoke-checks.mjs';
import { extensionZip } from './tests/helpers/extension-archive.mjs';

const publishedHeaders = {
  'content-security-policy':
    "frame-ancestors 'none'; object-src 'none'; base-uri 'self'",
  'x-frame-options': 'DENY',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
  'cache-control': 'no-store',
  'strict-transport-security': 'max-age=63072000; includeSubDomains',
};

function fixture(overrides = new Map(), calls = [], published = false) {
  return async (input, options = {}) => {
    const { pathname } = new URL(input);
    calls.push(pathname);
    if (overrides.has(pathname)) return overrides.get(pathname)();
    if (sensitivePublicPaths.includes(pathname))
      return new Response(options.method === 'HEAD' ? null : 'Not found', {
        status: 404,
      });
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
      return new Response(extensionZip());
    if (pathname === '/assets/app.js')
      return new Response('console.log("fixture")', {
        headers: { 'content-type': 'application/javascript' },
      });
    if (pathname === '/assets/app.css')
      return new Response('body{}', {
        headers: { 'content-type': 'text/css' },
      });
    return new Response(
      options.method === 'HEAD'
        ? null
        : '<html><div id="root"></div><script src="/assets/app.js"></script><link rel="stylesheet" href="/assets/app.css"></html>',
      {
        headers: {
          'content-type': 'text/html',
          ...(published ? publishedHeaders : {}),
        },
      },
    );
  };
}

test('HTTPS smoke validates every document with GET and HEAD without skipping API and download checks', async () => {
  const calls = [];
  const heads = [];
  const baseFixture = fixture(new Map(), calls, true);
  await runSmoke({
    base: 'https://glyph.example',
    fetchImpl: (input, options) => {
      if (options.method === 'HEAD') heads.push(new URL(input).pathname);
      return baseFixture(input, options);
    },
  });
  assert.deepEqual(heads, [...pages, ...sensitivePublicPaths]);
  assert.ok(calls.includes('/glyph-extension.zip'));
  assert.ok(calls.includes('/api/glyph/messages'));
});

for (const bypass of ['bearer', 'owner', 'combined']) {
  test(`a ${bypass} authentication bypass fails smoke`, async () => {
    const fetchFixture = fixture();
    await assert.rejects(
      runSmoke({
        base: 'http://localhost',
        fetchImpl: (input, options) => {
          const headers = new Headers(options.headers);
          const bearer = headers.has('authorization');
          const owner = headers.has('x-user-id');
          if (
            new URL(input).pathname === '/api/glyph/messages' &&
            (bypass === 'combined'
              ? bearer && owner
              : bypass === 'bearer'
                ? bearer && !owner
                : owner && !bearer)
          )
            return Response.json({ messages: [] });
          return fetchFixture(input, options);
        },
      }),
      /unexpected HTTP status/,
    );
  });
}

for (const path of sensitivePublicPaths) {
  test(`an exposed ${path} fails published smoke`, async () => {
    const overrides = new Map([
      [path, () => new Response('synthetic configuration')],
    ]);
    await assert.rejects(
      runSmoke({
        base: 'https://glyph.example',
        fetchImpl: fixture(overrides, [], true),
      }),
      /unexpected HTTP status/,
    );
  });
}

test('recognizable credentials in public HTML fail smoke without logging the value', async () => {
  const synthetic = 'sk_' + 'live_' + 'x'.repeat(24);
  const fetchFixture = fixture();
  await assert.rejects(
    runSmoke({
      base: 'http://localhost',
      fetchImpl: async (input, options) => {
        const response = await fetchFixture(input, options);
        if (new URL(input).pathname === '/settings')
          return new Response(`<div id="root">${synthetic}</div>`, {
            headers: { 'content-type': 'text/html' },
          });
        return response;
      },
    }),
    (error) =>
      error.message.includes('Clerk server key') &&
      !error.message.includes(synthetic),
  );
});

for (const name of ['background.js', '.env']) {
  test(`a recognizable credential packaged in extension ${name} fails smoke`, async () => {
    const synthetic = 'GOCSPX-' + 'x'.repeat(24);
    const overrides = new Map([
      [
        '/glyph-extension.zip',
        () => new Response(extensionZip({ [name]: synthetic })),
      ],
    ]);
    await assert.rejects(
      runSmoke({ base: 'http://localhost', fetchImpl: fixture(overrides) }),
      (error) =>
        error.message.includes('Google client secret') &&
        !error.message.includes(synthetic),
    );
  });
}

test('a HEAD-only policy regression on a deep link fails complete HTTPS smoke', async () => {
  const baseFixture = fixture(new Map(), [], true);
  await assert.rejects(
    runSmoke({
      base: 'https://glyph.example',
      fetchImpl: async (input, options) => {
        const response = await baseFixture(input, options);
        if (options.method === 'HEAD' && new URL(input).pathname === '/gmail')
          response.headers.delete('content-security-policy');
        return response;
      },
    }),
    /\/gmail HEAD: missing CSP/,
  );
});

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

test('a broken lazy page chunk fails smoke even when entry assets load', async () => {
  const overrides = new Map([
    [
      '/assets/app.js',
      () =>
        new Response('export const page=()=>import("./emails.js")', {
          headers: { 'content-type': 'application/javascript' },
        }),
    ],
    [
      '/assets/emails.js',
      () =>
        new Response('<html>missing page</html>', {
          headers: { 'content-type': 'text/html' },
        }),
    ],
  ]);
  await assert.rejects(
    runSmoke({ base: 'http://localhost', fetchImpl: fixture(overrides) }),
    /wrong asset type/,
  );
});

test('a truncated ZIP with a valid magic signature cannot pass deployed smoke', async () => {
  const overrides = new Map([
    [
      '/glyph-extension.zip',
      () => new Response(Buffer.from('504b0304', 'hex')),
    ],
  ]);
  await assert.rejects(
    runSmoke({ base: 'http://localhost', fetchImpl: fixture(overrides) }),
    /truncated/,
  );
});

test('the documented edge routing cookie is allowed but auth cookies fail without exposing values', async () => {
  const response = (cookie) =>
    new Response(Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(37)]), {
      headers: { 'content-type': 'image/gif', 'set-cookie': cookie },
    });
  const path = '/api/glyph/t/smoke-invalid-token.gif';
  await runSmoke({
    base: 'http://localhost',
    fetchImpl: fixture(
      new Map([[path, () => response('GAESA=synthetic-routing')]]),
    ),
  });
  await assert.rejects(
    runSmoke({
      base: 'http://localhost',
      fetchImpl: fixture(
        new Map([[path, () => response('__session=synthetic-secret')]]),
      ),
    }),
    (error) =>
      error.message.includes('application cookies') &&
      !error.message.includes('synthetic-secret'),
  );
});
