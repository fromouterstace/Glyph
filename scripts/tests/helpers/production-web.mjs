import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createProductionApp } from '../../../artifacts/glyph/server/app.mjs';
import { extensionZip } from './extension-archive.mjs';

export async function productionWebFixture(t, basePath = '/') {
  const root = await mkdtemp(join(tmpdir(), 'glyph-web-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'assets'));
  await mkdir(join(root, '.git'));
  const files = {
    'index.html': `<html><div id="root"></div><script type="module" src="${basePath}assets/app-abcdefgh.js"></script></html>`,
    'assets/app-abcdefgh.js': 'export const ready=true;',
    'assets/app-abcdefgh.css': 'body{color:black}',
    'assets/private.js.map': '{"synthetic":"source"}',
    'glyph-extension.zip': extensionZip(),
    '.env': 'synthetic-private',
    '.git/config': 'synthetic-private-config',
    'package.json': '{"synthetic":"private"}',
    credentials: 'synthetic-private-extensionless',
    'assets/package.json': '{"synthetic":"private"}',
    'server.mjs': 'synthetic-private-server',
    'favicon.svg': '<svg></svg>',
    'logo.svg': '<svg></svg>',
    'robots.txt': 'User-agent: *',
  };
  for (const [name, bytes] of Object.entries(files))
    await writeFile(join(root, name), bytes);
  const server = createServer(createProductionApp({ root, basePath }));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(
    () =>
      new Promise((resolve) => {
        server.close(resolve);
        server.closeIdleConnections();
      }),
  );
  const origin = `http://127.0.0.1:${server.address().port}`;
  return { root, origin, fetch: (path, init) => fetch(origin + path, init) };
}
