import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest';
import {
  approvalHarness,
  edge,
  first,
  second,
  resetApprovers,
  DATABASE_APPROVERS,
} from './helpers/database-approvals.mjs';
let h;
beforeAll(async () => {
  h = await approvalHarness();
});
beforeEach(resetApprovers);
afterAll(async () => {
  await h?.close();
});

test('two independent verified accounts must sign the exact digest; creation is not approval', async () => {
  const row = await h.create();
  expect((await h.action(row, first, 'consume')).status).toBe(409);
  expect((await h.action(row, first, 'approve', 'b'.repeat(64))).status).toBe(
    409,
  );
  const approved = await (await h.action(row, first, 'approve')).json();
  expect(approved.firstApprovedAt).not.toBeNull();
  expect(approved.secondApprovedAt).toBeNull();
  expect((await h.action(row, first, 'consume')).status).toBe(409);
  expect(await (await h.action(row, first, 'approve')).json()).toEqual(
    approved,
  );
  const both = await (await h.action(row, second, 'approve')).json();
  expect(both.status).toBe('approved');
  expect(both.secondApprovedAt).not.toBeNull();
});
test('only one concurrent consumer succeeds and no protected SQL operation executes', async () => {
  const row = await h.create();
  await h.action(row, first, 'approve');
  await h.action(row, second, 'approve');
  const results = await Promise.all([
    h.action(row, first, 'consume'),
    h.action(row, second, 'consume'),
  ]);
  expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
  const stored = (
    await h.sql('SELECT * FROM glyph_database_approvals WHERE id=$1', [row.id])
  ).rows[0];
  expect(stored.consumed_at).not.toBeNull();
  expect([first, second]).toContain(stored.consumed_by);
  expect(
    (await h.sql("SELECT to_regclass('glyph_messages') AS name")).rows[0].name,
  ).toBe('glyph_messages');
  expect((await h.action(row, first, 'revoke')).status).toBe(409);
});
test('either approver can revoke, but expired requests cannot gain approval', async () => {
  const row = await h.create();
  expect((await (await h.action(row, second, 'revoke')).json()).status).toBe(
    'revoked',
  );
  expect((await h.action(row, first, 'approve')).status).toBe(409);
  const expiring = await h.create();
  const previous = edge.now;
  edge.now = Date.parse(expiring.expiresAt);
  try {
    expect((await h.action(expiring, first, 'approve')).status).toBe(409);
  } finally {
    edge.now = previous;
  }
});
test('consumption revalidates both stored signers and fails on identity loss or outage', async () => {
  const row = await h.create();
  await h.action(row, first, 'approve');
  await h.action(row, second, 'approve');
  edge.getUser.mockImplementation(async () => ({ emailAddresses: [] }));
  expect((await h.action(row, first, 'consume')).status).toBe(403);
  resetApprovers();
  const normal = edge.getUser.getMockImplementation();
  edge.getUser.mockImplementation(async (id) =>
    id === first ? { emailAddresses: [] } : normal(id),
  );
  expect((await h.action(row, second, 'consume')).status).toBe(409);
  resetApprovers();
  edge.getUser.mockRejectedValueOnce(new Error('outage'));
  expect((await h.action(row, second, 'consume')).status).toBe(503);
  resetApprovers();
  edge.getUser.mockImplementation(async (id) => {
    if (id === first) throw new Error('signer revalidation outage');
    return normal(id);
  });
  expect((await h.action(row, second, 'consume')).status).toBe(503);
  const stored = (
    await h.sql(
      'SELECT consumed_at FROM glyph_database_approvals WHERE id=$1',
      [row.id],
    )
  ).rows[0];
  expect(stored.consumed_at).toBeNull();
});

test('moving a designated email cannot let one Clerk account sign both slots', async () => {
  const row = await h.create();
  await h.action(row, first, 'approve');
  edge.getUser.mockResolvedValue({
    emailAddresses: [
      {
        emailAddress: DATABASE_APPROVERS.second,
        verification: { status: 'verified' },
      },
    ],
  });
  expect((await h.action(row, first, 'approve')).status).toBe(409);
});
