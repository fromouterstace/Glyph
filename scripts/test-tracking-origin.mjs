import test from 'node:test';
import assert from 'node:assert/strict';
import { validTrackingOrigin } from '../artifacts/glyph/src/lib/tracking-origin.ts';

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
]) {
  test(`tracking origin policy: ${JSON.stringify(value)}`, () =>
    assert.equal(validTrackingOrigin(value), valid));
}
