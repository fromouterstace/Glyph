import test from 'node:test';
import assert from 'node:assert/strict';
import { checkSmokeAssets, moduleAssets } from './lib/smoke-assets.mjs';

test('production imports and Vite lazy CSS resolve on the current origin and base path', () => {
  const urls = moduleAssets(
    'import{a}from"./react.js";import("./gmail.js");const deps=["assets/gmail.css"];import("https://third.example/external.js")',
    new URL('https://glyph.example/prefix/assets/index.js'),
  );
  assert.deepEqual(
    urls.map((url) => url.pathname),
    [
      '/prefix/assets/react.js',
      '/prefix/assets/gmail.js',
      '/prefix/assets/gmail.css',
    ],
  );
});

test('cyclic shared dependencies are checked once, including lazy CSS', async () => {
  const calls = [];
  const read = async (path) => {
    calls.push(path);
    return {
      response: new Response('', {
        headers: {
          'content-type': path.endsWith('.css')
            ? 'text/css'
            : 'application/javascript',
        },
      }),
      body: Buffer.from(
        path.endsWith('.css')
          ? 'body{}'
          : 'import "./app.js";const deps=["assets/page.css"]',
      ),
      done: () => {},
    };
  };
  await checkSmokeAssets(
    [new URL('https://glyph.example/assets/app.js')],
    read,
  );
  assert.deepEqual(calls, ['/assets/app.js', '/assets/page.css']);
});

test('an unbounded generated import chain is stopped by a safety budget', async () => {
  let count = 0;
  const read = async () => ({
    response: new Response('', {
      headers: { 'content-type': 'application/javascript' },
    }),
    body: Buffer.from(`import "./page${++count}.js"`),
    done: () => {},
  });
  await assert.rejects(
    checkSmokeAssets([new URL('https://glyph.example/assets/app.js')], read),
    /safety budget/,
  );
});
