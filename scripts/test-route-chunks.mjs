import test from 'node:test';
import assert from 'node:assert/strict';
import { checkRouteChunks, protectedPages } from './lib/route-chunks.mjs';

function manifest() {
  return Object.fromEntries([
    ['index.html', { isEntry: true, file: 'entry.js', imports: ['_react.js'] }],
    ['_react.js', { file: 'react.js' }],
    ...protectedPages.map((page) => [
      page,
      { isDynamicEntry: true, file: `${page}.js` },
    ]),
  ]);
}

test('accepts separately loaded routes and shared dependencies', () => {
  assert.doesNotThrow(() => checkRouteChunks(manifest()));
});

test('rejects a missing frontend entry', () => {
  const value = manifest();
  delete value['index.html'];
  assert.throws(() => checkRouteChunks(value), /entry must be present/);
});

for (const page of protectedPages) {
  test(`rejects missing lazy route ${page}`, () => {
    const value = manifest();
    delete value[page];
    assert.throws(() => checkRouteChunks(value), /must remain a lazy entry/);
  });
}

test('rejects a route eagerly imported through a shared dependency', () => {
  const value = manifest();
  value['_react.js'].imports = [protectedPages[0]];
  assert.throws(() => checkRouteChunks(value), /must not be eagerly imported/);
});

test('rejects routes collapsed into the initial bundle or each other', () => {
  const value = manifest();
  value[protectedPages[0]].file = 'entry.js';
  assert.throws(() => checkRouteChunks(value), /needs its own output chunk/);
  value[protectedPages[0]].file = value[protectedPages[1]].file;
  assert.throws(() => checkRouteChunks(value), /must not share/);
});

test('rejects a missing static dependency', () => {
  const value = manifest();
  delete value['_react.js'];
  assert.throws(() => checkRouteChunks(value), /Missing static chunk/);
});
