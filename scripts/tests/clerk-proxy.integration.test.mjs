import { PassThrough, Writable } from 'node:stream';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { expect, test } from 'vitest';

import {
  clerkProxyMiddleware,
  clerkProxyOptions,
  getClerkProxyHost,
  getTrustedRequestOrigin,
  isSameTrustedOrigin,
  relayClerkResponse,
} from '../../artifacts/api-server/src/middlewares/clerkProxyMiddleware.ts';

function makeResponse() {
  const chunks = [];
  let status;
  let headers;
  const response = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(Buffer.from(chunk));
      callback();
    },
  });
  response.headersSent = false;
  response.writeHead = (code, value) => {
    status = code;
    headers = value;
    response.headersSent = true;
    return response;
  };
  return {
    response,
    chunks,
    get status() {
      return status;
    },
    get headers() {
      return headers;
    },
  };
}

function upstream(statusCode = 200, headers = {}) {
  const response = new PassThrough();
  response.statusCode = statusCode;
  response.headers = headers;
  return response;
}

test('forwarded host and protocol must each be a single valid value', () => {
  expect(
    getTrustedRequestOrigin({
      headers: {
        host: 'internal:8080',
        'x-forwarded-host': 'glyph.example',
        'x-forwarded-proto': 'https',
      },
    }),
  ).toBe('https://glyph.example');
  expect(
    getClerkProxyHost({
      headers: { host: 'glyph.example', 'x-forwarded-host': 'good,evil' },
    }),
  ).toBeUndefined();
  expect(
    getTrustedRequestOrigin({
      headers: { host: 'glyph.example', 'x-forwarded-proto': 'https,http' },
    }),
  ).toBeUndefined();
  expect(
    isSameTrustedOrigin('https://glyph.example', 'https://glyph.example'),
  ).toBe(true);
  expect(
    isSameTrustedOrigin('https://glyph.example/path', 'https://glyph.example'),
  ).toBe(false);
});

test('production origin accepts both verified published hosts directly and behind the edge', () => {
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    for (const host of ['glyph-mail.replit.app', 'glyph.rocks']) {
      for (const headers of [
        { host },
        {
          host: 'internal:8080',
          'x-forwarded-host': host,
          'x-forwarded-proto': 'https',
        },
      ]) {
        const origin = getTrustedRequestOrigin({ headers });
        expect(origin).toBe(`https://${host}`);
        expect(isSameTrustedOrigin(`https://${host}`, origin)).toBe(true);
        expect(isSameTrustedOrigin('https://attacker.invalid', origin)).toBe(
          false,
        );
      }
    }
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
  }
});

test('production origin still rejects untrusted hosts, HTTP and ambiguous forwarding', () => {
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    for (const headers of [
      { host: 'attacker.invalid' },
      { host: 'glyph.rocks.attacker.invalid' },
      { host: 'glyph.rocks:8443' },
      { host: 'glyph.rocks', 'x-forwarded-proto': 'http' },
      { host: 'glyph.rocks', 'x-forwarded-proto': 'https,http' },
      {
        host: 'glyph.rocks',
        'x-forwarded-host': 'attacker.invalid',
      },
      {
        host: 'internal',
        'x-forwarded-host': 'glyph.rocks,attacker.invalid',
      },
      {
        host: 'internal',
        'x-forwarded-host': ['glyph.rocks', 'attacker.invalid'],
      },
    ]) {
      expect(getTrustedRequestOrigin({ headers })).toBeUndefined();
    }
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
  }
});

test('Clerk upstream proxy URL preserves each verified production origin', () => {
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    const options = clerkProxyOptions('test-only-placeholder');
    for (const host of ['glyph-mail.replit.app', 'glyph.rocks']) {
      const forwarded = new Map();
      let destroyed = false;
      options.on.proxyReq(
        {
          setHeader: (name, value) => forwarded.set(name, value),
          destroy: () => {
            destroyed = true;
          },
        },
        {
          headers: {
            host: 'internal:8080',
            'x-forwarded-host': host,
            'x-forwarded-proto': 'https',
          },
        },
      );
      expect(destroyed).toBe(false);
      expect(forwarded.get('Clerk-Proxy-Url')).toBe(
        `https://${host}/api/__clerk`,
      );
      expect(forwarded.get('Clerk-Secret-Key')).toBe('test-only-placeholder');
    }
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
  }
});

test('static deployment headers keep framing, MIME, and referrer policies explicit', async () => {
  const config = await readFile(
    new URL('../../.replit', import.meta.url),
    'utf8',
  );
  for (const header of [
    'Content-Security-Policy',
    'Referrer-Policy',
    'Permissions-Policy',
    'X-Content-Type-Options',
    'X-Frame-Options',
  ])
    expect(config).toContain(`name = "${header}"`);
});

test('chunked Clerk responses are buffered with a correct length', async () => {
  const source = upstream(200, {
    'content-type': 'application/json',
    'transfer-encoding': 'chunked',
    connection: 'keep-alive',
  });
  const target = makeResponse();
  relayClerkResponse(source, { method: 'GET' }, target.response);
  source.end('{"ok":true}');
  await once(target.response, 'finish');
  expect(target.status).toBe(200);
  expect(target.headers['content-length']).toBe('11');
  expect(target.headers.connection).toBeUndefined();
  expect(Buffer.concat(target.chunks).toString()).toBe('{"ok":true}');
});

test('unknown-length Clerk response exceeding the buffer cap gets controlled 502', async () => {
  const source = upstream();
  const target = makeResponse();
  relayClerkResponse(source, { method: 'GET' }, target.response);
  source.write(Buffer.alloc(1024 * 1024 + 1));
  await once(target.response, 'finish');
  expect(target.status).toBe(502);
  expect(target.headers['content-length']).toBeGreaterThan(0);
  expect(Buffer.concat(target.chunks).toString()).toContain('too large');
});

test('known-length Clerk assets stream, and HEAD or empty statuses stay bodyless', async () => {
  const asset = upstream(200, {
    'content-length': '3',
    'content-type': 'application/javascript',
    'content-encoding': 'gzip',
    'x-powered-by': 'Express',
  });
  const assetTarget = makeResponse();
  relayClerkResponse(asset, { method: 'GET' }, assetTarget.response);
  asset.end('js!');
  await once(assetTarget.response, 'finish');
  expect(assetTarget.status).toBe(200);
  expect(assetTarget.headers['content-encoding']).toBe('gzip');
  expect(assetTarget.headers['x-powered-by']).toBeUndefined();
  expect(Buffer.concat(assetTarget.chunks).toString()).toBe('js!');

  for (const [method, status] of [
    ['HEAD', 200],
    ['GET', 204],
    ['GET', 304],
  ]) {
    const source = upstream(status, { 'content-length': '9' });
    const target = makeResponse();
    relayClerkResponse(source, { method }, target.response);
    source.end('not sent');
    await once(target.response, 'finish');
    expect(target.status).toBe(status);
    expect(target.chunks).toHaveLength(0);
    if (status === 204)
      expect(target.headers['content-length']).toBeUndefined();
  }
});

test('aborted upstream and proxy timeout produce bounded, controlled errors', async () => {
  const source = upstream();
  const target = makeResponse();
  relayClerkResponse(source, { method: 'GET' }, target.response);
  source.destroy(new Error('private upstream detail'));
  await once(target.response, 'finish');
  expect(target.status).toBe(502);
  expect(Buffer.concat(target.chunks).toString()).not.toContain(
    'private upstream detail',
  );

  const options = clerkProxyOptions('test-only-placeholder');
  expect(options.proxyTimeout).toBe(10_000);
  expect(options.timeout).toBe(15_000);
  const timedOut = makeResponse();
  options.on.error(
    Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }),
    {},
    timedOut.response,
  );
  await once(timedOut.response, 'finish');
  expect(timedOut.status).toBe(504);
});

test('production Clerk proxy rejects ambiguous headers and missing credentials', async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousSecret = process.env.CLERK_SECRET_KEY;
  process.env.NODE_ENV = 'production';
  process.env.CLERK_SECRET_KEY = 'test-only-placeholder';
  try {
    const invalid = makeResponse();
    clerkProxyMiddleware()(
      {
        headers: {
          host: 'glyph.example',
          'x-forwarded-host': 'glyph.example, attacker.invalid',
          'x-forwarded-proto': 'https',
        },
      },
      invalid.response,
      () => {},
    );
    await once(invalid.response, 'finish');
    expect(invalid.status).toBe(400);

    process.env.CLERK_SECRET_KEY = '';
    const unavailable = makeResponse();
    clerkProxyMiddleware()(
      { headers: { host: 'glyph.example' } },
      unavailable.response,
      () => {},
    );
    await once(unavailable.response, 'finish');
    expect(unavailable.status).toBe(503);
    expect(Buffer.concat(unavailable.chunks).toString()).not.toContain(
      'test-only-placeholder',
    );
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    if (previousSecret === undefined) delete process.env.CLERK_SECRET_KEY;
    else process.env.CLERK_SECRET_KEY = previousSecret;
  }
});
