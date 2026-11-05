import test from 'node:test';
import assert from 'node:assert/strict';

// The shared preview proxy. Use a token that never identifies a real message:
// these HTTP checks must not create engagement events for the user's emails.
const base = 'http://127.0.0.1:80';
const pixel = `${base}/api/glyph/t/${'0'.repeat(48)}.gif`;

for (const accept of ['image/*', '*/*', 'text/html']) {
  test(`public pixel returns an image, not a sign-in handshake, for ${accept}`, async () => {
    const response = await fetch(pixel, {
      redirect: 'manual',
      headers: { accept, 'user-agent': 'Mozilla/5.0 (compatible; GoogleImageProxy)' },
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
  const response = await fetch(pixel, { method: 'HEAD', redirect: 'manual', headers: { accept: 'text/html' } });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('location'), null);
  assert.equal((await response.arrayBuffer()).byteLength, 0);
});

test('invalid public click tokens give an explicit 404, not a sign-in redirect', async () => {
  const response = await fetch(`${base}/api/glyph/l/not-a-token`, {
    redirect: 'manual', headers: { accept: 'text/html' },
  });
  assert.equal(response.status, 404);
  assert.equal(response.headers.get('location'), null);
});

test('moving public tracking outside Clerk does not permit anonymous message preparation', async () => {
  const response = await fetch(`${base}/api/glyph/native/prepare`, {
    method: 'POST', redirect: 'manual',
    headers: { accept: 'application/json', 'content-type': 'application/json', origin: base },
    body: '{}',
  });
  assert.equal(response.status, 401);
});
