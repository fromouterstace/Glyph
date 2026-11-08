import { crc32 } from 'node:zlib';

// An independent minimal ZIP fixture, not the production packager.
export function extensionZip(overrides = {}) {
  const manifest = {
    manifest_version: 3,
    version: '1.2.3',
    background: { service_worker: 'background.js' },
    action: { default_popup: 'popup.html' },
    content_scripts: [{ js: ['messaging.js', 'gmail.js'], css: ['gmail.css'] }],
  };
  const entries = {
    'manifest.json': JSON.stringify(manifest),
    'messaging.js': '// messaging',
    'gmail.js': '// compose',
    'gmail.css': 'body{}',
    'trusted-origin.js': '// origin',
    'bridge.js': '// bridge',
    'popup.js': '// popup',
    'background.js': '// background',
    'popup.html': '<html></html>',
    ...overrides,
  };
  const locals = [],
    directories = [];
  let offset = 0;
  for (const [name, value] of Object.entries(entries)) {
    if (value === null) continue;
    const filename = Buffer.from(`glyph-extension/${name}`);
    const body = Buffer.from(value);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50);
    local.writeUInt32LE(crc32(body), 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(body.length, 22);
    local.writeUInt16LE(filename.length, 26);
    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50);
    directory.writeUInt32LE(crc32(body), 16);
    directory.writeUInt32LE(body.length, 20);
    directory.writeUInt32LE(body.length, 24);
    directory.writeUInt16LE(filename.length, 28);
    directory.writeUInt32LE(offset, 42);
    locals.push(local, filename, body);
    directories.push(directory, filename);
    offset += local.length + filename.length + body.length;
  }
  const directory = Buffer.concat(directories);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(directories.length / 2, 8);
  end.writeUInt16LE(directories.length / 2, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}
