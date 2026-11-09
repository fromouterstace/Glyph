import assert from 'node:assert/strict';
import { assertNoPublicSecrets } from './smoke-assets.mjs';
import { crc32 } from 'node:zlib';

function archiveFiles(bytes) {
  assert.ok(bytes.length >= 22, 'Extension ZIP is truncated');
  const end = bytes.length - 22;
  assert.equal(bytes.readUInt32LE(end), 0x06054b50, 'Missing ZIP directory');
  const count = bytes.readUInt16LE(end + 10);
  const size = bytes.readUInt32LE(end + 12);
  let offset = bytes.readUInt32LE(end + 16);
  assert.equal(offset + size, end, 'Invalid ZIP directory bounds');
  assert.ok(count > 0 && count <= 100, 'Invalid ZIP file count');
  const files = new Map();
  for (let index = 0; index < count; index++) {
    assert.ok(offset + 46 <= end, 'Truncated ZIP directory entry');
    assert.equal(bytes.readUInt32LE(offset), 0x02014b50);
    const nameLength = bytes.readUInt16LE(offset + 28);
    const extra = bytes.readUInt16LE(offset + 30);
    const comment = bytes.readUInt16LE(offset + 32);
    const next = offset + 46 + nameLength + extra + comment;
    assert.ok(next <= end, 'ZIP filename exceeds directory');
    const name = bytes
      .subarray(offset + 46, offset + 46 + nameLength)
      .toString();
    assert.match(name, /^glyph-extension\/[^/\\]+$/, 'Unsafe ZIP path');
    assert.ok(!files.has(name), 'Duplicate ZIP file');
    const local = bytes.readUInt32LE(offset + 42);
    assert.ok(local + 30 <= end - size, 'Invalid local ZIP header');
    assert.equal(bytes.readUInt32LE(local), 0x04034b50);
    assert.equal(
      bytes.readUInt16LE(offset + 10),
      0,
      'Expected stored ZIP files',
    );
    assert.equal(bytes.readUInt16LE(local + 8), 0);
    const length = bytes.readUInt32LE(offset + 24);
    assert.equal(bytes.readUInt32LE(offset + 20), length);
    assert.equal(bytes.readUInt32LE(local + 22), length);
    const start =
      local +
      30 +
      bytes.readUInt16LE(local + 26) +
      bytes.readUInt16LE(local + 28);
    assert.ok(start + length <= end - size, 'Truncated ZIP file');
    assert.equal(
      bytes.subarray(local + 30, local + 30 + nameLength).toString(),
      name,
      'ZIP filenames disagree',
    );
    const body = bytes.subarray(start, start + length);
    assert.equal(
      crc32(body),
      bytes.readUInt32LE(offset + 16),
      'ZIP checksum mismatch',
    );
    assert.equal(
      crc32(body),
      bytes.readUInt32LE(local + 14),
      'Local ZIP checksum mismatch',
    );
    files.set(name, body);
    offset = next;
  }
  assert.equal(offset, end, 'ZIP directory length mismatch');
  return files;
}

/** Validate the actual stored-file format emitted by extensions/build.mjs. */
export function assertExtensionArchive(bytes) {
  const files = archiveFiles(bytes);
  for (const [name, content] of files) {
    assertNoPublicSecrets(content.toString(), name);
  }
  const manifestBytes = files.get('glyph-extension/manifest.json');
  assert.ok(manifestBytes, 'Extension manifest is missing');
  const manifest = JSON.parse(manifestBytes.toString());
  assert.equal(manifest.manifest_version, 3);
  assert.match(manifest.version ?? '', /^\d+\.\d+\.\d+(?:\.\d+)?$/);
  const required = [
    'messaging.js',
    'gmail.js',
    'gmail.css',
    'trusted-origin.js',
    'bridge.js',
    'popup.js',
    manifest.background?.service_worker,
    manifest.action?.default_popup,
    ...Object.values(manifest.icons ?? {}),
    ...(manifest.content_scripts ?? []).flatMap((script) => [
      ...(script.js ?? []),
      ...(script.css ?? []),
    ]),
  ];
  for (const name of required) {
    assert.equal(typeof name, 'string', 'Missing extension entrypoint');
    assert.ok(
      files.get(`glyph-extension/${name}`)?.length,
      `Missing extension file: ${name}`,
    );
  }
  assert.ok(manifest.content_scripts?.length, 'Missing Gmail content script');
  return manifest;
}
