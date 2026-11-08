import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createProductionApp } from '../artifacts/glyph/server/app.mjs';
import { productionWebFixture } from './tests/helpers/production-web.mjs';
import { assertDocumentSecurity } from './lib/document-security.mjs';
import { assertExtensionArchive } from './lib/extension-archive.mjs';
import { pages } from './lib/smoke-checks.mjs';

test('real production GET and HEAD document responses carry every security policy on both hosts', async (t) => {
  const web = await productionWebFixture(t);
  for (const host of ['glyph.rocks', 'glyph-mail.replit.app']) {
    for (const path of [...pages, '/index.html', '/sign-in/sso-callback']) {
      for (const method of ['GET', 'HEAD']) {
        const response = await web.fetch(path, { method, headers: { host } });
        assert.equal(response.status, 200);
        assertDocumentSecurity(response.headers, path);
        assert.equal(response.headers.get('x-powered-by'), null);
        const body = await response.text();
        if (method === 'GET') assert.match(body, /id="root"/);
        else assert.equal(body, '');
      }
    }
  }
});

test('hashed JS and CSS retain correct types and immutable caching; downloads remain usable', async (t) => {
  const web = await productionWebFixture(t);
  for (const [path, type] of [
    ['/assets/app-abcdefgh.js', /javascript/],
    ['/assets/app-abcdefgh.css', /text\/css/],
  ]) {
    const response = await web.fetch(path);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), type);
    assert.equal(
      response.headers.get('cache-control'),
      'public, max-age=31536000, immutable',
    );
    assert.ok((await response.arrayBuffer()).byteLength);
  }
  const zip = await web.fetch('/glyph-extension.zip');
  assert.equal(zip.headers.get('cache-control'), 'no-store');
  assertExtensionArchive(Buffer.from(await zip.arrayBuffer()));
});

test('missing assets, API routes, source maps, hidden files and encoded traversal never return the shell', async (t) => {
  const web = await productionWebFixture(t);
  for (const path of [
    '/assets/missing.js',
    '/assets/missing',
    '/api/glyph/messages',
    '/api/__clerk/v1/environment',
    '/api/glyph/gmail/oauth/callback',
    '/assets/private.js.map',
    '/.env',
    '/%2eenv',
    '/%2e%2e%2f.env',
    '/.git/config',
    '/missing.zip',
  ]) {
    const response = await web.fetch(path);
    assert.equal(response.status, 404, path);
    assert.equal(response.headers.get('x-frame-options'), 'DENY');
    assert.doesNotMatch(
      await response.text(),
      /id="root"|synthetic-private|synthetic.*source/,
    );
  }
  assert.equal((await web.fetch('/%ZZ')).status, 400);
  const post = await web.fetch('/emails', { method: 'POST' });
  assert.equal(post.status, 405);
  assert.equal(post.headers.get('allow'), 'GET, HEAD');
});

test('nonroot artifact paths work without serving the shell outside that prefix', async (t) => {
  const web = await productionWebFixture(t, '/glyph/');
  for (const path of ['/glyph/', '/glyph/emails/message-id', '/glyph/gmail']) {
    const response = await web.fetch(path);
    assert.equal(response.status, 200);
    assertDocumentSecurity(response.headers, path);
    assert.match(await response.text(), /src="\/glyph\/assets/);
  }
  assert.equal((await web.fetch('/emails')).status, 404);
  assert.equal((await web.fetch('/glyph/assets/app-abcdefgh.js')).status, 200);
  assert.throws(
    () => createProductionApp({ root: web.root, basePath: 'invalid' }),
    /base path/,
  );
});

test('deployment and build commands cannot silently revert to headerless static serving', async () => {
  const artifact = await readFile(
    new URL(
      '../artifacts/glyph/.replit-artifact/artifact.toml',
      import.meta.url,
    ),
    'utf8',
  );
  assert.doesNotMatch(
    artifact,
    /serve\s*=\s*"static"|publicDir\s*=|production\.rewrites/,
  );
  assert.match(artifact, /node",\s*"artifacts\/glyph\/server\/start\.mjs/);
  assert.match(
    artifact,
    /\[services\.development\]\s+run = "pnpm --filter @workspace\/glyph run dev"/,
  );
  const { scripts } = JSON.parse(
    await readFile(
      new URL('../artifacts/glyph/package.json', import.meta.url),
      'utf8',
    ),
  );
  assert.equal(scripts.serve, 'node server/start.mjs');
  assert.match(
    scripts['build:artifact'],
    /&& node ..\/..\/scripts\/check-web-server\.mjs dist\/public$/,
  );
});
