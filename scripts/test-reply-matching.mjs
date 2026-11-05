import test from 'node:test';
import assert from 'node:assert/strict';
import {
  matchReply,
  messageIds,
} from '../artifacts/api-server/src/lib/reply-matching.ts';

const mailbox = 'sales@example.com';
const original = {
  id: 'outbound-1',
  rfcMessageId: '<outbound-1@example.com>',
  recipientEmail: 'recipient@outlook.com',
  sentAt: new Date(1000),
};
function reply({
  sender = 'recipient@outlook.com',
  headers = [],
  labels = ['INBOX'],
  at = '2000',
} = {}) {
  return {
    id: 'incoming-1',
    internalDate: at,
    labelIds: labels,
    payload: {
      mimeType: 'multipart/alternative',
      headers: [
        { name: 'From', value: `"${sender}" <${sender}>` },
        { name: 'To', value: `"${mailbox}" <${mailbox}>` },
        { name: 'In-Reply-To', value: original.rfcMessageId },
        ...headers,
      ],
    },
  };
}

test('replies from every original To, Cc and Bcc participant match the same message', () => {
  const shared = {
    ...original,
    toEmails: [original.recipientEmail, 'second@yahoo.com'],
    ccEmails: ['cc@icloud.com'],
    bccEmails: ['hidden@custom.example'],
  };
  for (const sender of [
    ...shared.toEmails,
    ...shared.ccEmails,
    ...shared.bccEmails,
  ])
    assert.equal(
      matchReply(reply({ sender }), [shared], mailbox)?.id,
      original.id,
    );
  assert.equal(
    matchReply(reply({ sender: 'stranger@example.com' }), [shared], mailbox),
    null,
  );
});
test("matches standard replies independently of the recipient's email service", () => {
  for (const sender of [
    'recipient@outlook.com',
    'recipient@yahoo.com',
    'recipient@icloud.com',
    'recipient@gmail.com',
    'recipient@custom.example',
  ]) {
    const outbound = { ...original, recipientEmail: sender };
    assert.equal(
      matchReply(reply({ sender }), [outbound], mailbox)?.id,
      original.id,
      sender,
    );
  }
});
test('does not need a Gmail conversation ID or a matching subject', () => {
  const incoming = reply({
    headers: [{ name: 'Subject', value: 'Entirely different subject' }],
  });
  incoming.threadId = 'different-gmail-thread';
  assert.equal(matchReply(incoming, [original], mailbox)?.id, original.id);
});
test('supports References-only replies and folded header whitespace', () => {
  const incoming = reply();
  incoming.payload.headers = incoming.payload.headers.filter(
    (h) => h.name !== 'In-Reply-To',
  );
  incoming.payload.headers.push({
    name: 'References',
    value: '<earlier@elsewhere.example>\r\n\t<outbound-1@example.com>',
  });
  assert.equal(matchReply(incoming, [original], mailbox)?.id, original.id);
});
test('attributes one reply to the nearest tracked ancestor, not every campaign email', () => {
  const second = {
    ...original,
    id: 'outbound-2',
    rfcMessageId: '<outbound-2@example.com>',
    sentAt: new Date(1500),
  };
  const incoming = reply();
  incoming.payload.headers = incoming.payload.headers.filter(
    (h) => h.name !== 'In-Reply-To',
  );
  incoming.payload.headers.push({
    name: 'References',
    value: `${original.rfcMessageId} ${second.rfcMessageId}`,
  });
  assert.equal(
    matchReply(incoming, [original, second], mailbox)?.id,
    second.id,
  );
});
test('prefers an explicit direct parent over a References ancestor', () => {
  const second = {
    ...original,
    id: 'outbound-2',
    rfcMessageId: '<outbound-2@example.com>',
    sentAt: new Date(1500),
  };
  const incoming = reply({
    headers: [
      {
        name: 'References',
        value: `${original.rfcMessageId} ${second.rfcMessageId}`,
      },
    ],
  });
  assert.equal(
    matchReply(incoming, [original, second], mailbox)?.id,
    original.id,
  );
});
test('same-subject email without reference headers is not a detected reply', () => {
  const incoming = reply();
  incoming.payload.headers = incoming.payload.headers.filter(
    (h) => h.name !== 'In-Reply-To',
  );
  incoming.payload.headers.push({ name: 'Subject', value: 'Re: Proposal' });
  assert.equal(matchReply(incoming, [original], mailbox), null);
});
test('an unrelated message, wrong sender, wrong recipient or earlier timestamp cannot count', () => {
  const unknown = reply();
  unknown.payload.headers[2].value = '<unrelated@example.com>';
  assert.equal(matchReply(unknown, [original], mailbox), null);
  assert.equal(
    matchReply(reply({ sender: 'attacker@example.com' }), [original], mailbox),
    null,
  );
  const wrongTo = reply();
  wrongTo.payload.headers[1].value = 'other@example.com';
  assert.equal(matchReply(wrongTo, [original], mailbox), null);
  assert.equal(matchReply(reply({ at: '500' }), [original], mailbox), null);
  assert.equal(
    matchReply(
      reply({ at: undefined }),
      [{ ...original, sentAt: null }],
      mailbox,
    ),
    null,
  );
});
test('sender followups and draft responses never count as recipient replies', () => {
  assert.equal(
    matchReply(
      reply({ sender: mailbox }),
      [{ ...original, recipientEmail: mailbox }],
      mailbox,
    ),
    null,
  );
  assert.equal(
    matchReply(reply({ labels: ['SENT'] }), [original], mailbox),
    null,
  );
  assert.equal(
    matchReply(reply({ labels: ['DRAFT'] }), [original], mailbox),
    null,
  );
});
test('out-of-office, bulk mail and delivery reports do not count as human replies', () => {
  for (const header of [
    { name: 'Auto-Submitted', value: 'auto-replied' },
    { name: 'Auto-Submitted', value: 'auto-generated' },
    { name: 'Precedence', value: 'bulk' },
    { name: 'X-Autoreply', value: 'yes' },
    { name: 'X-Autorespond', value: 'yes' },
    {
      name: 'Content-Type',
      value: 'multipart/report; report-type=delivery-status',
    },
  ])
    assert.equal(
      matchReply(reply({ headers: [header] }), [original], mailbox),
      null,
      header.name,
    );
  const report = reply();
  report.payload.mimeType = 'multipart/report';
  assert.equal(matchReply(report, [original], mailbox), null);
  assert.equal(
    matchReply(
      reply({ headers: [{ name: 'Auto-Submitted', value: 'no' }] }),
      [original],
      mailbox,
    )?.id,
    original.id,
  );
});
test('address-like display names cannot impersonate the recipient', () => {
  const incoming = reply();
  incoming.payload.headers[0].value =
    '"recipient@outlook.com" <different@example.com>';
  assert.equal(matchReply(incoming, [original], mailbox), null);
});
test('message ID matching uses whole IDs, not substrings', () => {
  const incoming = reply();
  incoming.payload.headers[2].value = '<prefix-outbound-1@example.com>';
  assert.equal(matchReply(incoming, [original], mailbox), null);
  assert.deepEqual(messageIds('<a@example.com> <b@example.com>'), [
    'a@example.com',
    'b@example.com',
  ]);
});
