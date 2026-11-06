import test from 'node:test';
import assert from 'node:assert/strict';
import {
  messageHtml,
  richLinkUrls,
  sanitizeEmailHtml,
} from '../artifacts/api-server/src/lib/email-html.ts';
import { trackedEmailHtml } from '../artifacts/api-server/src/lib/email-content.ts';
import { mimeMessage } from '../artifacts/api-server/src/lib/mime-message.ts';
import {
  validateAttachmentInput,
  validateAttachmentTotal,
} from '../artifacts/api-server/src/lib/composer-policy.ts';

test('rich email preserves supported formatting and strips active content and remote images', () => {
  const clean = messageHtml(
    '<p style="text-align:center"><strong>Bold</strong><em>Italic</em><u>Underline</u><span style="font-family:Georgia;font-size:18px;color:#123456;background:url(https://evil.invalid)">font</span></p><script>alert(1)</script><img src=x onerror=evil()><iframe src=x></iframe>',
  );
  assert.match(
    clean,
    /<strong>Bold<\/strong><em>Italic<\/em><u>Underline<\/u>/,
  );
  assert.match(clean, /font-size:18px/);
  assert.match(clean, /font-family:Georgia/);
  assert.match(clean, /text-align:center/);
  assert.doesNotMatch(clean, /script|iframe|img|onerror|background|evil|alert/);
});
test('unsafe URLs are stripped but ordinary and mailto links survive', () => {
  const html = sanitizeEmailHtml(
    '<a href="javascript:alert(1)" onclick="bad()">one</a><a href="//evil.invalid">two</a><a href="https://user:password@example.org">three</a><a href="broken">four</a><a href="mailto:sender@example.org">mail</a><a href="https://example.org/a">web</a><a>empty</a>',
  );
  assert.doesNotMatch(html, /javascript|onclick|evil|password|href="broken"/);
  assert.match(html, /href="mailto:sender@example.org"/);
  assert.match(html, /href="https:\/\/example.org\/a"/);
});
test('rich links are bounded, deduplicated and do not treat link labels as destinations', () => {
  assert.deepEqual(richLinkUrls(), []);
  assert.deepEqual(
    richLinkUrls(
      '<a href="https://example.org">Offer</a><a href="https://example.org">Again</a><a href="mailto:a@b.com">Mail</a><a>Empty</a><a href="bad">Bad</a>',
    ),
    ['https://example.org'],
  );
  assert.equal(
    richLinkUrls(
      Array.from(
        { length: 110 },
        (_, i) => `<a href="https://example.org/${i}">${i}</a>`,
      ).join(''),
    ).length,
    100,
  );
});
test('rich links rewrite destinations once while preserving labels, formatting and one pixel', () => {
  const input = {
    body: 'View offer',
    bodyHtml:
      '<p><a href="https://example.org/offer"><strong>View offer</strong></a></p>',
    trackClicks: true,
    trackOpens: true,
    pixelToken: 'a'.repeat(48),
  };
  const links = [{ url: 'https://example.org/offer', token: 'click-token' }];
  const html = trackedEmailHtml(input, 'https://glyph.example', links);
  assert.match(
    html,
    /href="https:\/\/glyph.example\/api\/glyph\/l\/click-token"><strong>View offer<\/strong>/,
  );
  assert.equal((html.match(/<img /g) ?? []).length, 1);
  const disabled = trackedEmailHtml(
    { ...input, trackClicks: false, trackOpens: false },
    'https://glyph.example',
    links,
  );
  assert.doesNotMatch(disabled, /click-token|<img/);
  assert.match(disabled, /href="https:\/\/example.org\/offer"/);
});
test('empty legacy HTML remains optional and oversized rich content fails explicitly', () => {
  assert.equal(messageHtml(), null);
  assert.equal(messageHtml(''), null);
  assert.throws(() => messageHtml('x'.repeat(50001)), /too long/);
});
test('formatted bare URLs remain tracked without nesting links or changing query-string labels', () => {
  const url = 'https://example.org/a?x=1&y=2';
  const escaped = 'https://example.org/a?x=1&amp;y=2';
  const html = trackedEmailHtml(
    {
      body: `See ${url}`,
      bodyHtml: `<p>See ${escaped} and <a href="${escaped}"><strong>${escaped}</strong></a></p>`,
      trackOpens: false,
      trackClicks: true,
      pixelToken: '',
    },
    'https://glyph.example',
    [
      { url, token: 'tracked' },
      { url: 'https://example.org/', token: 'root' },
    ],
  );
  assert.equal(
    (
      html.match(/href="https:\/\/glyph.example\/api\/glyph\/l\/tracked"/g) ??
      []
    ).length,
    2,
  );
  assert.equal((html.match(/<a /g) ?? []).length, 2);
  assert.match(html, /<strong>https:\/\/example.org\/a\?x=1&amp;y=2<\/strong>/);
  const unsafe = sanitizeEmailHtml(
    '<p>https://example.org</p>',
    new Map([
      ['https://example.org', 'javascript:bad()'],
      ['invalid', 'https://glyph.example'],
    ]),
  );
  assert.doesNotMatch(unsafe, /<a|javascript/);
});
const mimeInput = {
  from: 'sender@example.org',
  to: 'recipient@example.org',
  subject: 'Résumé',
  body: 'Hello',
  html: '<p><strong>Hello</strong></p>',
  rfcMessageId: 'fixture@glyph.mail',
};
test('plain legacy MIME remains multipart alternative and rich HTML is encoded intact', () => {
  const raw = Buffer.from(mimeMessage(mimeInput), 'base64url').toString();
  assert.match(raw, /Content-Type: multipart\/alternative/);
  assert.doesNotMatch(raw, /multipart\/mixed/);
  assert.ok(raw.includes(Buffer.from(mimeInput.html).toString('base64')));
  assert.ok(raw.includes(Buffer.from(mimeInput.subject).toString('base64')));
  assert.ok(mimeMessage({ ...mimeInput, body: '', html: '', attachments: [] }));
});
test('attachments use multipart mixed with exact bytes and safely encoded Unicode filenames', () => {
  const bytes = Buffer.from([0, 255, 13, 10, 42]);
  const raw = Buffer.from(
    mimeMessage({
      ...mimeInput,
      attachments: [
        { name: 'résumé.pdf', contentType: 'application/pdf', content: bytes },
      ],
    }),
    'base64url',
  ).toString();
  assert.match(raw, /multipart\/mixed/);
  assert.match(raw, /multipart\/alternative/);
  assert.match(raw, /filename\*=UTF-8''r%C3%A9sum%C3%A9.pdf/);
  assert.ok(raw.includes(bytes.toString('base64')));
  const malicious = Buffer.from(
    mimeMessage({
      ...mimeInput,
      attachments: [
        {
          name: "x'\r\nBcc: attacker",
          contentType: 'text/plain',
          content: Buffer.from('safe'),
        },
      ],
    }),
    'base64url',
  ).toString();
  assert.doesNotMatch(malicious, /\r\nBcc: attacker/);
  for (const contentType of ['text/plain\r\nBcc: attacker', 'not-a-mime'])
    assert.throws(
      () =>
        mimeMessage({
          ...mimeInput,
          attachments: [{ name: 'x', contentType, content: bytes }],
        }),
      /Unsafe/,
    );
});
test('attachment policies reject unsafe names, invalid sizes and invalid media types', () => {
  const file = {
    name: 'report.pdf',
    size: 100,
    contentType: 'application/pdf',
  };
  validateAttachmentInput(file);
  for (const name of [
    '',
    'bad\nname',
    'bad\0name',
    'bad\x7fname',
    '../secret',
    'a\\b',
    'x'.repeat(181),
    'é'.repeat(100),
  ])
    assert.throws(
      () => validateAttachmentInput({ ...file, name }),
      /valid file/,
    );
  for (const size of [0, -1, 1.5, 10 * 1024 * 1024 + 1])
    assert.throws(
      () => validateAttachmentInput({ ...file, size }),
      /valid file/,
    );
  assert.throws(
    () => validateAttachmentInput({ ...file, contentType: 'text/plain; x=y' }),
    /valid file/,
  );
});
test('attachment count, duplicate, individual and combined budgets fail closed', () => {
  validateAttachmentTotal([]);
  validateAttachmentTotal([
    { id: 'a', size: 10 * 1024 * 1024 },
    { id: 'b', size: 5 * 1024 * 1024 },
  ]);
  for (const files of [
    [{ id: 'a', size: 0 }],
    [{ id: 'a', size: 10 * 1024 * 1024 + 1 }],
    [
      { id: 'a', size: 1 },
      { id: 'a', size: 1 },
    ],
    [
      { id: 'a', size: 10 * 1024 * 1024 },
      { id: 'b', size: 6 * 1024 * 1024 },
    ],
    Array.from({ length: 11 }, (_, i) => ({ id: String(i), size: 1 })),
  ])
    assert.throws(() => validateAttachmentTotal(files), /10 files/);
});
