import { beforeAll, afterAll, beforeEach, expect, test } from 'vitest';
import {
  serviceHarness,
  edge,
  json,
  mailbox,
  defaultProvider,
  gmailConnections,
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
  edge.connections.mockResolvedValue(gmailConnections());
  edge.getUser.mockImplementation(async () => ({
    emailAddresses: [
      { emailAddress: mailbox, verification: { status: 'verified' } },
    ],
  }));
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

test('mailbox switch denies prior-owner sync and send before Gmail access', async () => {
  const ownerA = h.identity();
  const ownerB = h.identity();
  const mailboxA = 'account-a@example.invalid';
  const mailboxB = 'account-b@example.invalid';
  let activeMailbox = mailboxA;
  const draft = await messageFixture(h.sql, {
    ownerId: ownerA,
    status: 'draft',
  });
  edge.connections.mockResolvedValue(gmailConnections('stable-connection'));
  edge.getUser.mockImplementation(async (userId) => ({
    emailAddresses: [
      {
        emailAddress: userId === ownerA ? mailboxA : mailboxB,
        verification: { status: 'verified' },
      },
    ],
  }));
  edge.proxy.mockImplementation((_integration, path) =>
    path.endsWith('/profile')
      ? json({ emailAddress: activeMailbox })
      : path.includes('/messages?')
        ? json({ messages: [] })
        : defaultProvider(_integration, path),
  );
  expect(
    (await h.request('/native/sync', { user: ownerA, method: 'POST' })).status,
  ).toBe(200);

  activeMailbox = mailboxB;
  const readsBefore = edge.proxy.mock.calls.filter(([, path]) =>
    path.includes('/messages?'),
  ).length;
  expect(
    (await h.request('/native/sync', { user: ownerA, method: 'POST' })).status,
  ).toBe(403);
  expect(
    (
      await h.request(`/messages/${draft.id}/send`, {
        user: ownerA,
        method: 'POST',
      })
    ).status,
  ).toBe(403);
  expect(
    edge.proxy.mock.calls.filter(([, path]) => path.includes('/messages?'))
      .length,
  ).toBe(readsBefore);
  expect(
    edge.proxy.mock.calls.some(
      ([, path, init]) =>
        path.includes('/messages/send') || init.method === 'POST',
    ),
  ).toBe(false);
  expect(
    (await h.request('/native/sync', { user: ownerB, method: 'POST' })).status,
  ).toBe(200);
});

test('ambiguous forwarded host or protocol cannot authorize a browser write', async () => {
  const owner = h.identity();
  const callsBefore = edge.proxy.mock.calls.length;
  for (const headers of [
    { 'x-forwarded-host': 'glyph.example, attacker.invalid' },
    { 'x-forwarded-proto': 'https,http' },
  ]) {
    const response = await h.request('/messages', {
      user: owner,
      method: 'POST',
      body: {},
      headers,
    });
    expect(response.status).toBe(403);
  }
  expect(edge.proxy.mock.calls).toHaveLength(callsBefore);
});

test('API responses include browser protections and hide Express fingerprints', async () => {
  const response = await h.request('/overview', { user: h.identity() });
  expect(response.status).toBe(200);
  expect(response.headers.get('content-security-policy')).toContain(
    "frame-ancestors 'none'",
  );
  expect(response.headers.get('referrer-policy')).toBe(
    'strict-origin-when-cross-origin',
  );
  expect(response.headers.get('permissions-policy')).toContain('camera=()');
  expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  expect(response.headers.get('x-frame-options')).toBe('DENY');
  expect(response.headers.get('x-powered-by')).toBeNull();
});

test('native draft pixel bursts use one durable reconciliation slot and preserve responses', async () => {
  const owner = h.identity();
  const message = await messageFixture(h.sql, {
    ownerId: owner,
    source: 'gmail',
    status: 'draft',
  });
  const callsBefore = edge.proxy.mock.calls.length;
  const responses = await Promise.all(
    Array.from({ length: 8 }, () => h.request(`/t/${message.token}.gif`)),
  );
  expect(responses.every((response) => response.status === 200)).toBe(true);
  await Promise.all(responses.map((response) => response.arrayBuffer()));
  expect(
    (
      await h.sql(
        'SELECT window_count, day_count FROM glyph_tracking_budgets WHERE message_id=$1 AND kind=$2',
        [message.id, 'reconcile'],
      )
    ).rows,
  ).toEqual([{ window_count: 1, day_count: 1 }]);
  expect(
    edge.proxy.mock.calls
      .slice(callsBefore)
      .filter(([, path]) => path.includes('/messages?')).length,
  ).toBeLessThanOrEqual(1);

  const linkToken = fixtureId().replaceAll('-', '').padStart(48, '0');
  await h.sql(
    'INSERT INTO glyph_links(id,message_id,token,url) VALUES ($1,$2,$3,$4)',
    [fixtureId(), message.id, linkToken, 'https://example.invalid/proposal'],
  );
  const redirect = await h.request(`/l/${linkToken}`, { redirect: 'manual' });
  expect([redirect.status, redirect.headers.get('location')]).toEqual([
    302,
    'https://example.invalid/proposal',
  ]);
  expect(edge.proxy.mock.calls.length).toBeLessThanOrEqual(callsBefore + 2);
});

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
      const eventPage = await (
        await h.request(`/messages/${f.compose.data.messageId}/events/0`, {
          user: f.owner,
        })
      ).json();
      expect(eventPage.items.map((event) => event.type).sort()).toEqual([
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
