import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('scheduled smoke retains evidence, opens an incident and never ignores an unhealthy outcome', async () => {
  const workflow = await readFile(
    new URL('../.github/workflows/production-smoke.yml', import.meta.url),
    'utf8',
  );
  assert.match(workflow, /cron: '7,22,37,52 \* \* \* \*'/);
  assert.match(workflow, /vars\.GLYPH_SMOKE_ORIGIN/);
  assert.match(workflow, /node scripts\/published-smoke\.mjs/);
  assert.match(workflow, /vars\.GLYPH_SMOKE_ADDITIONAL_ORIGINS/);
  assert.match(workflow, /-z "\$GLYPH_SMOKE_ADDITIONAL_ORIGINS"/);
  assert.match(workflow, /actions\/upload-artifact@/);
  assert.match(workflow, /issues\.create\(/);
  assert.match(workflow, /state: 'closed'/);
  assert.match(
    workflow,
    /steps\.probe\.outcome != 'success'[\s\S]*run: exit 1/,
  );
  assert.doesNotMatch(workflow, /contents: write/);
});
