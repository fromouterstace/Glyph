import { beforeAll, afterAll, beforeEach, expect, test } from 'vitest';
import {
  serviceHarness,
  edge,
  json,
  mailbox,
  defaultProvider,
} from './helpers/service-harness.mjs';
import { trackedCompose } from './helpers/compose-harness.mjs';
import { messageFixture, fixtureId } from '../lib/database-fixture.mjs';

let h;
beforeAll(async () => {
  h = await serviceHarness();
});
beforeEach(() => {
  edge.now += 180_000;
  edge.proxy.mockImplementation(defaultProvider);
});
afterAll(async () => {
  await h?.close();
});

for (const source of ['web', 'gmail']) {
  test(`a ${source} link HEAD returns metadata without engagement or Gmail reads`, async () => {
    const message = await messageFixture(h.sql, {
      ownerId: h.identity(),
      source,
      status: source === 'gmail' ? 'draft' : 'sent',
    });
    const token = fixtureId().replaceAll('-', '').padStart(48, '0');
    await h.sql(
      'INSERT INTO glyph_links(id,message_id,token,url) VALUES ($1,$2,$3,$4)',
      [fixtureId(), message.id, token, 'https://example.invalid/proposal'],
    );
    const reads = edge.proxy.mock.calls.length;
    const response = await h.request(`/l/${token}`, {
      method: 'HEAD',
      redirect: 'manual',
    });
    expect([response.status, response.headers.get('location')]).toEqual([
      302,
      'https://example.invalid/proposal',
    ]);
    expect(
      (
        await h.sql('SELECT type FROM glyph_events WHERE message_id=$1', [
          message.id,
        ])
      ).rows,
    ).toEqual([]);
    expect(edge.proxy.mock.calls.length).toBe(reads);
  });
}

function reply(id, original, sentAt, sender = 'recipient@example.invalid') {
  return {
    id,
    internalDate: String(sentAt + 1000),
    labelIds: ['INBOX'],
    payload: {
      headers: [
        { name: 'From', value: sender },
        { name: 'To', value: mailbox },
        { name: 'Message-ID', value: `<${id}@outlook.example>` },
        { name: 'In-Reply-To', value: original },
      ],
    },
  };
}

async function nativeScenario(
  participants = { to: ['recipient@example.invalid'], cc: [], bcc: [] },
  replySender = 'recipient@example.invalid',
) {
  const owner = h.identity();
  const compose = await trackedCompose(h, owner, participants);
  const row = (
    await h.sql('SELECT created_at FROM glyph_messages WHERE id=$1', [
      compose.data.messageId,
    ])
  ).rows[0];
  const sentAt = row.created_at.getTime() + 1000;
  const sentId = fixtureId().replaceAll('-', '');
  const replyId = fixtureId().replaceAll('-', '');
  const original = `<${sentId}@mail.example>`;
  let incoming = false;
  edge.proxy.mockImplementation((_integration, path) => {
    if (path.includes(`/${sentId}?`))
      return json({
        id: sentId,
        internalDate: String(sentAt),
        payload: {
          mimeType: 'text/html',
          body: { data: Buffer.from(compose.html).toString('base64url') },
          headers: [
            { name: 'From', value: mailbox },
            ...Object.entries(participants)
              .filter(([, emails]) => emails.length)
              .map(([role, emails]) => ({
                name: role,
                value: emails.join(', '),
              })),
            { name: 'Message-ID', value: original },
          ],
        },
      });
    if (path.includes(`/${replyId}?`))
      return json(reply(replyId, original, sentAt, replySender));
    if (path.includes('/messages?')) {
      const query = new URL(`https://gmail.invalid${path}`).searchParams.get(
        'q',
      );
      return json({
        messages: query.startsWith('in:sent ')
          ? [{ id: sentId }]
          : incoming
            ? [{ id: replyId }]
            : [],
      });
    }
    return defaultProvider(_integration, path);
  });
  return {
    owner,
    compose,
    receive: () => {
      incoming = true;
      edge.now += 26_000;
    },
  };
}

test.each([
  ['single recipient', undefined, undefined],
  [
    'Bcc-only message with a Bcc reply',
    { to: [], cc: [], bcc: ['hidden@example.invalid'] },
    'hidden@example.invalid',
  ],
  [
    'mixed To/Cc/Bcc with a Bcc reply',
    {
      to: ['recipient@example.invalid', 'second@example.invalid'],
      cc: ['cc@example.invalid'],
      bcc: ['hidden@example.invalid'],
    },
    'hidden@example.invalid',
  ],
])(
  '%s: compose → Sent → pixel/click → reply → dashboard uses durable events',
  async (_name, participants, replySender) => {
    const f = await nativeScenario(participants, replySender);
    try {
      expect(f.compose.pixel).toBe(f.compose.data.pixelUrl);
      const sent = await (
        await h.request('/native/sync', { user: f.owner, method: 'POST' })
      ).json();
      expect(sent.confirmed).toBe(1);
      await h.request(
        new URL(f.compose.data.pixelUrl).pathname.replace('/api/glyph', ''),
        {
          headers: { 'user-agent': 'GoogleImageProxy' },
        },
      );
      await h.request(
        new URL(f.compose.data.links[0].trackingUrl).pathname.replace(
          '/api/glyph',
          '',
        ),
        { redirect: 'manual' },
      );
      f.receive();
      const synced = await (
        await h.request('/native/sync', { user: f.owner, method: 'POST' })
      ).json();
      expect(synced.repliesDetected).toBe(1);
      f.receive();
      const repeated = await (
        await h.request('/native/sync', { user: f.owner, method: 'POST' })
      ).json();
      expect(repeated.repliesDetected).toBe(0);
      const detail = await (
        await h.request(`/messages/${f.compose.data.messageId}`, {
          user: f.owner,
        })
      ).json();
      expect(detail.message.toEmails).toEqual(
        participants?.to ?? ['recipient@example.invalid'],
      );
      expect(detail.message.ccEmails).toEqual(participants?.cc ?? []);
      expect(detail.message.bccEmails).toEqual(participants?.bcc ?? []);
      expect(
        (
          await h.request(`/messages/${f.compose.data.messageId}`, {
            user: h.identity(),
          })
        ).status,
      ).toBe(404);
      expect(detail.events.map((event) => event.type).sort()).toEqual([
        'click',
        'open',
        'reply',
        'sent',
      ]);
      const stored = await h.sql(
        'SELECT type FROM glyph_events WHERE message_id=$1 ORDER BY type',
        [f.compose.data.messageId],
      );
      expect(stored.rows.map((event) => event.type)).toEqual([
        'click',
        'open',
        'reply',
        'sent',
      ]);
    } finally {
      f.compose.close();
    }
  },
);

test('invalid native recipient groups are rejected before persisting a draft', async () => {
  const owner = h.identity();
  const base = {
    senderEmail: mailbox,
    recipientEmail: 'recipient@example.invalid',
    recipientName: '',
    subject: 'Proposal',
    body: 'Hello',
    trackOpens: true,
    trackClicks: true,
    composeKey: 'native-recipient-validation',
    urls: [],
  };
  for (const invalid of [
    { toEmails: [] },
    { toEmails: ['not-an-email'] },
    { toEmails: ['stranger@example.invalid'] },
    { toEmails: [base.recipientEmail], ccEmails: [base.recipientEmail] },
    {
      toEmails: [
        base.recipientEmail,
        ...Array.from({ length: 50 }, (_, i) => `to${i}@example.invalid`),
      ],
      ccEmails: Array.from({ length: 50 }, (_, i) => `cc${i}@example.invalid`),
    },
  ]) {
    const response = await h.request('/native/prepare', {
      user: owner,
      method: 'POST',
      body: { ...base, ...invalid },
    });
    expect(response.status).toBe(400);
  }
  expect(
    (await h.sql('SELECT id FROM glyph_messages WHERE owner_id=$1', [owner]))
      .rows,
  ).toEqual([]);
});

test('a provider 429 after a matched reply preserves the match and reports partial paused coverage', async () => {
  const owner = h.identity();
  const message = await messageFixture(h.sql, { ownerId: owner });
  await h.sql('UPDATE glyph_messages SET sent_at=$2 WHERE id=$1', [
    message.id,
    new Date(edge.now - 1000),
  ]);
  const first = fixtureId().replaceAll('-', '');
  const second = fixtureId().replaceAll('-', '');
  edge.proxy.mockImplementation((integration, path) => {
    if (path.includes(`/${first}?`))
      return json(
        reply(first, `<${message.id}@example.invalid>`, edge.now - 1000),
      );
    if (path.includes(`/${second}?`))
      return json({}, 429, { 'Retry-After': '60' });
    if (path.includes('/messages?'))
      return json({ messages: [{ id: first }, { id: second }] });
    return defaultProvider(integration, path);
  });
  const result = await (
    await h.request('/native/sync', { user: owner, method: 'POST' })
  ).json();
  expect(result).toMatchObject({ repliesDetected: 1, replyCheckPartial: true });
  expect(result.replyCheckError).toContain('temporarily rate-limited');
  const { rows } = await h.sql(
    'SELECT type FROM glyph_events WHERE message_id=$1',
    [message.id],
  );
  expect(rows).toEqual([{ type: 'reply' }]);
});
