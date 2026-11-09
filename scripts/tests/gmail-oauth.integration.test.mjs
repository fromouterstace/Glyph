import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import { serviceHarness, edge, json } from './helpers/service-harness.mjs';
import { messageFixture } from '../lib/database-fixture.mjs';
import { gmailScopes } from '../../artifacts/api-server/src/lib/gmail-oauth-config.ts';

let h;
const realFetch = globalThis.fetch;
const accounts = new Map();
const calls = [];
let google;
let scopes;
let refreshStatus;
let revokeStatus;
let mailboxResponse;
let tokenHook;

beforeAll(async () => {
  vi.stubEnv('GOOGLE_GMAIL_CLIENT_ID', 'fixture-client');
  vi.stubEnv('GOOGLE_GMAIL_CLIENT_SECRET', 'fixture-client-secret');
  vi.stubEnv(
    'SESSION_SECRET',
    'isolated-fixture-encryption-secret-not-production',
  );
  vi.stubEnv('GLYPH_GMAIL_OAUTH_ORIGIN', 'https://glyph.example');
  h = await serviceHarness();
  google = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async (url, init) => {
      const target = String(url);
      if (
        !target.startsWith('https://oauth2.googleapis.com/') &&
        !target.startsWith('https://gmail.googleapis.com/')
      )
        return realFetch(url, init);
      calls.push({ target, init });
      if (target.endsWith('/revoke')) return json({}, revokeStatus);
      if (target.endsWith('/token')) {
        const body = new URLSearchParams(init.body);
        const refresh = body.get('grant_type') === 'refresh_token';
        const owner = refresh
          ? body.get('refresh_token').slice(8)
          : body.get('code');
        if (tokenHook) await tokenHook(owner);
        if (refresh && refreshStatus !== 200) return json({}, refreshStatus);
        return json({
          access_token: `access:${owner}`,
          refresh_token: `refresh:${owner}`,
          token_type: 'Bearer',
          expires_in: 3600,
          scope: scopes.join(' '),
        });
      }
      const token = new Headers(init.headers).get('Authorization');
      const owner = token?.slice('Bearer access:'.length);
      if (!accounts.has(owner))
        throw new Error('Unexpected or cross-owner OAuth token');
      if (target.endsWith('/profile'))
        return json({ emailAddress: accounts.get(owner) });
      return mailboxResponse(owner, target, init);
    });
});

beforeEach(() => {
  scopes = gmailScopes;
  refreshStatus = 200;
  revokeStatus = 200;
  mailboxResponse = (_owner, url) =>
    url.includes('/messages/send')
      ? json({ id: 'sent-from-personal-gmail' })
      : json({ messages: [] });
  calls.length = 0;
  tokenHook = null;
  edge.getUser.mockImplementation(async (id) => ({
    emailAddresses: [
      { emailAddress: accounts.get(id), verification: { status: 'verified' } },
    ],
  }));
});

afterAll(async () => {
  google?.mockRestore();
  await h?.close();
  vi.unstubAllEnvs();
});

function account() {
  const owner = h.identity();
  accounts.set(owner, `${owner}@example.invalid`);
  return owner;
}

async function start(owner, session = 'test-session') {
  const response = await h.request('/gmail/authorization', {
    user: owner,
    session,
    method: 'POST',
  });
  expect(response.status, await response.clone().text()).toBe(200);
  return new URL((await response.json()).authorizationUrl);
}

async function callback(owner, state, extra = {}) {
  const query = new URLSearchParams({ state, code: owner, ...extra.query });
  return h.request(`/gmail/oauth/callback?${query}`, {
    user: owner,
    redirect: 'manual',
    ...extra.options,
  });
}

async function connect(owner) {
  const url = await start(owner);
  const response = await callback(owner, url.searchParams.get('state'));
  expect(response.status).toBe(303);
  expect(response.headers.get('location')).toBe(
    'https://glyph.example/gmail?gmail=connected',
  );
  return owner;
}

test('Glyph label import uses the real personal Gmail transport and stores owner-scoped contacts', async () => {
  const owner = await connect(account());
  mailboxResponse = (_user, target) => {
    const path = new URL(target).pathname;
    if (path.endsWith('/labels'))
      return json({ labels: [{ id: 'glyph-label', name: 'Glyph' }] });
    if (path.endsWith('/messages'))
      return json({ messages: [{ id: 'personal-labeled-message' }] });
    if (path.endsWith('/messages/personal-labeled-message'))
      return json({
        id: 'personal-labeled-message',
        internalDate: String(edge.now),
        labelIds: ['glyph-label'],
        payload: {
          mimeType: 'text/plain',
          headers: [
            { name: 'From', value: 'Grace Hopper <grace@example.invalid>' },
            { name: 'To', value: accounts.get(owner) },
            { name: 'Subject', value: 'Personal label import fixture' },
          ],
          body: { data: Buffer.from('Fixture text').toString('base64url') },
        },
      });
    throw new Error('Unexpected personal Gmail import request');
  };
  const result = await h.request('/label-import', {
    user: owner,
    method: 'POST',
  });
  expect(result.status, await result.clone().text()).toBe(200);
  expect(calls.some((call) => call.target.endsWith('/labels'))).toBe(true);
  const contacts = await (await h.request('/contacts', { user: owner })).json();
  expect(contacts.total).toBe(1);
  expect(contacts.contacts[0]).toMatchObject({
    firstName: 'Grace',
    lastName: 'Hopper',
    email: 'grace@example.invalid',
    emailSuffix: 'example.invalid',
  });
  expect(
    (await (await h.request('/contacts', { user: account() })).json()).total,
  ).toBe(0);
});

test('personal label discovery keeps writes, unexpected paths and cross-owner access blocked', async () => {
  const owner = await connect(account());
  const [{ generation }] = (
    await h.sql(
      'SELECT generation FROM glyph_gmail_connections WHERE owner_id=$1',
      [owner],
    )
  ).rows;
  const { personalGmailRequest } =
    await import('../../artifacts/api-server/src/lib/gmail-oauth-transport.ts');
  const before = calls.length;
  for (const [path, method] of [
    ['/labels', 'POST'],
    ['/labels', 'PATCH'],
    ['/labels', 'DELETE'],
    ['/labels/another-label', 'GET'],
    ['/labels?unexpected=value', 'GET'],
    ['/labels#fragment', 'GET'],
    ['//attacker.invalid/labels', 'GET'],
  ])
    await expect(
      personalGmailRequest(owner, generation, path, { method }),
    ).rejects.toMatchObject({ status: 400 });
  await expect(
    personalGmailRequest(account(), generation, '/labels'),
  ).rejects.toThrow();
  expect(calls).toHaveLength(before);
  mailboxResponse = () => json({ labels: [] });
  expect(
    await (
      await personalGmailRequest(owner, generation, '/labels', {
        method: 'GET',
      })
    ).json(),
  ).toEqual({ labels: [] });
});

test('authorization is explicit, same-origin, session-bound and uses PKCE with only Gmail read/send scopes', async () => {
  const owner = account();
  expect((await h.request('/gmail/authorization')).status).toBe(401);
  expect(
    (
      await h.request('/gmail/authorization', {
        user: owner,
        session: null,
        method: 'POST',
      })
    ).status,
  ).toBe(401);
  expect(
    (
      await h.request('/gmail/authorization', {
        user: owner,
        method: 'POST',
        headers: { origin: 'https://evil.invalid' },
      })
    ).status,
  ).toBe(403);
  const url = await start(owner);
  expect(url.origin).toBe('https://accounts.google.com');
  expect(url.searchParams.get('scope').split(' ')).toEqual(gmailScopes);
  expect(url.searchParams.get('code_challenge_method')).toBe('S256');
  expect(url.searchParams.get('redirect_uri')).toBe(
    'https://glyph.example/api/glyph/gmail/oauth/callback',
  );
  const state = url.searchParams.get('state');
  expect((await callback(account(), state)).headers.get('location')).toContain(
    'gmail=failed',
  );
  expect(
    (
      await callback(owner, state, { options: { session: 'other-session' } })
    ).headers.get('location'),
  ).toContain('gmail=failed');
  expect(calls).toHaveLength(0);
  const result = await callback(owner, state);
  expect(result.headers.get('location')).toContain('gmail=connected');
  const tokenBody = new URLSearchParams(
    calls.find((call) => call.target.endsWith('/token')).init.body,
  );
  const { createHash } = await import('node:crypto');
  expect(
    createHash('sha256')
      .update(tokenBody.get('code_verifier'))
      .digest('base64url'),
  ).toBe(url.searchParams.get('code_challenge'));
  expect((await callback(owner, state)).headers.get('location')).toContain(
    'gmail=failed',
  );
  expect(calls.filter((call) => call.target.endsWith('/token'))).toHaveLength(
    1,
  );
});

test('states expire, denied grants are single-use, and partial scopes or a mismatched email never connect', async () => {
  const owner = account();
  const expired = await start(owner);
  edge.now += 10 * 60_000 + 1;
  expect(
    (await callback(owner, expired.searchParams.get('state'))).headers.get(
      'location',
    ),
  ).toContain('gmail=failed');
  const denied = await start(owner);
  expect(
    (
      await callback(owner, denied.searchParams.get('state'), {
        query: { error: 'access_denied' },
      })
    ).headers.get('location'),
  ).toContain('gmail=denied');
  scopes = [gmailScopes[1]];
  const partial = await start(owner);
  expect(
    (await callback(owner, partial.searchParams.get('state'))).headers.get(
      'location',
    ),
  ).toContain('gmail=failed');
  scopes = gmailScopes;
  edge.getUser.mockResolvedValue({ emailAddresses: [] });
  const mismatch = await start(owner);
  expect(
    (await callback(owner, mismatch.searchParams.get('state'))).headers.get(
      'location',
    ),
  ).toContain('gmail=failed');
  expect(
    (
      await h.sql(
        'SELECT owner_id FROM glyph_gmail_connections WHERE owner_id=$1',
        [owner],
      )
    ).rows,
  ).toHaveLength(0);
});

test('OAuth completion retains an inert state and new authorization does not erase history', async () => {
  const owner = await connect(account());
  const completed = (
    await h.sql(
      'SELECT claimed_at, expires_at, encrypted_verifier FROM glyph_gmail_oauth_states WHERE owner_id=$1',
      [owner],
    )
  ).rows;
  expect(completed).toHaveLength(1);
  expect(completed[0].claimed_at).not.toBeNull();
  expect(new Date(completed[0].expires_at).getTime()).toBe(0);
  expect(completed[0].encrypted_verifier).toBe('');
  await start(owner);
  const retained = (
    await h.sql(
      'SELECT expires_at, encrypted_verifier FROM glyph_gmail_oauth_states WHERE owner_id=$1',
      [owner],
    )
  ).rows;
  expect(retained).toHaveLength(2);
  expect(retained.filter((row) => row.encrypted_verifier === '')).toHaveLength(
    1,
  );
  expect(
    retained.filter((row) => new Date(row.expires_at).getTime() > Date.now()),
  ).toHaveLength(1);
});

test('tokens are encrypted at rest and authenticated to their owner; status never exposes credentials', async () => {
  const owner = await connect(account());
  const other = account();
  const [{ encrypted_tokens: encrypted }] = (
    await h.sql(
      'SELECT encrypted_tokens FROM glyph_gmail_connections WHERE owner_id=$1',
      [owner],
    )
  ).rows;
  expect(encrypted).not.toContain('access:');
  expect(encrypted).not.toContain('refresh:');
  const { openGmailSecret } =
    await import('../../artifacts/api-server/src/lib/gmail-oauth-config.ts');
  expect(JSON.parse(openGmailSecret(encrypted, owner)).refreshToken).toBe(
    `refresh:${owner}`,
  );
  expect(() => openGmailSecret(encrypted, other)).toThrow('cannot be read');
  const status = await h.request('/gmail/authorization', { user: owner });
  const text = await status.text();
  expect(JSON.parse(text)).toMatchObject({
    connected: true,
    email: accounts.get(owner),
    kind: 'personal',
  });
  expect(text).not.toMatch(/accessToken|refreshToken|encrypted|secret/i);
  const foreign = await h.request('/gmail/authorization', { user: other });
  expect(await foreign.text()).not.toContain(accounts.get(owner));
});

test('two owners send using only their own Gmail token and sender address', async () => {
  const owners = [await connect(account()), await connect(account())];
  const raws = new Map();
  mailboxResponse = (owner, url, init) => {
    expect(url).toContain('/messages/send');
    raws.set(
      owner,
      Buffer.from(JSON.parse(init.body).raw, 'base64url').toString(),
    );
    return json({ id: `gmail-sent-${owner}` });
  };
  edge.proxy.mockClear();
  for (const owner of owners) {
    const message = await messageFixture(h.sql, {
      ownerId: owner,
      status: 'draft',
    });
    const response = await h.request(`/messages/${message.id}/send`, {
      user: owner,
      method: 'POST',
    });
    expect(response.status, await response.clone().text()).toBe(200);
  }
  for (const owner of owners) {
    expect(raws.get(owner)).toContain(`From: ${accounts.get(owner)}`);
    expect(raws.get(owner)).not.toContain(
      accounts.get(owners.find((id) => id !== owner)),
    );
  }
  expect(edge.proxy).not.toHaveBeenCalled();
});

test('extension preparation rejects another Gmail From account and cannot access another owner message', async () => {
  const owner = await connect(account());
  const other = await connect(account());
  const body = {
    composeKey: 'oauth-compose-isolation',
    senderEmail: accounts.get(other),
    recipientEmail: 'recipient@example.invalid',
    recipientName: '',
    subject: 'Personal Gmail',
    body: 'Tracked',
    urls: [],
    trackOpens: true,
    trackClicks: false,
  };
  expect(
    (await h.request('/native/prepare', { user: owner, method: 'POST', body }))
      .status,
  ).toBe(403);
  body.senderEmail = accounts.get(owner);
  const response = await h.request('/native/prepare', {
    user: owner,
    method: 'POST',
    body,
  });
  expect(response.status, await response.clone().text()).toBe(200);
  const foreign = await messageFixture(h.sql, {
    ownerId: other,
    status: 'draft',
  });
  expect(
    (
      await h.request(`/messages/${foreign.id}/send`, {
        user: owner,
        method: 'POST',
      })
    ).status,
  ).toBe(404);
});

test('token refresh is serialized, reconnect preserves reply identity, and revoked grants never fall back', async () => {
  const owner = await connect(account());
  const { userGmailRequest } =
    await import('../../artifacts/api-server/src/lib/gmail.ts');
  edge.now += 3_600_000;
  const count = () =>
    calls.filter((call) => call.target.endsWith('/token')).length;
  const before = count();
  await Promise.all([
    userGmailRequest(owner, '/messages'),
    userGmailRequest(owner, '/messages'),
  ]);
  expect(count() - before).toBe(1);
  const old = (
    await h.sql(
      'SELECT generation, reply_identity FROM glyph_gmail_connections WHERE owner_id=$1',
      [owner],
    )
  ).rows[0];
  await connect(owner);
  const next = (
    await h.sql(
      'SELECT generation, reply_identity FROM glyph_gmail_connections WHERE owner_id=$1',
      [owner],
    )
  ).rows[0];
  expect(next.generation).not.toBe(old.generation);
  expect(next.reply_identity).toBe(old.reply_identity);
  edge.now += 3_600_000;
  refreshStatus = 400;
  await expect(userGmailRequest(owner, '/messages')).rejects.toThrow('revoked');
  expect(
    (
      await h.sql(
        'SELECT encrypted_tokens FROM glyph_gmail_connections WHERE owner_id=$1',
        [owner],
      )
    ).rows[0].encrypted_tokens,
  ).toBeNull();
  edge.proxy.mockClear();
  await expect(userGmailRequest(owner, '/messages')).rejects.toThrow(
    'unavailable',
  );
  expect(edge.proxy).not.toHaveBeenCalled();
});

test('disconnect is owner-scoped, clears pending callbacks, preserves records and reports revocation failure honestly', async () => {
  const owner = await connect(account());
  const other = await connect(account());
  const message = await messageFixture(h.sql, { ownerId: owner });
  const pending = await start(owner);
  revokeStatus = 503;
  const response = await h.request('/gmail/authorization', {
    user: owner,
    method: 'DELETE',
  });
  expect(await response.json()).toEqual({
    disconnected: true,
    revocationConfirmed: false,
  });
  expect(
    (await h.sql('SELECT id FROM glyph_messages WHERE id=$1', [message.id]))
      .rows,
  ).toHaveLength(1);
  expect(
    (
      await h
        .request('/gmail/authorization', { user: other })
        .then((r) => r.json())
    ).connected,
  ).toBe(true);
  expect(
    (await callback(owner, pending.searchParams.get('state'))).headers.get(
      'location',
    ),
  ).toContain('gmail=failed');
  expect(
    (
      await h
        .request('/gmail/authorization', { user: owner })
        .then((r) => r.json())
    ).connected,
  ).toBe(false);
});

test('a personal mailbox binding cannot be switched by reconnecting with another verified address', async () => {
  const owner = await connect(account());
  const original = accounts.get(owner);
  accounts.set(owner, `changed-${owner}@example.invalid`);
  const url = await start(owner);
  expect(
    (await callback(owner, url.searchParams.get('state'))).headers.get(
      'location',
    ),
  ).toContain('gmail=failed');
  expect(
    (
      await h.sql(
        'SELECT email FROM glyph_gmail_connections WHERE owner_id=$1',
        [owner],
      )
    ).rows[0].email,
  ).toBe(original);
});

test('read throttling is mailbox-scoped and writes are not retried after rejection or transport loss', async () => {
  const owner = await connect(account());
  const other = await connect(account());
  const { userGmailRequest } =
    await import('../../artifacts/api-server/src/lib/gmail.ts');
  mailboxResponse = (id) =>
    id === owner ? json({}, 429, { 'Retry-After': '120' }) : json({});
  await expect(userGmailRequest(owner, '/messages')).rejects.toThrow(
    'rate-limited',
  );
  expect((await userGmailRequest(other, '/messages')).ok).toBe(true);
  const before = calls.length;
  expect(
    (
      await userGmailRequest(owner, '/messages/send', {
        method: 'POST',
        body: '{}',
      })
    ).status,
  ).toBe(429);
  expect(calls.length - before).toBe(1);
  mailboxResponse = () => {
    throw new Error('transport loss');
  };
  const beforeLoss = calls.length;
  await expect(
    userGmailRequest(other, '/messages/send', { method: 'POST', body: '{}' }),
  ).rejects.toThrow('temporarily unavailable');
  expect(calls.length - beforeLoss).toBe(1);
});

test('Sent and reply scans use the owner mailbox even when Google message IDs overlap', async () => {
  const owners = [await connect(account()), await connect(account())];
  const originals = new Map();
  const drafts = new Map();
  for (const owner of owners) {
    const draft = await messageFixture(h.sql, {
      ownerId: owner,
      source: 'gmail',
      status: 'draft',
    });
    const original = await messageFixture(h.sql, {
      ownerId: owner,
      source: 'web',
    });
    await h.sql('UPDATE glyph_messages SET sent_at=created_at WHERE id=$1', [
      original.id,
    ]);
    const created = (
      await h.sql('SELECT created_at FROM glyph_messages WHERE id=$1', [
        draft.id,
      ])
    ).rows[0].created_at;
    drafts.set(owner, { ...draft, created });
    originals.set(owner, original);
  }
  mailboxResponse = (owner, target) => {
    const url = new URL(target);
    const draft = drafts.get(owner);
    const original = originals.get(owner);
    if (url.searchParams.get('format') === 'full')
      return json({
        id: 'overlapping-sent-id',
        internalDate: String(draft.created.getTime() + 1000),
        payload: {
          mimeType: 'text/html',
          body: {
            data: Buffer.from(
              `<img src="https://glyph.example/gmail?glyph=${draft.token}">`,
            ).toString('base64url'),
          },
          headers: [
            { name: 'From', value: accounts.get(owner) },
            { name: 'To', value: 'recipient@example.invalid' },
            { name: 'Message-ID', value: `<sent-${owner}@example.invalid>` },
          ],
        },
      });
    if (url.searchParams.get('format') === 'metadata')
      return json({
        id: 'overlapping-reply-id',
        internalDate: String(draft.created.getTime() + 2000),
        labelIds: ['INBOX'],
        payload: {
          headers: [
            { name: 'From', value: 'recipient@example.invalid' },
            { name: 'To', value: accounts.get(owner) },
            { name: 'Message-ID', value: '<reply@example.invalid>' },
            { name: 'In-Reply-To', value: `<${original.id}@example.invalid>` },
          ],
        },
      });
    return json({
      messages: [
        {
          id: url.searchParams.get('q').startsWith('in:sent')
            ? 'overlapping-sent-id'
            : 'overlapping-reply-id',
        },
      ],
    });
  };
  const { syncNative } =
    await import('../../artifacts/api-server/src/lib/gmail-native.ts');
  const { syncReplies } =
    await import('../../artifacts/api-server/src/lib/gmail-replies.ts');
  for (const owner of owners) {
    expect((await syncNative(owner)).confirmed).toBe(1);
    expect((await syncReplies(owner)).repliesDetected).toBe(1);
  }
  for (const owner of owners) {
    const replies = await h.sql(
      "SELECT e.message_id FROM glyph_events e JOIN glyph_messages m ON m.id=e.message_id WHERE m.owner_id=$1 AND e.type='reply'",
      [owner],
    );
    expect(replies.rows.map((row) => row.message_id)).toEqual([
      originals.get(owner).id,
    ]);
  }
});

test('disconnect invalidates an already claimed callback before it can save a replacement grant', async () => {
  const owner = await connect(account());
  const url = await start(owner);
  const arrived = Promise.withResolvers();
  const resume = Promise.withResolvers();
  tokenHook = async () => {
    arrived.resolve();
    await resume.promise;
  };
  const pending = callback(owner, url.searchParams.get('state'));
  await arrived.promise;
  expect(
    (await h.request('/gmail/authorization', { user: owner, method: 'DELETE' }))
      .status,
  ).toBe(200);
  resume.resolve();
  expect((await pending).headers.get('location')).toContain('gmail=failed');
  expect(
    (
      await h.sql(
        'SELECT encrypted_tokens FROM glyph_gmail_connections WHERE owner_id=$1',
        [owner],
      )
    ).rows[0].encrypted_tokens,
  ).toBeNull();
});

test('Google 401 disables the personal grant without retry or shared-connector fallback', async () => {
  const owner = await connect(account());
  mailboxResponse = () => json({}, 401);
  const { userGmailRequest } =
    await import('../../artifacts/api-server/src/lib/gmail.ts');
  const before = calls.length;
  expect(
    (await userGmailRequest(owner, '/messages/send', { method: 'POST' }))
      .status,
  ).toBe(401);
  expect(calls.length - before).toBe(1);
  edge.proxy.mockClear();
  await expect(userGmailRequest(owner, '/messages')).rejects.toThrow(
    'unavailable',
  );
  expect(edge.proxy).not.toHaveBeenCalled();
});

test('the existing owner migrates without changing legacy reply fingerprints', async () => {
  const owner = account();
  accounts.set(owner, 'sender@example.invalid');
  await messageFixture(h.sql, { ownerId: owner });
  await connect(owner);
  expect(
    (
      await h.sql(
        'SELECT reply_identity FROM glyph_gmail_connections WHERE owner_id=$1',
        [owner],
      )
    ).rows[0].reply_identity,
  ).toBe('gmail-connection-fixture:sender@example.invalid');
});
