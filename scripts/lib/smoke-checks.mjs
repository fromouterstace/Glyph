import assert from 'node:assert/strict';
import { smokeOrigin, waitForHealth } from './health-probe.mjs';

const pages = [
  '/',
  '/app',
  '/email',
  '/emails',
  '/emails/smoke-missing-message',
  '/activity',
  '/settings',
  '/gmail',
  '/system',
  '/sign-in',
  '/sign-up',
];
const protectedReads = [
  '/overview',
  '/messages',
  '/activity',
  '/settings',
  '/connection',
  '/gmail/authorization',
  '/system/access',
  '/system/summary',
  '/messages/00000000-0000-4000-8000-000000000000',
  '/attachments/00000000-0000-4000-8000-000000000000',
];

export async function runSmoke({ base, fetchImpl = fetch, report = () => {} }) {
  const origin = smokeOrigin(base);
  await waitForHealth({ base: origin, fetchImpl });
  const read = async (path, status) => {
    const started = Date.now();
    const response = await fetchImpl(new URL(path, origin), {
      redirect: 'manual',
      signal: AbortSignal.timeout(5_000),
    });
    assert.equal(response.status, status, `${path}: unexpected HTTP status`);
    assert.equal(
      response.headers.get('location'),
      null,
      `${path}: unexpected redirect`,
    );
    const body = Buffer.from(await response.arrayBuffer());
    return {
      response,
      body,
      done: () => report({ path, status, elapsedMs: Date.now() - started }),
    };
  };
  const readiness = await read('/api/readyz', 200);
  assert.deepEqual(JSON.parse(readiness.body.toString()), { status: 'ready' });
  assert.equal(readiness.response.headers.get('cache-control'), 'no-store');
  readiness.done();
  let shell;
  for (const path of pages) {
    const result = await read(path, 200);
    assert.match(
      result.response.headers.get('content-type') ?? '',
      /text\/html/i,
    );
    assert.match(result.body.toString(), /id=["']root["']/);
    if (path === '/') shell = result.body.toString();
    result.done();
  }
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
  for (const asset of new Map(assets.map((url) => [url.href, url])).values()) {
    const result = await read(asset.pathname + asset.search, 200);
    const css = asset.pathname.endsWith('.css');
    assert.match(
      result.response.headers.get('content-type') ?? '',
      css ? /text\/css/i : /(?:javascript|ecmascript)/i,
      `${asset.pathname}: wrong asset type`,
    );
    assert.ok(result.body.length > 0, 'Empty asset');
    assert.doesNotMatch(
      result.body.toString(),
      /^\s*(?:<!doctype html|<html)/i,
    );
    result.done();
  }
  const zip = await read('/glyph-extension.zip', 200);
  assert.equal(
    zip.body.subarray(0, 4).toString('hex'),
    '504b0304',
    'Extension download is not a ZIP',
  );
  zip.done();
  for (const path of protectedReads) {
    const result = await read(`/api/glyph${path}`, 401);
    assert.match(
      result.response.headers.get('content-type') ?? '',
      /application\/json/i,
    );
    assert.ok(
      JSON.parse(result.body.toString()).error,
      'Missing anonymous-access error',
    );
    result.done();
  }
  // Invalid tokens cannot create events or navigate to a customer destination.
  const pixel = await read('/api/glyph/t/smoke-invalid-token.gif', 200);
  assert.match(
    pixel.response.headers.get('content-type') ?? '',
    /^image\/gif\b/i,
  );
  assert.equal(pixel.response.headers.get('set-cookie'), null);
  assert.equal(pixel.body.length, 43);
  assert.equal(pixel.body.subarray(0, 6).toString(), 'GIF89a');
  pixel.done();
  const click = await read('/api/glyph/l/smoke-invalid-token', 404);
  click.done();
}
