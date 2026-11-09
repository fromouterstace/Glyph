import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CONTACT_FEATURE_CHUNKS,
  checkSmokeAssets,
} from './lib/smoke-assets.mjs';

const entry = new URL('https://glyph.example/assets/main.js');
function graph(names) {
  const files = new Map([
    [
      '/assets/main.js',
      names.map((n) => `import("./${n}-hash.js");`).join('\n'),
    ],
    ...names.map((n) => [
      `/assets/${n}-hash.js`,
      'export const present = true;',
    ]),
  ]);
  return async (path) => {
    assert.ok(files.has(path), `Missing referenced asset: ${path}`);
    return {
      response: { headers: new Headers({ 'content-type': 'text/javascript' }) },
      body: Buffer.from(files.get(path)),
      done() {},
    };
  };
}
test('published contact smoke traverses and requires both actual page chunks', async () => {
  await checkSmokeAssets([entry], graph(CONTACT_FEATURE_CHUNKS), {
    requiredChunks: CONTACT_FEATURE_CHUNKS,
  });
});
for (const omitted of CONTACT_FEATURE_CHUNKS) {
  test(`a green HTML/entry response cannot hide an omitted ${omitted} chunk`, async () => {
    await assert.rejects(
      checkSmokeAssets(
        [entry],
        graph(CONTACT_FEATURE_CHUNKS.filter((n) => n !== omitted)),
        {
          requiredChunks: CONTACT_FEATURE_CHUNKS,
        },
      ),
      new RegExp(`missing.*${omitted}`),
    );
  });
}
test('an unreferenced page file does not satisfy the published feature gate', async () => {
  const read = graph(CONTACT_FEATURE_CHUNKS);
  await assert.rejects(
    checkSmokeAssets(
      [entry],
      async (path) =>
        path === entry.pathname
          ? {
              response: {
                headers: new Headers({ 'content-type': 'text/javascript' }),
              },
              body: Buffer.from('export const legacy = true;'),
              done() {},
            }
          : read(path),
      { requiredChunks: CONTACT_FEATURE_CHUNKS },
    ),
    /Required feature chunk/,
  );
});
