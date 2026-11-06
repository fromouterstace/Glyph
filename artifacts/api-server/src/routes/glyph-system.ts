import { Router } from 'express';
import { clerkClient, getAuth } from '@clerk/express';
import { and, count, desc, eq, gte } from 'drizzle-orm';
import { createHash, randomUUID } from 'node:crypto';
import {
  db,
  glyphEvents,
  glyphMessages,
  glyphSystemEvents,
} from '@workspace/db';
import {
  GetSystemAccessResponse,
  GetSystemSummaryResponse,
} from '@workspace/api-zod';
import {
  isSameTrustedOrigin,
  getTrustedRequestOrigin,
} from '../middlewares/clerkProxyMiddleware';
import { isSystemAdmin } from '../lib/system-admin';

const router = Router();
const sessionFingerprint = (sessionId: string) =>
  createHash('sha256').update(sessionId).digest('hex');

router.use((_req, res, next) => {
  res.set('Cache-Control', 'private, no-store');
  next();
});

async function adminCheck(userId: string | null) {
  return isSystemAdmin(userId, process.env.GLYPH_ADMIN_EMAILS, async (id) =>
    clerkClient.users.getUser(id),
  );
}

async function recordSessionEvent(
  ownerId: string,
  sessionId: string,
  eventType: 'login_observed' | 'admin_access_denied',
) {
  await db
    .insert(glyphSystemEvents)
    .values({
      id: randomUUID(),
      ownerId,
      eventType,
      sessionFingerprint: sessionFingerprint(sessionId),
    })
    .onConflictDoNothing();
}

router.get('/glyph/system/access', async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  if (!userId) {
    res.status(401).json({ error: 'Sign in to continue.' });
    return;
  }
  res.json(
    GetSystemAccessResponse.parse({
      isSystemAdmin: await adminCheck(userId),
    }),
  );
});

router.post('/glyph/system/session', async (req, res): Promise<void> => {
  const { userId, sessionId } = getAuth(req);
  if (!userId || !sessionId) {
    res.status(401).json({ error: 'A signed-in session is required.' });
    return;
  }
  if (!isSameTrustedOrigin(req.get('origin'), getTrustedRequestOrigin(req))) {
    res
      .status(403)
      .json({ error: 'A same-origin browser request is required.' });
    return;
  }
  await recordSessionEvent(userId, sessionId, 'login_observed');
  res.json({ ok: true });
});

router.get('/glyph/system/summary', async (req, res): Promise<void> => {
  const { userId, sessionId } = getAuth(req);
  if (!userId) {
    res.status(401).json({ error: 'Sign in to continue.' });
    return;
  }
  if (!(await adminCheck(userId))) {
    if (sessionId)
      await recordSessionEvent(userId, sessionId, 'admin_access_denied');
    res.status(403).json({ error: 'System access is restricted.' });
    return;
  }

  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const [
    usersTotal,
    [emailsSentTotal],
    [emailsSentLast30Days],
    [loginSessionsTotal],
    [loginSessionsLast24Hours],
    [adminAccessDeniedSessions],
    recentDenials,
    eventCounts,
  ] = await Promise.all([
    clerkClient.users.getCount(),
    db
      .select({ value: count() })
      .from(glyphMessages)
      .where(eq(glyphMessages.status, 'sent')),
    db
      .select({ value: count() })
      .from(glyphMessages)
      .where(
        and(
          eq(glyphMessages.status, 'sent'),
          gte(glyphMessages.sentAt, thirtyDaysAgo),
        ),
      ),
    db
      .select({ value: count() })
      .from(glyphSystemEvents)
      .where(eq(glyphSystemEvents.eventType, 'login_observed')),
    db
      .select({ value: count() })
      .from(glyphSystemEvents)
      .where(
        and(
          eq(glyphSystemEvents.eventType, 'login_observed'),
          gte(glyphSystemEvents.occurredAt, dayAgo),
        ),
      ),
    db
      .select({ value: count() })
      .from(glyphSystemEvents)
      .where(eq(glyphSystemEvents.eventType, 'admin_access_denied')),
    db
      .select({ occurredAt: glyphSystemEvents.occurredAt })
      .from(glyphSystemEvents)
      .where(eq(glyphSystemEvents.eventType, 'admin_access_denied'))
      .orderBy(desc(glyphSystemEvents.occurredAt))
      .limit(10),
    db
      .select({ type: glyphEvents.type, value: count() })
      .from(glyphEvents)
      .groupBy(glyphEvents.type),
  ]);

  const signalCounts = new Map(
    eventCounts.map((event) => [event.type, event.value]),
  );
  res.json(
    GetSystemSummaryResponse.parse({
      usersTotal,
      loginSessionsTotal: loginSessionsTotal.value,
      loginSessionsLast24Hours: loginSessionsLast24Hours.value,
      emailsSentTotal: emailsSentTotal.value,
      emailsSentLast30Days: emailsSentLast30Days.value,
      pixelLoadsTotal: signalCounts.get('open') ?? 0,
      linkClicksTotal: signalCounts.get('click') ?? 0,
      repliesTotal: signalCounts.get('reply') ?? 0,
      adminAccessDeniedSessions: adminAccessDeniedSessions.value,
      recentAdminAccessDenials: recentDenials.map((event) =>
        event.occurredAt.toISOString(),
      ),
    }),
  );
});

export default router;
