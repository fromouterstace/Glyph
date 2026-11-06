import test from 'node:test';
import assert from 'node:assert/strict';
import { webRecipients } from '../artifacts/api-server/src/lib/web-recipients.ts';
import { mimeMessage } from '../artifacts/api-server/src/lib/mime-message.ts';
import {
  initialRecipients,
  recipientInput,
  recipientError,
} from '../artifacts/glyph/src/lib/composer-recipients.ts';

test('legacy drafts retain a single To and grouped drafts preserve recipient roles', () => {
  assert.deepEqual(webRecipients({ recipientEmail: 'One@example.org' }), {
    toEmails: ['one@example.org'],
    ccEmails: [],
    bccEmails: [],
  });
  const current = {
    recipientEmail: 'one@example.org',
    toEmails: ['one@example.org'],
    ccEmails: ['two@example.org'],
    bccEmails: ['hidden@example.org'],
  };
  assert.deepEqual(
    webRecipients({ recipientEmail: current.recipientEmail }, current),
    {
      toEmails: current.toEmails,
      ccEmails: current.ccEmails,
      bccEmails: current.bccEmails,
    },
  );
  assert.throws(
    () => webRecipients({ recipientEmail: 'other@example.org' }, current),
    /Include To/,
  );
  assert.deepEqual(
    webRecipients({ ...current, ccEmails: [], bccEmails: [] }, current)
      .bccEmails,
    [],
  );
});
test('recipient normalization rejects empty, duplicate, unknown-primary and over-budget groups', () => {
  for (const value of [
    {
      recipientEmail: 'a@example.org',
      toEmails: [],
      ccEmails: [],
      bccEmails: [],
    },
    {
      recipientEmail: 'a@example.org',
      toEmails: ['a@example.org'],
      ccEmails: ['A@example.org'],
    },
    { recipientEmail: 'a@example.org', toEmails: ['other@example.org'] },
    {
      recipientEmail: 'a@example.org',
      toEmails: [
        'a@example.org',
        ...Array.from({ length: 100 }, (_, i) => `${i}@example.org`),
      ],
    },
  ])
    assert.throws(() => webRecipients(value), /unique recipients/);
  assert.deepEqual(
    webRecipients({
      recipientEmail: 'hidden@example.org',
      toEmails: [],
      bccEmails: ['hidden@example.org'],
    }),
    { toEmails: [], ccEmails: [], bccEmails: ['hidden@example.org'] },
  );
});
test('MIME keeps To, Cc and sender-side Bcc separate and never promotes blind recipients', () => {
  const base = {
    from: 'sender@example.org',
    to: 'a@example.org',
    subject: 'Group fixture',
    body: 'Hello',
    html: '<p>Hello</p>',
    rfcMessageId: 'fixture@glyph.mail',
    toEmails: ['a@example.org', 'b@example.org'],
    ccEmails: ['copy@example.org'],
    bccEmails: ['hidden@example.org'],
  };
  const raw = Buffer.from(mimeMessage(base), 'base64url').toString();
  assert.match(raw, /\r\nTo: a@example.org, b@example.org\r\n/);
  assert.match(raw, /\r\nCc: copy@example.org\r\n/);
  assert.match(raw, /\r\nBcc: hidden@example.org\r\n/);
  assert.doesNotMatch(raw, /\r\n(?:To|Cc): [^\r\n]*hidden/);
  const blind = Buffer.from(
    mimeMessage({
      ...base,
      to: 'hidden@example.org',
      toEmails: [],
      ccEmails: [],
    }),
    'base64url',
  ).toString();
  assert.match(blind, /\r\nTo: undisclosed-recipients:;\r\n/);
  assert.doesNotMatch(blind, /\r\nCc:/);
  assert.throws(
    () =>
      mimeMessage({ ...base, ccEmails: ['copy@example.org\r\nInjected: bad'] }),
    /Unsafe address/,
  );
});
test('composer recipient text supports lists, Bcc-only, validation and reopen without role loss', () => {
  assert.deepEqual(initialRecipients(), { to: '', cc: '', bcc: '' });
  assert.equal(
    initialRecipients({ recipientEmail: 'legacy@example.org' }).to,
    'legacy@example.org',
  );
  const text = {
    to: 'ONE@example.org; two@example.org',
    cc: 'copy@example.org',
    bcc: 'hidden@example.org',
  };
  const input = recipientInput(text);
  assert.deepEqual(input.toEmails, ['one@example.org', 'two@example.org']);
  assert.equal(initialRecipients(input).bcc, text.bcc);
  assert.equal(recipientError(text), null);
  assert.equal(
    recipientError({ to: '', cc: '', bcc: 'hidden@example.org' }),
    null,
  );
  assert.match(recipientError({ to: '', cc: '', bcc: '' }), /at least one/);
  assert.match(recipientError({ ...text, bcc: 'ONE@example.org' }), /repeat/);
  assert.match(
    recipientError({ ...text, cc: 'bad address' }),
    /email addresses/,
  );
  assert.match(
    recipientError({
      ...text,
      to: Array.from({ length: 101 }, (_, i) => `${i}@example.org`).join(','),
    }),
    /100 recipients/,
  );
});

test('large recipient lists use folded MIME headers instead of oversized physical lines', () => {
  const toEmails = Array.from(
    { length: 100 },
    (_, i) => `recipient-${i}@example.org`,
  );
  const raw = Buffer.from(
    mimeMessage({
      from: 'sender@example.org',
      to: toEmails[0],
      toEmails,
      subject: 'Large group',
      body: 'Hello',
      html: '<p>Hello</p>',
      rfcMessageId: 'large@glyph.mail',
    }),
    'base64url',
  ).toString();
  assert.ok(raw.includes(',\r\n '));
  assert.ok(
    raw
      .split('\r\n\r\n')[0]
      .split('\r\n')
      .every((line) => Buffer.byteLength(line) <= 998),
  );
  const unfolded = raw.replace(/\r\n[ \t]+/g, ' ');
  assert.ok(unfolded.includes(`To: ${toEmails.join(', ')}`));
});
