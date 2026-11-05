import test from 'node:test';
import assert from 'node:assert/strict';
import {
  escapeHtml,
  extractUrls,
  trackedEmailHtml,
} from '../artifacts/api-server/src/lib/email-content.ts';

const base = 'https://glyph.example';
const message = {
  body: 'Hello',
  pixelToken: 'a'.repeat(48),
  trackOpens: true,
  trackClicks: true,
};

test('email content escapes all HTML metacharacters', () => {
  assert.equal(
    escapeHtml('<script>"&\'</script>'),
    '&lt;script&gt;&quot;&amp;&#39;&lt;/script&gt;',
  );
  const html = trackedEmailHtml(
    { ...message, body: '<script>alert("x")</script>' },
    base,
    [],
  );
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
});

test('URL extraction removes punctuation and duplicates and rejects credentials', () => {
  assert.deepEqual(
    extractUrls(
      'https://example.org/a. https://example.org/a https://user:pass@example.org/ http://example.org/b!',
    ),
    ['https://example.org/a', 'http://example.org/b'],
  );
});

test('URL extraction remains bounded', () => {
  assert.equal(
    extractUrls(
      Array.from({ length: 110 }, (_, i) => `https://example.org/${i}`).join(
        ' ',
      ),
    ).length,
    100,
  );
});

test('overlapping URLs are rewritten once, longest first', () => {
  const urls = ['https://example.org/a', 'https://example.org/a/b?q=1&x=2'];
  const html = trackedEmailHtml({ ...message, body: urls.join(' ') }, base, [
    { url: urls[0], token: 'short' },
    { url: urls[1], token: 'long' },
  ]);
  assert.match(html, /href="https:\/\/glyph.example\/api\/glyph\/l\/short"/);
  assert.match(html, /href="https:\/\/glyph.example\/api\/glyph\/l\/long"/);
  assert.match(html, /a\/b\?q=1&amp;x=2<\/a>/);
  assert.equal((html.match(/<a /g) ?? []).length, 2);
  assert.doesNotMatch(html, /<a[^>]*<a/);
});

test('repeated occurrences reuse their link token', () => {
  const html = trackedEmailHtml(
    { ...message, body: 'https://example.org https://example.org' },
    base,
    [{ url: 'https://example.org', token: 'same' }],
  );
  assert.equal(
    (html.match(/href="https:\/\/glyph.example\/api\/glyph\/l\/same"/g) ?? [])
      .length,
    2,
  );
});

test('open tracking adds exactly one pixel and the disclosure', () => {
  const html = trackedEmailHtml(message, base, []);
  assert.equal((html.match(/<img /g) ?? []).length, 1);
  assert.ok(html.includes(`${base}/api/glyph/t/${message.pixelToken}.gif`));
  assert.match(html, /engagement tracking/);
});

test('disabling tracking emits no pixel or tracking disclosure', () => {
  const html = trackedEmailHtml(
    {
      ...message,
      body: 'https://example.org',
      trackOpens: false,
      trackClicks: false,
    },
    base,
    [],
  );
  assert.doesNotMatch(html, /<img |engagement tracking|\/api\/glyph\//);
  assert.match(html, /href="https:\/\/example.org"/);
});

test('click-only tracking never implies a pixel load', () => {
  const html = trackedEmailHtml({ ...message, trackOpens: false }, base, []);
  assert.doesNotMatch(html, /<img /);
  assert.match(html, /engagement tracking/);
});
