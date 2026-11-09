import { eq, sql } from 'drizzle-orm';
import { db, glyphPixelDiagnostics } from '@workspace/db';
import { logger, logSafeError } from './logger';
import { createPixelDiagnosticBudget } from './pixel-diagnostic-budget';

export const PIXEL_OUTCOMES = [
  'recorded',
  'sender_compose_ignored',
  'tracking_disabled',
  'send_not_confirmed',
  'unknown_token',
  'event_budget_exceeded',
  'native_reconciliation_budget_exceeded',
  'native_reconciliation_failed',
] as const;
export type PixelOutcome = (typeof PIXEL_OUTCOMES)[number];

const writeBudget = createPixelDiagnosticBudget();

export async function recordPixelDiagnostic(
  messageId: string | null,
  outcome: PixelOutcome,
) {
  const release = writeBudget.acquire(outcome);
  if (!release) return;
  const day = new Date();
  day.setUTCHours(0, 0, 0, 0);
  try {
    await db
      .insert(glyphPixelDiagnostics)
      .values({ scope: messageId ?? 'unknown', messageId, day, outcome })
      .onConflictDoUpdate({
        target: [
          glyphPixelDiagnostics.scope,
          glyphPixelDiagnostics.day,
          glyphPixelDiagnostics.outcome,
        ],
        set: { requests: sql`${glyphPixelDiagnostics.requests} + 1` },
      });
  } catch (error) {
    logSafeError(logger, error, 'Pixel diagnostic unavailable', 'warn');
  } finally {
    release();
  }
}

// Caller must verify message ownership before reading.
export async function messagePixelDiagnostics(messageId: string) {
  const rows = await db
    .select({
      outcome: glyphPixelDiagnostics.outcome,
      requests: sql<number>`sum(${glyphPixelDiagnostics.requests})::int`,
    })
    .from(glyphPixelDiagnostics)
    .where(eq(glyphPixelDiagnostics.messageId, messageId))
    .groupBy(glyphPixelDiagnostics.outcome);
  return PIXEL_OUTCOMES.map((outcome) => ({
    outcome,
    // Unknown tokens cannot safely be attributed to a message or tenant.
    requests:
      outcome === 'unknown_token'
        ? null
        : (rows.find((row) => row.outcome === outcome)?.requests ?? 0),
  }));
}
