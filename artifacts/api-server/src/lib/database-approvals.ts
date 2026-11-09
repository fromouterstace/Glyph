import { randomUUID } from 'node:crypto';
import { desc, eq } from 'drizzle-orm';
import { db, glyphDatabaseApprovals } from '@workspace/db';
import {
  databaseApprovalDigest,
  databaseApprovalStatus,
  type ApprovalSlot,
} from './database-approval-policy';

type Row = typeof glyphDatabaseApprovals.$inferSelect;
type Plan = Pick<Row, 'operation' | 'target' | 'planSha256' | 'reason'>;
type Actor = { userId: string; slot: ApprovalSlot };
type Verify = (userId: string) => Promise<ApprovalSlot | null>;
export class DatabaseApprovalError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function approvalView(row: Row) {
  return {
    id: row.id,
    operation: row.operation,
    target: row.target,
    planSha256: row.planSha256,
    reason: row.reason,
    digest: row.digest,
    environment: row.environment,
    requestedBy: row.requestedBy,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    firstApprovedAt: row.firstApprovedAt?.toISOString() ?? null,
    secondApprovedAt: row.secondApprovedAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
    consumedAt: row.consumedAt?.toISOString() ?? null,
    status: databaseApprovalStatus(row),
  };
}

export async function listDatabaseApprovals(offset: number) {
  const rows = await db
    .select()
    .from(glyphDatabaseApprovals)
    .orderBy(
      desc(glyphDatabaseApprovals.createdAt),
      desc(glyphDatabaseApprovals.id),
    )
    .limit(51)
    .offset(offset);
  return {
    items: rows.slice(0, 50).map(approvalView),
    hasMore: rows.length > 50,
    offset,
  };
}

export async function createDatabaseApproval(requestedBy: string, input: Plan) {
  const createdAt = new Date(Date.now());
  const plan = {
    ...input,
    id: randomUUID(),
    requestedBy,
    createdAt,
    expiresAt: new Date(createdAt.getTime() + 60 * 60_000),
    environment:
      process.env.NODE_ENV === 'production' ? 'production' : 'development',
  };
  const [row] = await db
    .insert(glyphDatabaseApprovals)
    .values({
      ...plan,
      digest: databaseApprovalDigest(plan),
    })
    .returning();
  return approvalView(row);
}

function approveChange(row: Row, actor: Actor): Partial<Row> | null {
  const other = actor.slot === 'first' ? row.secondUserId : row.firstUserId;
  const previous = actor.slot === 'first' ? row.firstUserId : row.secondUserId;
  if (other === actor.userId || (previous && previous !== actor.userId))
    throw new DatabaseApprovalError(
      409,
      'Two distinct designated accounts are required.',
    );
  if (previous) return null;
  return actor.slot === 'first'
    ? { firstUserId: actor.userId, firstApprovedAt: new Date(Date.now()) }
    : { secondUserId: actor.userId, secondApprovedAt: new Date(Date.now()) };
}

async function consumeChange(
  row: Row,
  actor: Actor,
  verify: Verify,
): Promise<Partial<Row>> {
  if (
    databaseApprovalStatus(row) !== 'approved' ||
    !row.firstUserId ||
    !row.secondUserId ||
    row.firstUserId === row.secondUserId
  )
    throw new DatabaseApprovalError(
      409,
      'Both designated accounts must approve first.',
    );
  const slots = await Promise.all([
    verify(row.firstUserId),
    verify(row.secondUserId),
  ]);
  if (slots[0] !== 'first' || slots[1] !== 'second')
    throw new DatabaseApprovalError(
      409,
      'An approver no longer has a verified designated address.',
    );
  if (row.expiresAt.getTime() <= Date.now())
    throw new DatabaseApprovalError(409, 'This authorization has expired.');
  if (![row.firstUserId, row.secondUserId].includes(actor.userId))
    throw new DatabaseApprovalError(
      409,
      'Only a signing account can claim this authorization.',
    );
  return { consumedAt: new Date(Date.now()), consumedBy: actor.userId };
}

export async function actOnDatabaseApproval(
  id: string,
  digest: string,
  action: 'approve' | 'revoke' | 'consume',
  actor: Actor,
  verify: Verify,
) {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(glyphDatabaseApprovals)
      .where(eq(glyphDatabaseApprovals.id, id))
      .for('update');
    if (!row)
      throw new DatabaseApprovalError(404, 'Approval request not found.');
    if (row.digest !== digest || row.digest !== databaseApprovalDigest(row))
      throw new DatabaseApprovalError(
        409,
        'The exact operation digest does not match.',
      );
    const status = databaseApprovalStatus(row);
    const environment =
      process.env.NODE_ENV === 'production' ? 'production' : 'development';
    if (row.environment !== environment)
      throw new DatabaseApprovalError(
        409,
        'Cross-environment authorization is blocked.',
      );
    if (!['pending', 'approved'].includes(status))
      throw new DatabaseApprovalError(
        409,
        'This request is expired, revoked or already used.',
      );
    let change: Partial<Row> | null;
    if (action === 'revoke') {
      change = { revokedAt: new Date(Date.now()), revokedBy: actor.userId };
    } else if (action === 'approve') {
      change = approveChange(row, actor);
    } else {
      change = await consumeChange(row, actor, verify);
    }
    if (!change) return approvalView(row);
    const [saved] = await tx
      .update(glyphDatabaseApprovals)
      .set(change)
      .where(eq(glyphDatabaseApprovals.id, id))
      .returning();
    return approvalView(saved);
  });
}
