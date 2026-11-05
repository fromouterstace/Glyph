import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { waitForHealth } from './lib/health-probe.mjs';

// These checks never target production or request a real customer's pixel.
const base = process.env.GLYPH_HTTP_BASE_URL || 'http://127.0.0.1:80';
const origin = new URL(base);
if (!['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname))
  throw new Error(
    'HTTP contract tests require a local running app, never production.',
  );
const pixel = `${base}/api/glyph/t/not-a-customer-pixel.gif`;
const request = (url, options = {}) =>
  fetch(url, { signal: AbortSignal.timeout(5_000), ...options });

// Retry startup health only, never a failed security or persistence assertion.
before(() => waitForHealth({ base }));

test('malformed JSON is a client error, not a server failure', async () => {
  const response = await request(`${base}/api/glyph/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{"private_message":',
  });
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: 'Enter a valid JSON request body.',
  });
});

test('oversized JSON returns an explicit payload limit error', async () => {
  const response = await request(`${base}/api/glyph/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ body: 'x'.repeat(110_000) }),
  });
  assert.equal(response.status, 413);
  assert.deepEqual(await response.json(), {
    error: 'The request body is too large.',
  });
});

test('test-harness identity headers cannot authenticate against the running application', async () => {
  const response = await request(`${base}/api/glyph/messages`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-test-user': 'fixture-owner',
      origin: base,
    },
    body: '{}',
  });
  assert.equal(response.status, 401);
});

test('health remains public and exposes only its status', async () => {
  const response = await request(`${base}/api/healthz`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'ok' });
});

test('readiness publicly establishes bounded database readiness without exposing details', async () => {
  const response = await request(`${base}/api/readyz`, { redirect: 'manual' });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('location'), null);
  assert.deepEqual(await response.json(), { status: 'ready' });
});

for (const [method, path] of [
  ['GET', '/overview'],
  ['GET', '/messages'],
  ['HEAD', '/messages'],
  ['GET', '/messages/fake-id'],
  ['GET', '/activity'],
  ['GET', '/settings'],
  ['GET', '/connection'],
  ['POST', '/native/sync'],
]) {
  test(`anonymous ${method} ${path} is rejected before accessing account data`, async () => {
    const response = await request(`${base}/api/glyph${path}`, {
      method,
      redirect: 'manual',
      headers: {
        accept: 'application/json',
        origin: base,
        'content-type': 'application/json',
      },
      ...(method === 'POST' ? { body: '{}' } : {}),
    });
    assert.equal(response.status, 401);
    assert.equal(response.headers.get('location'), null);
  });
}

for (const [method, path] of [
  ['POST', '/messages'],
  ['PATCH', '/messages/unowned'],
  ['DELETE', '/messages/unowned'],
  ['POST', '/messages/unowned/send'],
  ['POST', '/activity/read'],
  ['PATCH', '/settings'],
]) {
  test(`anonymous ${method} ${path} is rejected before any write`, async () => {
    const response = await request(`${base}/api/glyph${path}`, {
      method,
      redirect: 'manual',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        origin: base,
      },
      body: '{}',
    });
    assert.equal(response.status, 401);
  });
}

for (const accept of ['image/*', '*/*', 'text/html']) {
  test(`public pixel returns an image, not a sign-in handshake, for ${accept}`, async () => {
    const response = await request(pixel, {
      redirect: 'manual',
      headers: {
        accept,
        'user-agent': 'Mozilla/5.0 (compatible; GoogleImageProxy)',
      },
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('location'), null);
    assert.equal(response.headers.get('set-cookie'), null);
    assert.match(response.headers.get('content-type'), /^image\/gif\b/);
    const body = Buffer.from(await response.arrayBuffer());
    assert.equal(body.length, 43);
    assert.equal(body.subarray(0, 6).toString(), 'GIF89a');
  });
}

test('HEAD on the public pixel returns no body or authentication redirect', async () => {
  const response = await request(pixel, {
    method: 'HEAD',
    redirect: 'manual',
    headers: { accept: 'text/html' },
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('location'), null);
  assert.equal((await response.arrayBuffer()).byteLength, 0);
});

test('invalid public click tokens give an explicit 404, not a sign-in redirect', async () => {
  const response = await request(`${base}/api/glyph/l/not-a-token`, {
    redirect: 'manual',
    headers: { accept: 'text/html' },
  });
  assert.equal(response.status, 404);
  assert.equal(response.headers.get('location'), null);
});

test('moving public tracking outside Clerk does not permit anonymous message preparation', async () => {
  const response = await request(`${base}/api/glyph/native/prepare`, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      origin: base,
    },
    body: '{}',
  });
  assert.equal(response.status, 401);
});
