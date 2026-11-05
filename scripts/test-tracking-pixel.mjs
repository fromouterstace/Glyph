import test from 'node:test';
import assert from 'node:assert/strict';
import { transparentGif } from '../artifacts/api-server/src/lib/tracking-pixel.ts';

function codesFromOnePixelGif(data) {
  assert.equal(data[37], 2, 'minimum LZW code size');
  const byteCount = data[38];
  const bits = [...data.subarray(39, 39 + byteCount)].flatMap((byte) =>
    Array.from({ length: 8 }, (_, bit) => (byte >> bit) & 1),
  );
  const codes = [];
  for (let i = 0; i + 2 < bits.length; i += 3) {
    codes.push(bits[i] | (bits[i + 1] << 1) | (bits[i + 2] << 2));
    if (codes.at(-1) === 5) break;
  }
  return codes;
}

test('tracking GIF is a transparent 1x1 GIF89a with a complete image block', () => {
  assert.equal(transparentGif.subarray(0, 6).toString(), 'GIF89a');
  assert.equal(transparentGif.readUInt16LE(6), 1);
  assert.equal(transparentGif.readUInt16LE(8), 1);
  assert.deepEqual(
    [...transparentGif.subarray(19, 27)],
    [0x21, 0xf9, 4, 1, 0, 0, 0, 0],
  );
  assert.equal(transparentGif[27], 0x2c, 'image separator');
  assert.equal(transparentGif.readUInt16LE(32), 1);
  assert.equal(transparentGif.readUInt16LE(34), 1);
  assert.equal(transparentGif.at(-2), 0, 'image data terminator');
  assert.equal(transparentGif.at(-1), 0x3b, 'GIF trailer');
});

test('the pixel LZW stream includes an explicit complete end-of-information code', () => {
  assert.deepEqual(codesFromOnePixelGif(transparentGif), [4, 0, 5]);
  assert.equal(transparentGif.length, 43);
});

test('the formerly shortened payload is rejected by the complete-code check', () => {
  const truncated = Buffer.from(
    'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
    'base64',
  );
  assert.deepEqual(codesFromOnePixelGif(truncated), [4, 0]);
  assert.equal(codesFromOnePixelGif(truncated).includes(5), false);
});
