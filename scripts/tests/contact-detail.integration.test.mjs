import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { serviceHarness, edge } from './helpers/service-harness.mjs';
import { messageFixture } from '../lib/database-fixture.mjs';

const DAY = 86_400_000;
let h;
beforeAll(async () => {
  h = await serviceHarness();
});
afterAll(async () => {
  await h?.close();
});

async function contact(owner, email = 'person@example.invalid') {
  const id = randomUUID();
  await h.sql(
    `INSERT INTO glyph_contacts (id,owner_id,first_name,last_name,email,email_suffix)
     VALUES ($1,$2,'Real','Contact',$3,'example.invalid')`,
    [id, owner, email],
  );
  return id;
}

async function message(owner, email, roles = {}, overrides = {}) {
  const m = await messageFixture(h.sql, { ownerId: owner, ...overrides });
  await h.sql(
    `UPDATE glyph_messages SET recipient_email=$2,to_emails=$3,cc_emails=$4,
     bcc_emails=$5,sent_at=$6,created_at=$6 WHERE id=$1`,
    [
      m.id,
      email,
      roles.to ?? [],
      roles.cc ?? [],
      roles.bcc ?? [],
      new Date(edge.now - 7 * DAY),
    ],
  );
  return m;
}

async function event(messageId, type, daysAgo, extra = {}) {
  const id = randomUUID();
  await h.sql(
    `INSERT INTO glyph_events (id,message_id,type,source,fingerprint,occurred_at,url,automated)
     VALUES ($1,$2,$3,'Fixture message-level signal',$1,$4,$5,$6)`,
    [
      id,
      messageId,
      type,
      new Date(edge.now - daysAgo * DAY),
      extra.url ?? null,
      extra.automated ?? false,
    ],
  );
  return id;
}

test('contact profiles require sign-in and conceal contacts belonging to another owner', async () => {
  const owner = h.identity();
  const id = await contact(owner);
  const other = h.identity();
  expect((await h.request(`/contacts/${id}`)).status).toBe(401);
  const foreign = await h.request(`/contacts/${id}`, { user: other });
  const missing = await h.request(`/contacts/${randomUUID()}`, { user: other });
  expect(foreign.status).toBe(404);
  expect(await foreign.json()).toEqual(await missing.json());
  expect(
    (await h.request(`/contacts/${id}?messageOffset=-1`, { user: owner }))
      .status,
  ).toBe(400);
  expect(
    (await h.request(`/contacts/${id}?eventOffset=1000001`, { user: owner }))
      .status,
  ).toBe(400);
});

test('correspondence matches primary, To, Cc and Bcc case-insensitively without crossing owners', async () => {
  const owner = h.identity();
  const id = await contact(owner);
  const primary = await message(owner, 'PERSON@example.invalid');
  const to = await message(owner, 'elsewhere@example.invalid', {
    to: ['person@example.invalid'],
  });
  const cc = await message(owner, 'elsewhere@example.invalid', {
    cc: ['PERSON@example.invalid'],
  });
  const bcc = await message(owner, 'elsewhere@example.invalid', {
    bcc: ['person@example.invalid'],
  });
  await message(owner, 'unrelated@example.invalid');
  const foreign = await message(h.identity(), 'person@example.invalid');
  await event(foreign.id, 'open', 0);
  const data = await (
    await h.request(`/contacts/${id}`, { user: owner })
  ).json();
  expect(data.totalMessages).toBe(4);
  expect(data.messages.map((m) => m.id).sort()).toEqual(
    [primary.id, to.id, cc.id, bcc.id].sort(),
  );
  expect(data.events).toEqual([]);
  expect(data.pixelLoads).toBe(0);
  expect(data.contact).not.toHaveProperty('ownerId');
});

test('timelines preserve timestamps, destinations and source without using clicks as communication', async () => {
  const owner = h.identity();
  const id = await contact(owner);
  const m = await message(owner, 'person@example.invalid');
  await event(m.id, 'open', 0);
  await event(m.id, 'click', 0, {
    url: 'https://destination.example/path',
    automated: true,
  });
  await event(m.id, 'reply', 3);
  const data = await (
    await h.request(`/contacts/${id}`, { user: owner })
  ).json();
  expect(data).toMatchObject({
    pixelLoads: 1,
    linkRequests: 1,
    replies: 1,
    daysSinceLastCommunication: 3,
  });
  expect(data.lastCommunicationAt).toBe(
    new Date(edge.now - 3 * DAY).toISOString(),
  );
  expect(data.events.find((e) => e.type === 'click')).toMatchObject({
    occurredAt: new Date(edge.now).toISOString(),
    url: 'https://destination.example/path',
    automated: true,
    source: 'Fixture message-level signal',
  });
});

test('imported correspondence has no invented history and a contact without communication has no age', async () => {
  const owner = h.identity();
  const id = await contact(owner);
  await message(
    owner,
    'person@example.invalid',
    {},
    { source: 'import', opens: false, clicks: false },
  );
  const data = await (
    await h.request(`/contacts/${id}`, { user: owner })
  ).json();
  expect(data).toMatchObject({
    pixelLoads: 0,
    linkRequests: 0,
    replies: 0,
    totalEvents: 0,
    daysSinceLastCommunication: 7,
  });
  expect(data.messages[0]).toMatchObject({
    deliverySource: 'import',
    trackOpens: false,
    trackClicks: false,
  });
  const emptyId = await contact(owner, 'empty@example.invalid');
  const empty = await (
    await h.request(`/contacts/${emptyId}`, { user: owner })
  ).json();
  expect(empty.lastCommunicationAt).toBeNull();
  expect(empty.daysSinceLastCommunication).toBeNull();
  expect(empty.totalMessages).toBe(0);
});

test('draft dates do not imply communication and Unicode excerpts stay within the response contract', async () => {
  const owner = h.identity();
  const id = await contact(owner);
  const m = await message(
    owner,
    'person@example.invalid',
    {},
    { status: 'draft' },
  );
  await h.sql('UPDATE glyph_messages SET body=$2 WHERE id=$1', [
    m.id,
    String.fromCodePoint(0x1f600).repeat(300),
  ]);
  const response = await h.request(`/contacts/${id}`, { user: owner });
  expect(response.status).toBe(200);
  const data = await response.json();
  expect(data.lastCommunicationAt).toBeNull();
  expect(data.daysSinceLastCommunication).toBeNull();
  expect(data.messages[0].status).toBe('draft');
  expect(data.messages[0].excerpt.length).toBeLessThanOrEqual(240);
});

test('message and signal histories paginate independently with bounded stable pages', async () => {
  const owner = h.identity();
  const id = await contact(owner);
  const m = await message(owner, 'person@example.invalid');
  for (let i = 0; i < 25; i++) await message(owner, 'person@example.invalid');
  for (let i = 0; i < 55; i++) await event(m.id, 'open', 1);
  const first = await (
    await h.request(`/contacts/${id}`, { user: owner })
  ).json();
  const next = await (
    await h.request(`/contacts/${id}?messageOffset=25&eventOffset=50`, {
      user: owner,
    })
  ).json();
  expect(first).toMatchObject({
    totalMessages: 26,
    totalEvents: 55,
    messageLimit: 25,
    eventLimit: 50,
  });
  expect(first.messages).toHaveLength(25);
  expect(first.events).toHaveLength(50);
  expect(next.messages).toHaveLength(1);
  expect(next.events).toHaveLength(5);
  expect(
    next.messages.some((m) => first.messages.some((row) => row.id === m.id)),
  ).toBe(false);
  expect(
    next.events.some((e) => first.events.some((row) => row.id === e.id)),
  ).toBe(false);
});

test('contact history rejects malformed offsets and does not honor a forged owner query', async () => {
  const owner = h.identity();
  const id = await contact(owner);
  for (const query of [
    'messageOffset=1.5',
    'eventOffset=NaN',
    'messageOffset=Infinity',
    'eventOffset=0&eventOffset=1',
    'messageOffset=0%3BDROP%20TABLE',
  ]) {
    expect(
      (await h.request(`/contacts/${id}?${query}`, { user: owner })).status,
    ).toBe(400);
  }
  const foreign = await h.request(`/contacts/${id}?ownerId=${owner}`, {
    user: h.identity(),
  });
  expect(foreign.status).toBe(404);
});

test('duplicate roles do not duplicate correspondence or expose message secrets or unrelated signals', async () => {
  const owner = h.identity();
  const id = await contact(owner);
  const email = 'person@example.invalid';
  const m = await message(owner, email, {
    to: [email],
    cc: [email],
    bcc: [email],
  });
  const other = await message(owner, 'someone-else@example.invalid');
  await event(other.id, 'open', 0);
  await event(other.id, 'reply', 0);
  await event(m.id, 'open', 2);
  const response = await h.request(`/contacts/${id}`, { user: owner });
  expect(response.status).toBe(200);
  const data = await response.json();
  expect(data).toMatchObject({
    totalMessages: 1,
    totalEvents: 1,
    pixelLoads: 1,
    replies: 0,
  });
  for (const field of [
    'pixelToken',
    'ownerId',
    'body',
    'bodyHtml',
    'attachments',
    'rfcMessageId',
  ]) {
    expect(data.messages[0]).not.toHaveProperty(field);
  }
  expect(data.events[0].messageId).toBe(m.id);
});
