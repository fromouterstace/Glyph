import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extensionConnectionOrigin,
  PUBLISHED_GLYPH_ORIGIN,
  validTrackingOrigin,
} from '../artifacts/glyph/src/lib/tracking-origin.ts';
import { resolveTrackingOrigin } from '../artifacts/api-server/src/lib/tracking-origin.ts';

for (const [value, valid] of [
  ['', true],
  ['   ', true],
  ['https://glyph.example', true],
  ['https://glyph.example/', true],
  ['https://glyph.example:8443', true],
  [' https://glyph.example/ ', true],
  ['http://glyph.example', false],
  ['javascript:alert(1)', false],
  ['https://user:pass@glyph.example', false],
  ['https://glyph.example/path', false],
  ['https://glyph.example/?query=1', false],
  ['https://glyph.example/#hash', false],
  ['not a URL', false],
  ['https://', false],
  ['https://workspace.replit.dev', false],
  ['https://localhost', false],
  ['https://127.0.0.1', false],
]) {
  test(`tracking origin policy: ${JSON.stringify(value)}`, () =>
    assert.equal(validTrackingOrigin(value), valid));
}

test('setup always copies the canonical extension origin, including from the older alias', () => {
  assert.equal(PUBLISHED_GLYPH_ORIGIN, 'https://glyph.rocks');
  for (const origin of [
    'https://workspace.replit.dev',
    'http://localhost:3000',
    'https://glyph-mail.replit.app',
    'https://glyph.example',
    'https://glyph.rocks',
  ])
    assert.equal(extensionConnectionOrigin(origin), PUBLISHED_GLYPH_ORIGIN);
});

test('server uses only the public origin of the connection that owns the database', () => {
  assert.equal(
    resolveTrackingOrigin('https://glyph.example'),
    'https://glyph.example',
  );
  assert.equal(
    resolveTrackingOrigin('https://glyph.example', 'https://glyph.example/'),
    'https://glyph.example',
  );
  assert.equal(
    validTrackingOrigin('https://glyph.example/', 'https://glyph.example'),
    true,
  );
  assert.equal(
    validTrackingOrigin('https://other.example', 'https://glyph.example'),
    false,
  );
});

test('server blocks preview and cross-database tracking even for older extensions', () => {
  for (const [origin, configured] of [
    [undefined, ''],
    ['https://preview.replit.dev', ''],
    ['https://preview.replit.dev', PUBLISHED_GLYPH_ORIGIN],
    [PUBLISHED_GLYPH_ORIGIN, 'https://preview.replit.dev'],
    ['https://glyph.example', 'https://other.example'],
    ['https://localhost', ''],
    ['http://glyph.example', ''],
    ['https://glyph.example/path', ''],
    ['https://glyph.example', 'https://user:pass@glyph.example'],
  ])
    assert.throws(
      () => resolveTrackingOrigin(origin, configured),
      /published Glyph/,
    );
});
