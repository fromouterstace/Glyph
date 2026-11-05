import test from 'node:test';
import assert from 'node:assert/strict';
import { Writable } from 'node:stream';
import pino from 'pino';
import { DrizzleQueryError } from '../lib/db/node_modules/drizzle-orm/errors.js';
import { logSafeError } from '../artifacts/api-server/src/lib/logger.ts';
import {
  serializeRequestLog,
  serializeResponseLog,
} from '../artifacts/api-server/src/lib/request-log.ts';

test('pixel request logs preserve correlation IDs but redact pixel tokens and query strings', () => {
  assert.deepEqual(
    serializeRequestLog({
      id: 'trace-glyph-001',
      method: 'GET',
      url: '/api/glyph/t/pixel-secret.gif?owner=private',
    }),
    {
      id: 'trace-glyph-001',
      method: 'GET',
      url: '/api/glyph/t/[redacted]',
    },
  );
});

test('request logs keep method and trace ID when a URL is unavailable', () => {
  assert.deepEqual(serializeRequestLog({ id: 27, method: 'HEAD' }), {
    id: 27,
    method: 'HEAD',
    url: undefined,
  });
});

test('response logs expose only the HTTP status', () => {
  assert.deepEqual(serializeResponseLog({ statusCode: 429 }), {
    statusCode: 429,
  });
});

test('database errors never write query parameters or nested causes to logs', async () => {
  const privateValues = [
    'PRIVATE_BODY_SENTINEL',
    'private@example.invalid',
    'PIXEL_TOKEN_SENTINEL',
    'DATABASE_URL_SENTINEL',
  ];
  const output = [];
  const sink = new Writable({
    write(chunk, _encoding, done) {
      output.push(chunk.toString());
      done();
    },
  });
  const logger = pino({ level: 'error', base: null }, sink);
  const error = new DrizzleQueryError(
    'INSERT INTO glyph_messages(body, pixel_token) VALUES ($1, $2)',
    privateValues.slice(0, 3),
    new Error(privateValues[3]),
  );

  logSafeError(logger, error, 'Request failed');
  await new Promise((resolve) => setImmediate(resolve));

  const serialized = output.join('');
  for (const value of privateValues) {
    assert.equal(
      serialized.includes(value),
      false,
      `${value} must not be logged`,
    );
  }
  const record = JSON.parse(serialized);
  assert.equal(record.errorType, 'Error');
  assert.equal(record.msg, 'Request failed');
  logger.flush();
});
