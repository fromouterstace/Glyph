import assert from 'node:assert/strict';

/** Independent response oracle: do not import the web server's policy here. */
export function assertDocumentSecurity(headers, path) {
  const policy = headers.get('content-security-policy') ?? '';
  for (const directive of [
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
  ])
    assert.ok(
      policy.split(';').some((value) => value.trim() === directive),
      `${path}: missing CSP ${directive}`,
    );
  for (const [name, expected] of [
    ['x-frame-options', 'DENY'],
    ['x-content-type-options', 'nosniff'],
    ['referrer-policy', 'strict-origin-when-cross-origin'],
    ['permissions-policy', 'camera=(), microphone=(), geolocation=()'],
    ['cache-control', 'no-store'],
  ])
    assert.equal(headers.get(name), expected, `${path}: incorrect ${name}`);
}
