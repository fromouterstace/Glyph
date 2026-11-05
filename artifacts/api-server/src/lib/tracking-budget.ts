import { and, lt, ne, or, sql } from 'drizzle-orm';
import { db, glyphTrackingBudgets } from '@workspace/db';

export const TRACKING_BUDGETS = {
  open: { windowSeconds: 60, windowLimit: 120, dayLimit: 2000 },
  click: { windowSeconds: 60, windowLimit: 300, dayLimit: 5000 },
  reconcile: { windowSeconds: 5, windowLimit: 1, dayLimit: 50 },
} as const;

export type TrackingBudgetKind = keyof typeof TRACKING_BUDGETS;

/** Atomically admits a request across all API instances using PostgreSQL. */
export async function consumeTrackingBudget(
  messageId: string,
  kind: TrackingBudgetKind,
  now = Date.now(),
): Promise<boolean> {
  const budget = TRACKING_BUDGETS[kind];
  const windowBucket = Math.floor(now / (budget.windowSeconds * 1000));
  const dayBucket = Math.floor(now / 86_400_000);
  const [admitted] = await db
    .insert(glyphTrackingBudgets)
    .values({
      messageId,
      kind,
      windowBucket,
      windowCount: 1,
      dayBucket,
      dayCount: 1,
      updatedAt: new Date(now),
    })
    .onConflictDoUpdate({
      target: [glyphTrackingBudgets.messageId, glyphTrackingBudgets.kind],
      set: {
        windowBucket,
        windowCount: sql`case
          when ${glyphTrackingBudgets.windowBucket} <> ${windowBucket} then 1
          else ${glyphTrackingBudgets.windowCount} + 1
        end`,
        dayBucket,
        dayCount: sql`case
          when ${glyphTrackingBudgets.dayBucket} <> ${dayBucket} then 1
          else ${glyphTrackingBudgets.dayCount} + 1
        end`,
        updatedAt: new Date(now),
      },
      setWhere: and(
        or(
          ne(glyphTrackingBudgets.windowBucket, windowBucket),
          lt(glyphTrackingBudgets.windowCount, budget.windowLimit),
        ),
        or(
          ne(glyphTrackingBudgets.dayBucket, dayBucket),
          lt(glyphTrackingBudgets.dayCount, budget.dayLimit),
        ),
      ),
    })
    .returning({ messageId: glyphTrackingBudgets.messageId });

  return Boolean(admitted);
}
