import test from 'node:test';
import assert from 'node:assert/strict';
import { assertDocumentSecurity } from './lib/document-security.mjs';
import { runSmoke } from './lib/smoke-checks.mjs';

const valid = {
  'content-security-policy':
    "frame-ancestors 'none'; object-src 'none'; base-uri 'self'",
  'x-frame-options': 'DENY',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
  'cache-control': 'no-store',
};

test('the document oracle requires actual response headers, not HTML metadata or source config', () => {
  assert.doesNotThrow(() =>
    assertDocumentSecurity(new Headers(valid), '/emails'),
  );
  for (const name of Object.keys(valid)) {
    const headers = new Headers(valid);
    headers.delete(name);
    assert.throws(
      () => assertDocumentSecurity(headers, '/emails'),
      /\/emails:/,
    );
  }
  const weak = new Headers({
    ...valid,
    'content-security-policy':
      "frame-ancestors 'self'; object-src 'none'; base-uri 'self'",
  });
  assert.throws(
    () => assertDocumentSecurity(weak, '/emails'),
    /frame-ancestors/,
  );
});

test('production HTTPS smoke fails immediately when HTML lacks its policies', async () => {
  const fetchImpl = async (input) => {
    const path = new URL(input).pathname;
    if (path === '/api/healthz') return Response.json({ status: 'ok' });
    if (path === '/api/readyz')
      return Response.json(
        { status: 'ready' },
        { headers: { 'cache-control': 'no-store' } },
      );
    return new Response('<html><div id="root"></div></html>', {
      headers: { 'content-type': 'text/html' },
    });
  };
  await assert.rejects(
    runSmoke({ base: 'https://glyph.example', fetchImpl }),
    /missing CSP/,
  );
});
