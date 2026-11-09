import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest';
import {
  approvalHarness,
  edge,
  first,
  plan,
  resetApprovers,
} from './helpers/database-approvals.mjs';
let h;
beforeAll(async () => {
  h = await approvalHarness();
});
beforeEach(resetApprovers);
afterAll(async () => {
  await h?.close();
});

test('signed-out reads and writes require a session; outsiders cannot read approval records', async () => {
  for (const path of ['/database-approvals/access', '/database-approvals']) {
    expect((await h.request(path)).status).toBe(401);
    expect((await h.request(path, { user: first, session: null })).status).toBe(
      401,
    );
  }
  expect(
    (await h.request('/database-approvals', { method: 'POST', body: plan }))
      .status,
  ).toBe(401);
  expect(
    (await h.request('/database-approvals', { user: 'outsider' })).status,
  ).toBe(403);
  const access = await h.request('/database-approvals/access', {
    user: 'outsider',
  });
  expect(await access.json()).toEqual({ canApprove: false, slot: null });
  expect(access.headers.get('cache-control')).toBe('private, no-store');
});
test('both designated addresses on one account, unverified email and identity outages fail closed', async () => {
  expect(
    (await h.request('/database-approvals', { user: 'both' })).status,
  ).toBe(403);
  edge.getUser.mockResolvedValueOnce({
    emailAddresses: [
      {
        emailAddress: 'stacydbradford@gmail.com',
        verification: { status: 'unverified' },
      },
    ],
  });
  expect((await h.request('/database-approvals', { user: first })).status).toBe(
    403,
  );
  edge.getUser.mockRejectedValueOnce(new Error('identity unavailable'));
  expect((await h.request('/database-approvals', { user: first })).status).toBe(
    503,
  );
});
test('cross-origin and forged server-owned fields are rejected without storing requests', async () => {
  expect(
    (
      await h.request('/database-approvals', {
        user: first,
        method: 'POST',
        body: plan,
        headers: { origin: 'https://attacker.invalid' },
      })
    ).status,
  ).toBe(403);
  for (const overrides of [
    { operation: 'execute_sql' },
    { requestedBy: 'forged' },
    { expiresAt: '2099-01-01' },
    { target: 'glyph_messages; DROP TABLE x' },
    { planSha256: 'bad' },
  ]) {
    expect(
      (
        await h.request('/database-approvals', {
          user: first,
          method: 'POST',
          body: { ...plan, ...overrides },
        })
      ).status,
    ).toBe(400);
  }
});
test('server binds environment, expiry and digest; lists are bounded and validate offsets', async () => {
  const row = await h.create();
  expect(row.status).toBe('pending');
  expect(row.environment).toBe('development');
  expect(row.requestedBy).toBe(first);
  expect(Date.parse(row.expiresAt) - Date.parse(row.createdAt)).toBe(3600000);
  expect(row.digest).toMatch(/^[a-f0-9]{64}$/);
  const list = await (
    await h.request('/database-approvals?offset=0', { user: first })
  ).json();
  expect(list.items.find((item) => item.id === row.id)).toEqual(row);
  expect(list.items.length).toBeLessThanOrEqual(50);
  expect(
    (await h.request('/database-approvals?offset=-1', { user: first })).status,
  ).toBe(400);
});

test('approval history paginates without loading all retained requests', async () => {
  await Promise.all(Array.from({ length: 51 }, () => h.create()));
  const a = await (
    await h.request('/database-approvals?offset=0', { user: first })
  ).json();
  const b = await (
    await h.request('/database-approvals?offset=50', { user: first })
  ).json();
  expect(a.items).toHaveLength(50);
  expect(a.hasMore).toBe(true);
  expect(b.hasMore).toBe(false);
  expect(b.items.length).toBeGreaterThan(0);
  const ids = new Set(a.items.map((row) => row.id));
  expect(b.items.some((row) => ids.has(row.id))).toBe(false);
});
