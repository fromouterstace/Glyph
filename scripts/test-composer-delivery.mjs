import test from 'node:test';
import assert from 'node:assert/strict';
import { composerDeliveryIssue } from '../artifacts/glyph/src/lib/composer-delivery.ts';
import { resolveTrackingOrigin } from '../artifacts/api-server/src/lib/tracking-origin.ts';

test('web composer preflight rejects preview, HTTP and missing settings without relaxing server checks', () => {
  for (const origin of [
    '',
    'http://localhost:3000',
    'https://preview.replit.dev',
    'http://glyph.example',
  ]) {
    assert.equal(composerDeliveryIssue(origin, '').kind, 'preview');
    assert.throws(
      () => resolveTrackingOrigin(origin, '', 'web'),
      /published Glyph web app/,
    );
  }
  assert.equal(composerDeliveryIssue('https://glyph.example').kind, 'settings');
  assert.equal(composerDeliveryIssue('https://glyph.example', ''), null);
  assert.equal(
    composerDeliveryIssue('https://glyph.example', 'https://glyph.example/'),
    null,
  );
  assert.equal(
    resolveTrackingOrigin('https://glyph.example', '', 'web'),
    'https://glyph.example',
  );
});
test('web errors distinguish stale tracking settings from Preview without extension-reconnection instructions', () => {
  for (const configured of [
    'https://other.example',
    'https://preview.replit.dev',
    'bad URL',
  ]) {
    assert.equal(
      composerDeliveryIssue('https://glyph.example', configured).kind,
      'settings',
    );
    assert.throws(
      () => resolveTrackingOrigin('https://glyph.example', configured, 'web'),
      /Clear the custom Tracking URL/,
    );
  }
  assert.throws(
    () => resolveTrackingOrigin('https://preview.replit.dev'),
    /reconnect the Gmail extension/,
  );
});
