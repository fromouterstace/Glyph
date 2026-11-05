import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const source = fileURLToPath(new URL('./glyph-gmail/', import.meta.url));
const output = fileURLToPath(
  new URL('../artifacts/glyph/public/glyph-extension.zip', import.meta.url),
);
const crc32 = (bytes) => {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let i = 0; i < 8; i++)
      value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  }
  return (value ^ 0xffffffff) >>> 0;
};
function pngChunk(type, data) {
  const name = Buffer.from(type);
  const result = Buffer.alloc(12 + data.length);
  result.writeUInt32BE(data.length, 0);
  name.copy(result, 4);
  data.copy(result, 8);
  result.writeUInt32BE(crc32(Buffer.concat([name, data])), result.length - 4);
  return result;
}
function icon(size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const pixels = Buffer.alloc(size * (1 + size * 4));
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const accent = x > size * 0.58 && y > size * 0.58;
      const border =
        x >= size * 0.18 &&
        x < size * 0.76 &&
        y >= size * 0.18 &&
        y < size * 0.76 &&
        (x < size * 0.24 ||
          x > size * 0.7 ||
          y < size * 0.24 ||
          y > size * 0.7);
      const color = accent
        ? [217, 64, 32, 255]
        : border
          ? [247, 245, 238, 255]
          : [23, 46, 50, 255];
      pixels.set(color, y * (1 + size * 4) + 1 + x * 4);
    }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(pixels)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}
const files = [];
for (const name of (await readdir(source)).sort())
  files.push({
    name: `glyph-extension/${name}`,
    data: await readFile(`${source}/${name}`),
  });
for (const size of [16, 48, 128])
  files.push({ name: `glyph-extension/icon${size}.png`, data: icon(size) });
const local = [],
  central = [];
let offset = 0;
for (const { name, data } of files) {
  const filename = Buffer.from(name),
    crc = crc32(data);
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt32LE(crc, 14);
  header.writeUInt32LE(data.length, 18);
  header.writeUInt32LE(data.length, 22);
  header.writeUInt16LE(filename.length, 26);
  local.push(header, filename, data);
  const directory = Buffer.alloc(46);
  directory.writeUInt32LE(0x02014b50, 0);
  directory.writeUInt16LE(20, 4);
  directory.writeUInt16LE(20, 6);
  directory.writeUInt32LE(crc, 16);
  directory.writeUInt32LE(data.length, 20);
  directory.writeUInt32LE(data.length, 24);
  directory.writeUInt16LE(filename.length, 28);
  directory.writeUInt32LE(offset, 42);
  central.push(directory, filename);
  offset += header.length + filename.length + data.length;
}
const directory = Buffer.concat(central),
  end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(files.length, 8);
end.writeUInt16LE(files.length, 10);
end.writeUInt32LE(directory.length, 12);
end.writeUInt32LE(offset, 16);
await mkdir(
  fileURLToPath(new URL('../artifacts/glyph/public/', import.meta.url)),
  { recursive: true },
);
await writeFile(output, Buffer.concat([...local, directory, end]));
console.info(
  `Packaged Glyph for Gmail: ${files.length} files, ${offset + directory.length + end.length} bytes.`,
);
