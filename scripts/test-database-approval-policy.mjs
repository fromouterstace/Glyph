import test from 'node:test';
import assert from 'node:assert/strict';
import {
  databaseApprovalSlot,
  databaseApprovalDigest,
  databaseApprovalStatus,
  DATABASE_APPROVERS,
} from '../artifacts/api-server/src/lib/database-approval-policy.ts';
const identity = (...addresses) => ({
  emailAddresses: addresses.map((emailAddress) => ({
    emailAddress,
    verification: { status: 'verified' },
  })),
});
test('only one verified designated identity grants a slot', () => {
  assert.equal(
    databaseApprovalSlot(identity(DATABASE_APPROVERS.first.toUpperCase())),
    'first',
  );
  assert.equal(
    databaseApprovalSlot(identity(DATABASE_APPROVERS.second)),
    'second',
  );
  assert.equal(
    databaseApprovalSlot(identity('outsider@example.invalid')),
    null,
  );
  assert.equal(
    databaseApprovalSlot(identity(...Object.values(DATABASE_APPROVERS))),
    null,
  );
  assert.equal(
    databaseApprovalSlot({
      emailAddresses: [{ emailAddress: DATABASE_APPROVERS.first }],
    }),
    null,
  );
});
test('every immutable plan attribute is bound to the request digest', () => {
  const row = {
    id: 'request',
    operation: 'delete_rows',
    target: 'public.glyph_messages',
    planSha256: 'a'.repeat(64),
    reason: 'Reviewed change',
    environment: 'development',
    requestedBy: 'user',
    createdAt: new Date(0),
    expiresAt: new Date(3600000),
  };
  const digest = databaseApprovalDigest(row);
  assert.match(digest, /^[a-f0-9]{64}$/);
  for (const key of Object.keys(row)) {
    const changed =
      row[key] instanceof Date ? new Date(1) : `${row[key]}changed`;
    assert.notEqual(
      databaseApprovalDigest({ ...row, [key]: changed }),
      digest,
      key,
    );
  }
});
test('terminal states take precedence and expiry is inclusive', () => {
  const row = {
    expiresAt: new Date(10),
    firstApprovedAt: null,
    secondApprovedAt: null,
    revokedAt: null,
    consumedAt: null,
  };
  assert.equal(databaseApprovalStatus(row, 0), 'pending');
  row.firstApprovedAt = row.secondApprovedAt = new Date(0);
  assert.equal(databaseApprovalStatus(row, 0), 'approved');
  assert.equal(databaseApprovalStatus(row, 10), 'expired');
  row.revokedAt = new Date(1);
  assert.equal(databaseApprovalStatus(row, 10), 'revoked');
  row.consumedAt = new Date(2);
  assert.equal(databaseApprovalStatus(row, 10), 'consumed');
});
