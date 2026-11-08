import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { checkBuiltAssets } from './lib/built-assets.mjs';
import { extensionZip } from './tests/helpers/extension-archive.mjs';

async function fixture(t, base = '/') {
  const directory = await mkdtemp(join(tmpdir(), 'glyph-built-assets-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(join(directory, 'assets'));
  await writeFile(
    join(directory, 'index.html'),
    `<script src="${base}assets/app.js"></script>`,
  );
  await writeFile(join(directory, 'assets/app.js'), 'import("./page.js")');
  await writeFile(join(directory, 'assets/page.js'), 'export const page=true');
  await writeFile(join(directory, 'glyph-extension.zip'), extensionZip());
  return directory;
}

test('the built artifact gate traverses real lazy chunks under a nonroot base', async (t) => {
  const directory = await fixture(t, '/glyph/');
  const files = [];
  const result = await checkBuiltAssets(directory, '/glyph/', (file) =>
    files.push(file),
  );
  assert.equal(result.extensionVersion, '1.2.3');
  assert.deepEqual(files, ['/glyph/assets/app.js', '/glyph/assets/page.js']);
});

test('the real build CLI fails when a referenced lazy chunk is missing', async (t) => {
  const directory = await fixture(t);
  await rm(join(directory, 'assets/page.js'));
  const result = spawnSync(
    process.execPath,
    [new URL('./check-built-assets.mjs', import.meta.url).pathname, directory],
    { encoding: 'utf8', env: { ...process.env, BASE_PATH: '/' } },
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Built artifact gate failed:.*ENOENT/);
});

test('the built artifact gate rejects an invalid packaged extension', async (t) => {
  const directory = await fixture(t);
  await writeFile(join(directory, 'glyph-extension.zip'), Buffer.from('PK'));
  await assert.rejects(checkBuiltAssets(directory), /truncated/);
});
