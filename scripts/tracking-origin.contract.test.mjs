import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PUBLISHED_GLYPH_ORIGIN } from '../artifacts/glyph/src/lib/tracking-origin.ts';
import { CANONICAL_PUBLISHED_ORIGIN } from './lib/published-smoke.mjs';

test('the extension policy and manifest match the verified application origin', async () => {
  assert.equal(PUBLISHED_GLYPH_ORIGIN, 'https://glyph.rocks');
  assert.equal(CANONICAL_PUBLISHED_ORIGIN, PUBLISHED_GLYPH_ORIGIN);
  const [popup, policy, manifestSource] = await Promise.all([
    readFile(
      new URL('../extensions/glyph-gmail/popup.html', import.meta.url),
      'utf8',
    ),
    readFile(
      new URL('../extensions/glyph-gmail/trusted-origin.js', import.meta.url),
      'utf8',
    ),
    readFile(
      new URL('../extensions/glyph-gmail/manifest.json', import.meta.url),
      'utf8',
    ),
  ]);
  const manifest = JSON.parse(manifestSource);
  assert.ok(popup.includes('id="origin" type="url" readonly'));
  assert.ok(
    policy.includes(`const publishedOrigin = '${PUBLISHED_GLYPH_ORIGIN}'`),
  );
  assert.deepEqual(manifest.optional_host_permissions, [
    `${PUBLISHED_GLYPH_ORIGIN}/*`,
  ]);
});
