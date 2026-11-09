import assert from 'node:assert/strict';

const credentialPatterns = [
  [
    'private key',
    /-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/,
  ],
  ['Clerk server key', /\bsk_(?:live|test)_[A-Za-z0-9]{20,}\b/],
  ['Google client secret', /\bGOCSPX-[A-Za-z0-9_-]{20,}\b/],
  ['Google access token', /\bya29\.[A-Za-z0-9_-]{30,}\b/],
  [
    'GitHub token',
    /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})\b/,
  ],
  [
    'database credentials',
    /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/[^/\s"'<>]+:[^/\s"'<>]+@/i,
  ],
];

/** Recognizable formats only: never inspect secret environment values or log matches. */
export function assertNoPublicSecrets(source, path) {
  for (const [kind, pattern] of credentialPatterns) {
    if (pattern.test(source))
      throw new Error(`${path}: recognizable ${kind} in public content`);
  }
}

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

export const CONTACT_FEATURE_CHUNKS = ['contacts', 'contact-detail'];

export async function checkSmokeAssets(
  entries,
  read,
  { requiredChunks = [] } = {},
) {
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
    assertNoPublicSecrets(source, asset.pathname);
    assert.doesNotMatch(source, /^\s*(?:<!doctype html|<html)/i);
    // Dev TSX imports are transformed by Vite on demand; bundled JS gives
    // smoke a bounded, inspectable production dependency graph.
    if (!css && asset.pathname.endsWith('.js'))
      pending.push(...moduleAssets(source, asset));
    result.done();
  }
  for (const name of requiredChunks) {
    assert.ok(
      [...visited].some((href) => {
        const file = new URL(href).pathname.split('/').at(-1);
        return file?.startsWith(`${name}-`) && file.endsWith('.js');
      }),
      `Required feature chunk is missing from the served asset graph: ${name}`,
    );
  }
}
