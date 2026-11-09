import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve, relative, isAbsolute } from 'node:path';
import {
  assertNoPublicSecrets,
  checkSmokeAssets,
  entryAssets,
} from './smoke-assets.mjs';
import { assertExtensionArchive } from './extension-archive.mjs';

export async function checkBuiltAssets(
  directory,
  base = '/',
  report = () => {},
) {
  assert.ok(directory, 'A built artifact directory is required');
  assert.match(base, /^\/(?:[^?#\\]*\/)?$/, 'Invalid artifact base path');
  const root = resolve(directory);
  const origin = 'https://build.invalid';
  const read = async (path) => {
    const url = new URL(path, origin);
    assert.ok(
      url.pathname.startsWith(base),
      'Asset escapes artifact base path',
    );
    const file = resolve(root, url.pathname.slice(base.length));
    const local = relative(root, file);
    assert.ok(
      !local.startsWith('..') && !isAbsolute(local),
      'Unsafe asset path',
    );
    const body = await readFile(file);
    return {
      body,
      response: new Response(null, {
        headers: {
          'content-type': url.pathname.endsWith('.css')
            ? 'text/css'
            : 'application/javascript',
        },
      }),
      done: () => report(url.pathname),
    };
  };
  const shell = await readFile(resolve(root, 'index.html'), 'utf8');
  assertNoPublicSecrets(shell, 'index.html');
  const assets = entryAssets(shell, origin);
  await checkSmokeAssets(assets, read);
  const manifest = assertExtensionArchive(
    await readFile(resolve(root, 'glyph-extension.zip')),
  );
  return { extensionVersion: manifest.version };
}
