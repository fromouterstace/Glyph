import test from 'node:test';
import assert from 'node:assert/strict';
import { assertExtensionArchive } from './lib/extension-archive.mjs';
import { extensionZip } from './tests/helpers/extension-archive.mjs';

test('a complete extension archive has a readable manifest and every runtime entrypoint', () => {
  assert.equal(assertExtensionArchive(extensionZip()).version, '1.2.3');
});

test('ZIP magic alone and truncated archives do not prove a downloadable extension', () => {
  const zip = extensionZip();
  for (const bytes of [Buffer.from('504b0304', 'hex'), zip.subarray(0, -10)])
    assert.throws(() => assertExtensionArchive(bytes));
});

test('missing runtime files and invalid manifests fail archive verification', () => {
  for (const overrides of [
    { 'bridge.js': null },
    { 'gmail.css': '' },
    { 'manifest.json': '<html>fallback</html>' },
    {
      'manifest.json': JSON.stringify({
        manifest_version: 2,
        version: '1.0.0',
      }),
    },
    { '../unsafe.js': '// unsafe' },
  ])
    assert.throws(() => assertExtensionArchive(extensionZip(overrides)));
});

test('corrupted bytes and a mismatched central directory cannot pass ZIP smoke', () => {
  const zip = extensionZip();
  const body = zip.indexOf(Buffer.from('// compose'));
  zip[body] ^= 1;
  assert.throws(() => assertExtensionArchive(zip), /checksum/);
  const missingDirectory = extensionZip();
  missingDirectory.writeUInt32LE(0, missingDirectory.length - 6);
  assert.throws(() => assertExtensionArchive(missingDirectory), /bounds/);
});
