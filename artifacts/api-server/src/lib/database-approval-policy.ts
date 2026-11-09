import { createHash } from 'node:crypto';
import type { SystemAdminIdentity } from './system-admin';

export const DATABASE_APPROVERS = {
  first: 'stacydbradford@gmail.com',
  second: 'glyph.test.email@gmail.com',
} as const;
export type ApprovalSlot = keyof typeof DATABASE_APPROVERS;

export function databaseApprovalSlot(
  user: SystemAdminIdentity,
): ApprovalSlot | null {
  const slots = (Object.keys(DATABASE_APPROVERS) as ApprovalSlot[]).filter(
    (slot) =>
      user.emailAddresses.some(
        (email) =>
          email.verification?.status === 'verified' &&
          email.emailAddress.toLowerCase() === DATABASE_APPROVERS[slot],
      ),
  );
  return slots.length === 1 ? slots[0]! : null;
}

export function databaseApprovalDigest(plan: {
  id: string;
  operation: string;
  target: string;
  planSha256: string;
  reason: string;
  environment: string;
  requestedBy: string;
  createdAt: Date;
  expiresAt: Date;
}) {
  return createHash('sha256')
    .update(
      JSON.stringify([
        plan.id,
        plan.operation,
        plan.target,
        plan.planSha256,
        plan.reason,
        plan.environment,
        plan.requestedBy,
        plan.createdAt.toISOString(),
        plan.expiresAt.toISOString(),
      ]),
    )
    .digest('hex');
}

export function databaseApprovalStatus(
  row: {
    expiresAt: Date;
    firstApprovedAt: Date | null;
    secondApprovedAt: Date | null;
    revokedAt: Date | null;
    consumedAt: Date | null;
  },
  now = Date.now(),
) {
  if (row.consumedAt) return 'consumed' as const;
  if (row.revokedAt) return 'revoked' as const;
  if (row.expiresAt.getTime() <= now) return 'expired' as const;
  if (row.firstApprovedAt && row.secondApprovedAt) return 'approved' as const;
  return 'pending' as const;
}
