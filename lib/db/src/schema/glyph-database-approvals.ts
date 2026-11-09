import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

export const glyphDatabaseApprovals = pgTable(
  'glyph_database_approvals',
  {
    id: text('id').primaryKey(),
    operation: text('operation').notNull(),
    target: text('target').notNull(),
    planSha256: text('plan_sha256').notNull(),
    reason: text('reason').notNull(),
    digest: text('digest').notNull(),
    environment: text('environment').notNull(),
    requestedBy: text('requested_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    firstUserId: text('first_user_id'),
    firstApprovedAt: timestamp('first_approved_at', { withTimezone: true }),
    secondUserId: text('second_user_id'),
    secondApprovedAt: timestamp('second_approved_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedBy: text('revoked_by'),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    consumedBy: text('consumed_by'),
  },
  (t) => [
    index('glyph_database_approvals_created_idx').on(t.createdAt, t.id),
    check(
      'glyph_database_approvals_operation_check',
      sql`${t.operation} in ('delete_rows', 'truncate_table', 'drop_object', 'change_privileges')`,
    ),
    check(
      'glyph_database_approvals_environment_check',
      sql`${t.environment} in ('development', 'production')`,
    ),
    check(
      'glyph_database_approvals_digest_check',
      sql`${t.digest} ~ '^[a-f0-9]{64}$' and ${t.planSha256} ~ '^[a-f0-9]{64}$'`,
    ),
    check(
      'glyph_database_approvals_identity_check',
      sql`(${t.firstUserId} is null) = (${t.firstApprovedAt} is null)
        and (${t.secondUserId} is null) = (${t.secondApprovedAt} is null)
        and (${t.revokedAt} is null) = (${t.revokedBy} is null)
        and (${t.consumedAt} is null) = (${t.consumedBy} is null)
        and (${t.firstUserId} is null or ${t.secondUserId} is null or ${t.firstUserId} <> ${t.secondUserId})`,
    ),
    check(
      'glyph_database_approvals_lifetime_check',
      sql`${t.expiresAt} > ${t.createdAt} and ${t.expiresAt} <= ${t.createdAt} + interval '1 hour'`,
    ),
    check(
      'glyph_database_approvals_input_check',
      sql`${t.target} ~ '^[a-zA-Z0-9_.:-]{1,200}$'
        and length(trim(${t.reason})) between 10 and 2000`,
    ),
    check(
      'glyph_database_approvals_signing_time_check',
      sql`(${t.firstApprovedAt} is null or (${t.firstApprovedAt} >= ${t.createdAt} and ${t.firstApprovedAt} < ${t.expiresAt}))
        and (${t.secondApprovedAt} is null or (${t.secondApprovedAt} >= ${t.createdAt} and ${t.secondApprovedAt} < ${t.expiresAt}))`,
    ),
    check(
      'glyph_database_approvals_consumption_check',
      sql`${t.consumedAt} is null or
        (${t.firstApprovedAt} is not null and ${t.secondApprovedAt} is not null
        and ${t.revokedAt} is null and ${t.consumedAt} < ${t.expiresAt}
        and ${t.consumedBy} in (${t.firstUserId}, ${t.secondUserId}))`,
    ),
  ],
);
