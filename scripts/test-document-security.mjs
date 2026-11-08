import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertDocumentSecurity,
  assertPublishedTransport,
  checkDocumentHead,
} from './lib/document-security.mjs';
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

test('conflicting CSP duplicates cannot hide behind a valid directive in either order', () => {
  for (const name of ['frame-ancestors', 'object-src', 'base-uri'])
    for (const first of [true, false]) {
      const unsafe = `${name} *`;
      const policy = valid['content-security-policy'];
      const headers = new Headers({
        ...valid,
        'content-security-policy': first
          ? `${unsafe}; ${policy}`
          : `${policy}; ${unsafe}`,
      });
      assert.throws(
        () => assertDocumentSecurity(headers, '/emails'),
        /ambiguous duplicate/,
      );
    }
});

test('published transport cannot silently drop HSTS or shorten its one-year floor', () => {
  for (const policy of ['', 'max-age=0', 'max-age=31535999', 'invalid'])
    assert.throws(
      () =>
        assertPublishedTransport(
          new Headers({ 'strict-transport-security': policy }),
          '/',
        ),
      /HSTS/,
    );
  assert.doesNotThrow(() =>
    assertPublishedTransport(
      new Headers({
        'strict-transport-security': 'max-age=63072000; includeSubDomains',
      }),
      '/',
    ),
  );
});

test('HEAD policy checks reject redirects, non-HTML, missing policies and response bodies', async () => {
  const headers = {
    ...valid,
    'content-type': 'text/html',
    'strict-transport-security': 'max-age=63072000',
  };
  const run = (response) =>
    checkDocumentHead({
      origin: 'https://glyph.example',
      path: '/emails',
      fetchImpl: async (_url, options) => {
        assert.equal(options.method, 'HEAD');
        assert.equal(options.redirect, 'manual');
        assert.ok(options.signal instanceof AbortSignal);
        return response;
      },
    });
  await run(new Response(null, { headers }));
  for (const response of [
    new Response(null, { status: 302, headers }),
    new Response(null, { headers: { ...headers, location: '/sign-in' } }),
    new Response(null, {
      headers: { ...headers, 'content-type': 'application/json' },
    }),
    new Response(null, { headers: { ...headers, 'x-frame-options': '' } }),
    new Response(null, {
      headers: { ...headers, 'strict-transport-security': '' },
    }),
    new Response('unexpected body', { headers }),
  ])
    await assert.rejects(run(response));
});
