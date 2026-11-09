import { afterAll, beforeAll, expect, test } from 'vitest';
import { approvalHarness, first } from './helpers/database-approvals.mjs';
import { databaseApprovalDigest } from '../../artifacts/api-server/src/lib/database-approval-policy.ts';
let h;
beforeAll(async () => {
  h = await approvalHarness();
});
afterAll(async () => {
  await h?.close();
});

test('PostgreSQL rejects malformed digests, lifecycle values and same-user dual signing', async () => {
  const row = await h.create();
  for (const set of [
    "digest='invalid'",
    "environment='unknown'",
    "operation='execute_sql'",
    "expires_at=created_at+interval '2 hours'",
    "first_user_id='same',second_user_id='same',first_approved_at=created_at,second_approved_at=created_at",
    "consumed_at=created_at,consumed_by='actor'",
    'revoked_at=created_at',
    "reason='short'",
    "target='invalid target'",
    "first_user_id='actor',first_approved_at=expires_at",
  ]) {
    await expect(
      h.sql(`UPDATE glyph_database_approvals SET ${set} WHERE id=$1`, [row.id]),
    ).rejects.toMatchObject({ code: '23514' });
  }
});
test('tampered operation metadata invalidates previously supplied digests', async () => {
  const row = await h.create();
  await h.sql(
    "UPDATE glyph_database_approvals SET target='public.other' WHERE id=$1",
    [row.id],
  );
  expect((await h.action(row, first, 'approve')).status).toBe(409);
});
test('cross-environment records cannot be approved even with a correctly recomputed digest', async () => {
  const row = await h.create();
  const digest = databaseApprovalDigest({
    ...row,
    environment: 'production',
    createdAt: new Date(row.createdAt),
    expiresAt: new Date(row.expiresAt),
  });
  await h.sql(
    "UPDATE glyph_database_approvals SET environment='production',digest=$2 WHERE id=$1",
    [row.id, digest],
  );
  expect((await h.action(row, first, 'approve', digest)).status).toBe(409);
});
test('missing requests, invalid identifiers and action-body escalation fail explicitly', async () => {
  const row = await h.create();
  expect(
    (
      await h.action(
        { ...row, id: '00000000-0000-4000-8000-000000000000' },
        first,
        'approve',
      )
    ).status,
  ).toBe(404);
  expect(
    (await h.action({ ...row, id: 'invalid' }, first, 'approve')).status,
  ).toBe(400);
  expect((await h.action(row, first, 'execute')).status).toBe(400);
  expect(
    (
      await h.request(`/database-approvals/${row.id}/action`, {
        user: first,
        method: 'POST',
        body: { action: 'approve', digest: row.digest, slot: 'second' },
      })
    ).status,
  ).toBe(400);
});
