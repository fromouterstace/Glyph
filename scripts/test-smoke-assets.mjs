import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertNoPublicSecrets,
  checkSmokeAssets,
  moduleAssets,
} from './lib/smoke-assets.mjs';

for (const [kind, synthetic] of [
  ['private key', '-----BEGIN ' + 'PRIVATE KEY-----'],
  ['Clerk server key', 'sk_' + 'test_' + 'x'.repeat(24)],
  ['Google client secret', 'GOCSPX-' + 'x'.repeat(24)],
  ['Google access token', 'ya29.' + 'x'.repeat(32)],
  ['GitHub token', 'ghp_' + 'x'.repeat(32)],
  [
    'database credentials',
    'postgresql://' + 'fixture:synthetic@db.invalid/test',
  ],
]) {
  test(`public ${kind} is rejected without printing its value`, () => {
    assert.throws(
      () =>
        assertNoPublicSecrets(`const config="${synthetic}"`, '/assets/app.js'),
      (error) =>
        error.message.includes(kind) && !error.message.includes(synthetic),
    );
  });
}

test('public Clerk keys and credential variable names are not server credentials', () => {
  assert.doesNotThrow(() =>
    assertNoPublicSecrets(
      'pk_live_public_example; VITE_CLERK_PUBLISHABLE_KEY; SESSION_SECRET',
      '/assets/app.js',
    ),
  );
});

test('a secret in a lazy JavaScript chunk fails the asset graph gate', async () => {
  const synthetic = 'sk_' + 'live_' + 'x'.repeat(24);
  const read = async (path) => ({
    response: new Response('', {
      headers: { 'content-type': 'application/javascript' },
    }),
    body: Buffer.from(
      path.endsWith('app.js')
        ? 'import("./lazy.js")'
        : `const key="${synthetic}"`,
    ),
    done: () => {},
  });
  await assert.rejects(
    checkSmokeAssets([new URL('https://glyph.example/assets/app.js')], read),
    (error) =>
      error.message.includes('Clerk server key') &&
      !error.message.includes(synthetic),
  );
});

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
