import test from 'node:test';
import assert from 'node:assert/strict';
import {
  presentOwnerData,
  publicMessage,
  publicEvent,
} from '../artifacts/api-server/src/lib/message-presentation.ts';

test('shared signals show an aggregate label and retain owner-visible recipient roles', () => {
  const shared = {
    ...message('shared'),
    toEmails: ['to@example.invalid'],
    ccEmails: ['cc@example.invalid'],
    bccEmails: ['hidden@example.invalid'],
  };
  const result = publicMessage(shared, []);
  assert.equal(result.recipientName, 'Shared message (3 recipients)');
  assert.deepEqual(result.bccEmails, ['hidden@example.invalid']);
  const activity = publicEvent(event('load', shared.id, 'open'), shared);
  assert.equal(activity.recipientName, 'Shared message (3 recipients)');
  assert.equal('bccEmails' in activity, false);
  const hiddenOnly = publicEvent(event('load', shared.id, 'open'), {
    ...shared,
    toEmails: [],
    ccEmails: [],
  });
  assert.equal(hiddenOnly.recipientEmail, '');
  assert.equal(hiddenOnly.recipientName, 'Bcc message');
});

const time = new Date('2026-11-04T12:00:00.000Z');
const message = (id) => ({
  id,
  ownerId: 'owner',
  recipientName: 'Recipient',
  recipientEmail: 'recipient@example.invalid',
  subject: 'Proposal',
  body: 'Hello',
  createdAt: time,
  sentAt: null,
  trackOpens: true,
  trackClicks: true,
  status: 'draft',
  deliverySource: 'web',
});
const event = (id, messageId, type, overrides = {}) => ({
  id,
  messageId,
  type,
  occurredAt: time,
  automated: false,
  source: 'Fixture',
  url: null,
  read: false,
  ...overrides,
});

test('owner presentation preserves ordering and attributes each signal to its own message', () => {
  const input = [
    event('reply', 'second', 'reply'),
    event('load', 'first', 'open'),
    event('scan', 'first', 'click', { automated: true }),
    event('click', 'first', 'click'),
  ];
  const result = presentOwnerData([message('first'), message('second')], input);
  assert.deepEqual(
    result.messages.map(({ id, opens, clicks, replies }) => ({
      id,
      opens,
      clicks,
      replies,
    })),
    [
      { id: 'first', opens: 1, clicks: 1, replies: 0 },
      { id: 'second', opens: 0, clicks: 0, replies: 1 },
    ],
  );
  assert.deepEqual(
    result.events.map((row) => row.id),
    ['reply', 'load', 'scan', 'click'],
  );
  assert.equal(result.events[0].messageId, 'second');
});

test('a message without events has zero signals and no invented activity time', () => {
  const {
    messages: [row],
  } = presentOwnerData([message('draft')], []);
  assert.deepEqual(
    [row.opens, row.clicks, row.replies, row.lastActivityAt, row.sentAt],
    [0, 0, 0, null, null],
  );
});

test('message projection never includes another message’s signals', () => {
  const row = publicMessage({ ...message('own'), sentAt: time }, [
    event('foreign', 'other', 'open'),
    event('sent', 'own', 'sent'),
    event('automatic', 'own', 'reply', { automated: true }),
  ]);
  assert.equal(row.opens + row.clicks + row.replies, 0);
  assert.equal(row.sentAt, time.toISOString());
});

test('owner presentation rejects an event with no owned parent', () => {
  assert.throws(
    () =>
      presentOwnerData([message('own')], [event('foreign', 'other', 'open')]),
    /no owned message/,
  );
});
