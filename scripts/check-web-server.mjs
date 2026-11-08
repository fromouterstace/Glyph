import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { createProductionApp } from '../artifacts/glyph/server/app.mjs';
import { assertDocumentSecurity } from './lib/document-security.mjs';
import { checkSmokeAssets, entryAssets } from './lib/smoke-assets.mjs';
import { assertExtensionArchive } from './lib/extension-archive.mjs';
import { pages } from './lib/smoke-checks.mjs';

const basePath = process.env.BASE_PATH || '/';
const server = createServer(
  createProductionApp({ root: process.argv[2], basePath }),
);
try {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  const read = async (path, status) => {
    const response = await fetch(origin + path, {
      redirect: 'manual',
      signal: AbortSignal.timeout(5_000),
    });
    assert.equal(response.status, status, `${path}: unexpected status`);
    return {
      response,
      body: Buffer.from(await response.arrayBuffer()),
      done: () => {},
    };
  };
  let shell;
  for (const path of [...pages, '/index.html']) {
    const target = basePath + path.slice(1);
    const result = await read(target, 200);
    assertDocumentSecurity(result.response.headers, target);
    assert.match(result.body.toString(), /id=["']root["']/);
    const head = await fetch(origin + target, {
      method: 'HEAD',
      signal: AbortSignal.timeout(5_000),
    });
    assert.equal(head.status, 200);
    assertDocumentSecurity(head.headers, target);
    if (path === '/') shell = result.body.toString();
  }
  await checkSmokeAssets(entryAssets(shell, origin), read);
  const zip = await read(`${basePath}glyph-extension.zip`, 200);
  assertExtensionArchive(zip.body);
  await read(`${basePath}assets/missing-page.js`, 404);
  await read(`${basePath}api/__clerk/v1/environment`, 404);
  console.log(
    'Production web HTTP gate passed: document headers, routes, assets and extension ZIP.',
  );
} finally {
  await new Promise((resolve) => {
    server.close(resolve);
    server.closeIdleConnections();
  });
}
