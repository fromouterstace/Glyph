import test from 'node:test';
import assert from 'node:assert/strict';
import {
  matchesNativeSend,
  normalizeNativeRecipients,
} from '../artifacts/api-server/src/lib/native-verification.ts';
const message = {
  pixelToken: 'unique-token',
  recipientEmail: 'recipient@example.com',
  createdAt: new Date(1000),
};
function candidate(overrides = {}) {
  return {
    id: 'sent-1',
    internalDate: '2000',
    payload: {
      mimeType: 'multipart/alternative',
      headers: [
        { name: 'From', value: 'Owner <owner@example.com>' },
        { name: 'To', value: 'Recipient <recipient@example.com>' },
      ],
      parts: [
        {
          mimeType: 'text/html',
          body: {
            data: Buffer.from(
              '<a href="https://glyph.example/gmail?glyph=unique-token">Sent with Glyph</a>',
            ).toString('base64url'),
          },
        },
      ],
    },
    ...overrides,
  };
}
test('confirms a matching single-recipient HTML message in Sent', () => {
  assert.equal(
    matchesNativeSend(candidate(), message, 'owner@example.com'),
    true,
  );
});

test('native recipient normalization preserves legacy callers and validates groups', () => {
  assert.deepEqual(normalizeNativeRecipients(message), {
    toEmails: [message.recipientEmail],
    ccEmails: [],
    bccEmails: [],
  });
  assert.deepEqual(
    normalizeNativeRecipients({
      ...message,
      toEmails: ['RECIPIENT@example.com', message.recipientEmail],
      ccEmails: ['cc@example.com'],
      bccEmails: [],
    }),
    {
      toEmails: [message.recipientEmail],
      ccEmails: ['cc@example.com'],
      bccEmails: [],
    },
  );
  assert.deepEqual(
    normalizeNativeRecipients({
      ...message,
      ccEmails: [message.recipientEmail],
    }),
    { toEmails: [], ccEmails: [message.recipientEmail], bccEmails: [] },
  );
  assert.deepEqual(
    normalizeNativeRecipients({
      ...message,
      bccEmails: [message.recipientEmail],
    }),
    { toEmails: [], ccEmails: [], bccEmails: [message.recipientEmail] },
  );
  for (const data of [
    { toEmails: [] },
    { toEmails: ['other@example.com'] },
    { toEmails: [message.recipientEmail], ccEmails: [message.recipientEmail] },
    {
      toEmails: [
        message.recipientEmail,
        ...Array.from({ length: 100 }, (_, i) => `person${i}@example.com`),
      ],
    },
  ])
    assert.equal(normalizeNativeRecipients({ ...message, ...data }), null);
});

test('mixed To/Cc/Bcc roles match exactly regardless of order or case', () => {
  const group = {
    ...message,
    toEmails: ['other@example.com', message.recipientEmail],
    ccEmails: ['cc@example.com'],
    bccEmails: ['hidden@example.com'],
  };
  const sent = candidate();
  sent.payload.headers[1].value = 'RECIPIENT@example.com, other@example.com';
  sent.payload.headers.push(
    { name: 'Cc', value: 'cc@example.com' },
    { name: 'Bcc', value: 'hidden@example.com' },
  );
  assert.equal(matchesNativeSend(sent, group, 'owner@example.com'), true);
  for (const name of ['To', 'Cc', 'Bcc']) {
    const changed = structuredClone(sent);
    changed.payload.headers.find((h) => h.name === name).value =
      'stranger@example.com';
    assert.equal(matchesNativeSend(changed, group, 'owner@example.com'), false);
  }
  const wrongSecond = structuredClone(sent);
  wrongSecond.payload.headers[1].value =
    'recipient@example.com, wrong@example.com';
  assert.equal(
    matchesNativeSend(wrongSecond, group, 'owner@example.com'),
    false,
  );
});

test('Cc-only and Bcc-only messages do not invent a To recipient', () => {
  for (const role of ['cc', 'bcc']) {
    const sent = candidate();
    sent.payload.headers[1].value = 'undisclosed-recipients:;';
    sent.payload.headers.push({ name: role, value: 'hidden@example.com' });
    const group = {
      ...message,
      toEmails: [],
      ccEmails: [],
      bccEmails: [],
      [role + 'Emails']: ['hidden@example.com'],
    };
    assert.equal(matchesNativeSend(sent, group, 'owner@example.com'), true);
  }
});
test("Gmail's email-shaped quoted display name is one actual recipient", () => {
  const sent = candidate();
  sent.payload.headers[1].value =
    '"recipient@example.com" <recipient@example.com>';
  assert.equal(matchesNativeSend(sent, message, 'owner@example.com'), true);
});
test('an email-shaped sender display name is one actual sender', () => {
  const sent = candidate();
  sent.payload.headers[0].value = '"owner@example.com" <owner@example.com>';
  assert.equal(matchesNativeSend(sent, message, 'owner@example.com'), true);
});
test('display-name addresses and comments are not mailbox addresses', () => {
  for (const value of [
    '"different@example.com" <recipient@example.com>',
    '"Last, First" <recipient@example.com>',
    'Recipient (other@example.com) <recipient@example.com>',
    '"Zoë Example" <RECIPIENT@example.com>',
    '"Recipient \\"Nickname\\"" <recipient@example.com>',
  ]) {
    const sent = candidate();
    sent.payload.headers[1].value = value;
    assert.equal(
      matchesNativeSend(sent, message, 'owner@example.com'),
      true,
      value,
    );
  }
});
test('a matching display name cannot disguise a different actual recipient', () => {
  const sent = candidate();
  sent.payload.headers[1].value =
    '"recipient@example.com" <different@example.com>';
  assert.equal(matchesNativeSend(sent, message, 'owner@example.com'), false);
});
test('a matching display name cannot disguise a different actual sender', () => {
  const sent = candidate();
  sent.payload.headers[0].value = '"owner@example.com" <different@example.com>';
  assert.equal(matchesNativeSend(sent, message, 'owner@example.com'), false);
});
test('two actual recipients remain rejected even when their addresses repeat', () => {
  for (const value of [
    '"recipient@example.com" <recipient@example.com>, Other <other@example.com>',
    'recipient@example.com, recipient@example.com',
  ]) {
    const sent = candidate();
    sent.payload.headers[1].value = value;
    assert.equal(matchesNativeSend(sent, message, 'owner@example.com'), false);
  }
  const sent = candidate();
  sent.payload.headers.push({ name: 'To', value: 'other@example.com' });
  assert.equal(matchesNativeSend(sent, message, 'owner@example.com'), false);
});
test('malformed recipients and group syntax fail closed', () => {
  for (const value of [
    '',
    'not an email',
    '"recipient@example.com" <>',
    '"Unclosed name <recipient@example.com>',
    'Team: recipient@example.com;',
  ]) {
    const sent = candidate();
    sent.payload.headers[1].value = value;
    assert.equal(
      matchesNativeSend(sent, message, 'owner@example.com'),
      false,
      value,
    );
  }
});
test('never attributes a marker sent to another recipient or multiple recipients', () => {
  for (const value of [
    'different@example.com',
    'recipient@example.com, other@example.com',
  ]) {
    const sent = candidate();
    sent.payload.headers[1].value = value;
    assert.equal(matchesNativeSend(sent, message, 'owner@example.com'), false);
  }
});
test('CC, BCC, wrong sender and pre-existing messages cannot confirm a draft', () => {
  for (const name of ['Cc', 'Bcc']) {
    const sent = candidate();
    sent.payload.headers.push({ name, value: 'extra@example.com' });
    assert.equal(matchesNativeSend(sent, message, 'owner@example.com'), false);
  }
  assert.equal(
    matchesNativeSend(candidate(), message, 'different@example.com'),
    false,
  );
  assert.equal(
    matchesNativeSend(
      candidate({ internalDate: '500' }),
      message,
      'owner@example.com',
    ),
    false,
  );
  assert.equal(
    matchesNativeSend(
      candidate({ internalDate: undefined }),
      message,
      'owner@example.com',
    ),
    false,
  );
});
test('plain text, token mentions and attachments are not rich-text confirmation', () => {
  for (const mimeType of ['text/plain', 'application/octet-stream']) {
    const sent = candidate();
    sent.payload.parts[0].mimeType = mimeType;
    assert.equal(matchesNativeSend(sent, message, 'owner@example.com'), false);
  }
  const sent = candidate();
  sent.payload.parts[0].body.data =
    Buffer.from('unique-token').toString('base64url');
  assert.equal(matchesNativeSend(sent, message, 'owner@example.com'), false);
});
