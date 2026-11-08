import assert from 'node:assert/strict';

export function entryAssets(shell, origin) {
  const assets = [
    ...shell.matchAll(
      /<(?:script|link)\b[^>]*(?:src|href)=["']([^"']+)["'][^>]*>/gi,
    ),
  ]
    .filter(
      ([tag]) => /^<script/i.test(tag) || /rel=["']stylesheet["']/i.test(tag),
    )
    .map(([, path]) => new URL(path, origin))
    .filter((url) => url.origin === origin);
  assert.ok(
    assets.some((url) => /\.(?:[cm]?js|tsx?)(?:$|\?)/.test(url.pathname)),
    'No local JavaScript entry found',
  );
  return assets;
}

export function moduleAssets(source, parent) {
  const paths = [
    ...source.matchAll(
      /(?:\bfrom\s*|\bimport\s*(?:\(\s*)?)["']([^"']+\.(?:[cm]?js|css)(?:\?[^"']*)?)["']/g,
    ),
    // Vite's dynamic preloader lists lazy CSS/JS relative to the build root.
    ...source.matchAll(/["']((?:\.\/)?assets\/[^"']+\.(?:js|css))["']/g),
  ].map((match) => match[1]);
  return paths
    .filter((path) => /^(?:\.{0,2}\/|assets\/)/.test(path))
    .map(
      (path) =>
        new URL(
          path.replace(/^\.\/assets\//, 'assets/'),
          /^(?:\.\/)?assets\//.test(path) &&
            parent.pathname.includes('/assets/')
            ? new URL('../', parent)
            : parent,
        ),
    )
    .filter((url) => url.origin === parent.origin);
}

export async function checkSmokeAssets(entries, read) {
  const pending = [...entries];
  const visited = new Set();
  let bytes = 0;
  while (pending.length) {
    const asset = pending.shift();
    if (visited.has(asset.href)) continue;
    visited.add(asset.href);
    assert.ok(visited.size <= 256, 'Asset graph exceeds smoke safety budget');
    const result = await read(asset.pathname + asset.search, 200);
    const css = asset.pathname.endsWith('.css');
    assert.match(
      result.response.headers.get('content-type') ?? '',
      css ? /text\/css/i : /(?:javascript|ecmascript)/i,
      `${asset.pathname}: wrong asset type`,
    );
    assert.ok(result.body.length > 0, 'Empty asset');
    bytes += result.body.length;
    assert.ok(
      bytes <= 15 * 1024 * 1024,
      'Asset bytes exceed smoke safety budget',
    );
    const source = result.body.toString();
    assert.doesNotMatch(source, /^\s*(?:<!doctype html|<html)/i);
    // Dev TSX imports are transformed by Vite on demand; bundled JS gives
    // smoke a bounded, inspectable production dependency graph.
    if (!css && asset.pathname.endsWith('.js'))
      pending.push(...moduleAssets(source, asset));
    result.done();
  }
}
