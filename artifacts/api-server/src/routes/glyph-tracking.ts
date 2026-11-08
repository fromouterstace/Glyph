import { Router, type Request } from 'express';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import {
  db,
  glyphDeliveries,
  glyphSettings,
  glyphEvents,
  glyphLinks,
  glyphMessages,
} from '@workspace/db';
import { syncNative } from '../lib/gmail-native';
import { transparentGif } from '../lib/tracking-pixel';
import { logSafeError } from '../lib/logger';
import { consumeTrackingBudget } from '../lib/tracking-budget';
import { wantsEmailAlert } from '../lib/alert-policy';

const router = Router();

export async function recordSignal(
  messageId: string,
  type: 'open' | 'click',
  agent: string,
  url: string | null,
): Promise<boolean> {
  const automated =
    /bot|crawler|spider|scanner|safelinks|proofpoint|barracuda|mimecast|headless|preview/i.test(
      agent,
    );
  const proxy = /googleimageproxy|ggpht|google.*proxy/i.test(agent);
  const source = automated
    ? 'Suspected automated scanner'
    : proxy
      ? 'Google image proxy — open signal only'
      : 'Unverified client request';
  if (!(await consumeTrackingBudget(messageId, type))) return false;
  const id = randomUUID();
  await db.transaction(async (tx) => {
    const [event] = await tx
      .insert(glyphEvents)
      .values({
        id,
        messageId,
        type,
        url,
        automated,
        source,
        fingerprint: id,
      })
      .returning();
    const [message] = await tx
      .select()
      .from(glyphMessages)
      .where(eq(glyphMessages.id, messageId));
    const [settings] = await tx
      .select()
      .from(glyphSettings)
      .where(eq(glyphSettings.ownerId, message.ownerId));
    if (!wantsEmailAlert(settings, event)) return;
    const deliveryId = randomUUID();
    await tx
      .insert(glyphDeliveries)
      .values({
        id: deliveryId,
        messageId,
        eventId: event.id,
        ownerId: message.ownerId,
        type,
        consentAt: settings.emailAlertsSince!,
        mailbox: settings.alertMailbox!,
        rfcMessageId: `glyph-alert-${deliveryId}@notifications.glyph.invalid`,
      })
      .onConflictDoNothing();
  });
  return true;
}

async function recordOpen(
  message: typeof glyphMessages.$inferSelect | undefined,
  agent: string,
) {
  if (!message) return 'unknown_pixel';
  if (!message.trackOpens) return 'tracking_disabled';
  if (!['sent', 'sending', 'uncertain'].includes(message.status))
    return 'send_not_confirmed';
  return (await recordSignal(message.id, 'open', agent, null))
    ? 'recorded'
    : 'event_budget_exceeded';
}

async function reconcileNativeDraft(
  message: typeof glyphMessages.$inferSelect | undefined,
  req: Request,
) {
  if (
    !message ||
    message.deliverySource !== 'gmail' ||
    message.status !== 'draft'
  )
    return { message, limited: false, failed: false };
  if (!(await consumeTrackingBudget(message.id, 'reconcile')))
    return { message, limited: true, failed: false };
  try {
    await syncNative(message.ownerId, true);
    const [current] = await db
      .select()
      .from(glyphMessages)
      .where(eq(glyphMessages.id, message.id));
    return { message: current ?? message, limited: false, failed: false };
  } catch (err) {
    logSafeError(req.log, err, 'Native send verification deferred', 'warn');
    return { message, limited: false, failed: true };
  }
}

async function processPixelRequest(req: Request): Promise<void> {
  const token = String(req.params.token).replace(/\.gif$/, '');
  if (!/^[a-f0-9]{48}$/.test(token)) return;
  const [selected] = await db
    .select()
    .from(glyphMessages)
    .where(eq(glyphMessages.pixelToken, token));
  let message: typeof glyphMessages.$inferSelect | undefined = selected;
  const composeReferrer = /^https:\/\/mail\.google\.com(?:\/|$)/.test(
    req.get('referer') ?? '',
  );
  if (
    message?.deliverySource === 'gmail' &&
    message.status === 'draft' &&
    composeReferrer
  ) {
    req.log.info(
      { messageId: message.id, outcome: 'sender_compose_ignored' },
      'Tracking pixel request',
    );
    return;
  }
  const reconciliation = await reconcileNativeDraft(message, req);
  if (reconciliation.limited) {
    req.log.info(
      {
        messageId: message?.id ?? null,
        outcome: 'native_reconciliation_budget_exceeded',
      },
      'Tracking pixel request',
    );
    return;
  }
  if (reconciliation.failed) return;
  message = reconciliation.message;
  const outcome = await recordOpen(message, req.get('user-agent') ?? '');
  req.log.info(
    {
      messageId: message?.id ?? null,
      outcome,
      googleImageProxy: /googleimageproxy|ggpht|google.*proxy/i.test(
        req.get('user-agent') ?? '',
      ),
    },
    'Tracking pixel request',
  );
}

router.get('/glyph/t/:token', async (req, res): Promise<void> => {
  res.set({
    'Cache-Control': 'no-store, no-cache, must-revalidate, private, max-age=0',
    Pragma: 'no-cache',
    Expires: '0',
    'Content-Type': 'image/gif',
    'X-Content-Type-Options': 'nosniff',
  });
  if (req.method !== 'HEAD') {
    try {
      await processPixelRequest(req);
    } catch (err) {
      logSafeError(req.log, err, 'Pixel signal could not be recorded', 'warn');
    }
  }
  res.send(transparentGif);
});

router.get('/glyph/l/:token', async (req, res): Promise<void> => {
  res.set({
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
    'X-Robots-Tag': 'noindex, nofollow',
  });
  const token = String(req.params.token);
  if (!/^[a-f0-9]{48}$/.test(token)) {
    res.status(404).send('Link not found');
    return;
  }
  const [row] = await db
    .select({ link: glyphLinks, message: glyphMessages })
    .from(glyphLinks)
    .innerJoin(glyphMessages, eq(glyphLinks.messageId, glyphMessages.id))
    .where(eq(glyphLinks.token, token));
  if (!row) {
    res.status(404).send('Link not found');
    return;
  }
  if (req.method !== 'HEAD') {
    const reconciliation = await reconcileNativeDraft(row.message, req);
    row.message = reconciliation.message ?? row.message;
    if (reconciliation.limited)
      req.log.info(
        {
          messageId: row.message.id,
          outcome: 'native_reconciliation_budget_exceeded',
        },
        'Tracking link request',
      );
  }
  const canRecord = ['sent', 'sending', 'uncertain'].includes(
    row.message.status,
  );
  // Links must still work during Gmail's Undo Send delay or while confirmation is pending.
  if (!canRecord && row.message.deliverySource !== 'gmail') {
    res.status(404).send('Link not found');
    return;
  }
  const url = new URL(row.link.url);
  if (!['https:', 'http:'].includes(url.protocol)) {
    res.status(400).send('Invalid link');
    return;
  }
  if (req.method !== 'HEAD' && canRecord && row.message.trackClicks) {
    try {
      const recorded = await recordSignal(
        row.message.id,
        'click',
        req.get('user-agent') ?? '',
        row.link.url,
      );
      if (!recorded)
        req.log.info(
          { messageId: row.message.id, outcome: 'event_budget_exceeded' },
          'Tracking link request',
        );
    } catch (err) {
      logSafeError(req.log, err, 'Click signal could not be recorded', 'warn');
    }
  }
  res.redirect(302, row.link.url);
});

export default router;
