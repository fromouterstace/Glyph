import test from 'node:test';
import assert from 'node:assert/strict';
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
