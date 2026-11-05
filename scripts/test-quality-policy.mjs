import test from 'node:test';
import assert from 'node:assert/strict';
import { unitFiles } from './lib/test-policy.mjs';
import { resolveTrackingOrigin } from '../artifacts/api-server/src/lib/tracking-origin.ts';

test('new conventionally named unit tests are automatically included', () => {
  assert.deepEqual(unitFiles(['test-new-bug.mjs', 'new-rule.test.mjs']), [
    'new-rule.test.mjs',
    'test-new-bug.mjs',
  ]);
});

test('unit discovery excludes integration and source-reading contract suites', () => {
  assert.deepEqual(
    unitFiles([
      'database.integration.test.mjs',
      'test-tracking-http.mjs',
      'test-gmail-background.mjs',
      'test-gmail-extension.mjs',
      'tracking-origin.contract.test.mjs',
      'run-unit-tests.mjs',
    ]),
    [],
  );
});

test('origin canonicalization is idempotent over the fixed host domain', () => {
  for (let n = 0; n < 32; n++) {
    const host = `GLYPH-${n}.Example`;
    const canonical = resolveTrackingOrigin(`https://${host}:443/`);
    assert.equal(resolveTrackingOrigin(canonical), canonical, host);
    assert.equal(canonical, `https://${host.toLowerCase()}`, host);
  }
});

test('distinct environments cannot own the same tracking tokens over the fixed host domain', () => {
  for (let n = 0; n < 32; n++) {
    const host = `GLYPH-${n}.Example`;
    assert.throws(
      () =>
        resolveTrackingOrigin(`https://${host}`, `https://other-${n}.example`),
      undefined,
      host,
    );
  }
});
