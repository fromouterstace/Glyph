import { and, asc, gt, isNotNull } from 'drizzle-orm';
import { db, glyphGmailConnections } from '@workspace/db';
import { syncLabelImport } from './gmail-label-import';
import { logger, logSafeError } from './logger';

// One bounded batch per minute. Durable import cursors survive process restarts.
export function startLabelImportWorker() {
  let stopped = false;
  let running = false;
  let afterOwner = '';
  const run = async () => {
    if (stopped || running) return;
    running = true;
    try {
      const owners = await db
        .select({ ownerId: glyphGmailConnections.ownerId })
        .from(glyphGmailConnections)
        .where(
          and(
            isNotNull(glyphGmailConnections.encryptedTokens),
            gt(glyphGmailConnections.ownerId, afterOwner),
          ),
        )
        .orderBy(asc(glyphGmailConnections.ownerId))
        .limit(10);
      if (!owners.length) afterOwner = '';
      for (const { ownerId } of owners) {
        if (stopped) break;
        afterOwner = ownerId;
        try {
          await syncLabelImport(ownerId);
        } catch (error) {
          logSafeError(
            logger,
            error,
            'Automatic label import deferred',
            'warn',
          );
        }
      }
    } catch (error) {
      logSafeError(logger, error, 'Label import worker unavailable', 'warn');
    } finally {
      running = false;
    }
  };
  void run();
  const timer = setInterval(() => {
    void run();
  }, 60_000);
  timer.unref();
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
