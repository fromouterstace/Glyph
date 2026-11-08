import assert from 'node:assert/strict';

/** Independent response oracle: do not import the web server's policy here. */
export function assertDocumentSecurity(headers, path) {
  const policy = headers.get('content-security-policy') ?? '';
  for (const directive of [
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
  ]) {
    const name = directive.split(' ')[0];
    const matches = policy
      .split(';')
      .map((value) => value.trim())
      .filter((value) => value.split(/\s+/)[0] === name);
    assert.ok(
      matches.length === 1 && matches[0] === directive,
      `${path}: missing CSP ${directive} or ambiguous duplicate`,
    );
  }
  for (const [name, expected] of [
    ['x-frame-options', 'DENY'],
    ['x-content-type-options', 'nosniff'],
    ['referrer-policy', 'strict-origin-when-cross-origin'],
    ['permissions-policy', 'camera=(), microphone=(), geolocation=()'],
    ['cache-control', 'no-store'],
  ])
    assert.equal(headers.get(name), expected, `${path}: incorrect ${name}`);
}

/** Edge-owned transport policy is required only for public HTTPS responses. */
export function assertPublishedTransport(headers, path) {
  const match = (headers.get('strict-transport-security') ?? '').match(
    /^max-age=(\d+)(?:\s*;|$)/i,
  );
  const seconds = Number(match?.[1]);
  assert.ok(
    Number.isSafeInteger(seconds) && seconds >= 31_536_000,
    `${path}: missing or weakened HSTS`,
  );
}

export async function checkDocumentHead({ origin, path, fetchImpl }) {
  const response = await fetchImpl(new URL(path, origin), {
    method: 'HEAD',
    redirect: 'manual',
    signal: AbortSignal.timeout(5_000),
  });
  assert.equal(response.status, 200, `${path}: unexpected HEAD status`);
  assert.equal(
    response.headers.get('location'),
    null,
    `${path}: HEAD redirect`,
  );
  assert.match(
    response.headers.get('content-type') ?? '',
    /text\/html/i,
    `${path}: HEAD is not HTML`,
  );
  assertDocumentSecurity(response.headers, `${path} HEAD`);
  assertPublishedTransport(response.headers, `${path} HEAD`);
  assert.equal(
    (await response.arrayBuffer()).byteLength,
    0,
    `${path}: HEAD body`,
  );
}
