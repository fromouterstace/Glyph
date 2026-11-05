import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PUBLISHED_GLYPH_ORIGIN } from '../artifacts/glyph/src/lib/tracking-origin.ts';

test('the downloadable extension defaults to the same verified production host as setup', async () => {
  const popup = await readFile(
    new URL('../extensions/glyph-gmail/popup.html', import.meta.url),
    'utf8',
  );
  assert.ok(popup.includes(`value="${PUBLISHED_GLYPH_ORIGIN}"`));
});
