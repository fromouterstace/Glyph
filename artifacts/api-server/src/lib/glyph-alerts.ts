import { and, eq, inArray, lt, or, desc } from 'drizzle-orm';
import {
  db,
  glyphDeliveries,
  glyphEvents,
  glyphMessages,
  glyphSettings,
} from '@workspace/db';
import {
  escapeHtml,
  findSentMessage,
  userGmailRequest,
  userMailboxEmail,
  mimeMessage,
  ownsMailbox,
} from './gmail';
import { logger, logSafeError } from './logger';
import {
  alertCaveat,
  deliverAlert,
  wantsEmailAlert,
  withinDeadline,
} from './alert-policy';

let running = false;

export async function drainAlerts() {
  if (running) return;
  running = true;
  try {
    const now = new Date();
    const rows = await db
      .select()
      .from(glyphDeliveries)
      .where(
        or(
          eq(glyphDeliveries.status, 'pending'),
          and(
            inArray(glyphDeliveries.status, ['sending', 'uncertain']),
            lt(glyphDeliveries.updatedAt, new Date(now.getTime() - 5 * 60_000)),
          ),
        ),
      )
      .orderBy(glyphDeliveries.updatedAt)
      .limit(25);
    async function processDelivery(
      delivery: typeof glyphDeliveries.$inferSelect,
    ) {
      try {
        const [settings] = await db
          .select()
          .from(glyphSettings)
          .where(eq(glyphSettings.ownerId, delivery.ownerId));
        const [row] = await db
          .select({ event: glyphEvents, message: glyphMessages })
          .from(glyphEvents)
          .innerJoin(glyphMessages, eq(glyphEvents.messageId, glyphMessages.id))
          .where(eq(glyphEvents.id, delivery.eventId));
        if (!row) return;
        if (delivery.status === 'pending') {
          if (
            !wantsEmailAlert(settings, row.event, delivery.consentAt) ||
            now.getTime() - delivery.createdAt.getTime() > 24 * 60 * 60_000
          ) {
            await db
              .update(glyphDeliveries)
              .set({ status: 'suppressed', updatedAt: now })
              .where(
                and(
                  eq(glyphDeliveries.id, delivery.id),
                  eq(glyphDeliveries.status, 'pending'),
                ),
              );
            return;
          }
          // A sending/uncertain tracked email isn't yet confirmed in Sent.
          if (row.message.status !== 'sent') {
            await db
              .update(glyphDeliveries)
              .set({ updatedAt: now })
              .where(eq(glyphDeliveries.id, delivery.id));
            return;
          }
          // Limit a burst across different tracked emails to one alert/minute.
          // Atomic owner-row lock in claim below also enforces this across workers.
        }
        // Recheck ownership even for reconciliation: a reconnected mailbox must
        // never be used to send or search another owner's notification.
        if (
          !(await withinDeadline(ownsMailbox(delivery.ownerId))) ||
          delivery.mailbox !==
            (await withinDeadline(userMailboxEmail(delivery.ownerId)))
        ) {
          // Keep pending work through temporary outages, subject to its expiry.
          await db
            .update(glyphDeliveries)
            .set({ updatedAt: now })
            .where(eq(glyphDeliveries.id, delivery.id));
          return;
        }
        await deliverAlert(delivery.status, {
          claim: async () =>
            db.transaction(async (tx) => {
              const [current] = await tx
                .select()
                .from(glyphSettings)
                .where(eq(glyphSettings.ownerId, delivery.ownerId))
                .for('update');
              if (
                !wantsEmailAlert(current, row.event, delivery.consentAt) ||
                current.alertMailbox !== delivery.mailbox
              )
                return false;
              const [recent] = await tx
                .select()
                .from(glyphDeliveries)
                .where(
                  and(
                    eq(glyphDeliveries.ownerId, delivery.ownerId),
                    inArray(glyphDeliveries.status, [
                      'sending',
                      'sent',
                      'uncertain',
                    ]),
                  ),
                )
                .orderBy(desc(glyphDeliveries.updatedAt))
                .limit(1);
              if (recent && recent.updatedAt.getTime() > Date.now() - 60_000)
                return false;
              const claimed = await tx
                .update(glyphDeliveries)
                .set({ status: 'sending', updatedAt: new Date() })
                .where(
                  and(
                    eq(glyphDeliveries.id, delivery.id),
                    eq(glyphDeliveries.status, 'pending'),
                  ),
                )
                .returning();
              return claimed.length === 1;
            }),
          send: async () => {
            const mailbox = delivery.mailbox;
            const title = `Glyph: ${delivery.type === 'open' ? 'Open' : 'Click'} signal`;
            const body = `${title}\n\nTracked email: ${row.message.subject}\nAddressed to: ${row.message.recipientEmail}\nSignal received: ${row.event.occurredAt.toISOString()}\n\n${alertCaveat}\n\nOne alert per signal type per email. Manage email alerts in Glyph Settings.`;
            // No tracking pixel or tracked links: self-notifications can't loop.
            const response = await withinDeadline(
              userGmailRequest(delivery.ownerId, '/messages/send', {
                method: 'POST',
                body: JSON.stringify({
                  raw: mimeMessage({
                    from: mailbox,
                    to: mailbox,
                    subject: title,
                    body,
                    html: `<pre>${escapeHtml(body)}</pre>`,
                    rfcMessageId: delivery.rfcMessageId,
                  }),
                }),
              }),
            );
            if (!response.ok)
              throw new Error('Alert send outcome not confirmed');
            const result = (await withinDeadline(response.json())) as {
              id?: string;
            };
            if (!result.id)
              throw new Error('Alert send response missing message ID');
            return result.id;
          },
          reconcile: () =>
            withinDeadline(
              findSentMessage(delivery.ownerId, delivery.rfcMessageId),
            ),
          finish: async (status, gmailId) => {
            await db
              .update(glyphDeliveries)
              .set({ status, gmailId, updatedAt: new Date() })
              .where(
                and(
                  eq(glyphDeliveries.id, delivery.id),
                  inArray(
                    glyphDeliveries.status,
                    status === 'sent'
                      ? ['sending', 'uncertain', 'sent']
                      : ['sending', 'uncertain'],
                  ),
                ),
              );
          },
        });
      } catch (err) {
        logSafeError(
          logger,
          err,
          'Email alert deferred; uncertain sends are never retried',
          'warn',
        );
        // Avoid a failed preflight starving other queued alerts.
        await db
          .update(glyphDeliveries)
          .set({ updatedAt: new Date() })
          .where(eq(glyphDeliveries.id, delivery.id));
      }
    }
    for (const delivery of rows) await processDelivery(delivery);
  } catch (err) {
    logSafeError(logger, err, 'Email alert queue unavailable');
  } finally {
    running = false;
  }
}

export function startAlertWorker() {
  void drainAlerts();
  const timer = setInterval(() => {
    void drainAlerts();
  }, 30_000);
  timer.unref();
  return () => clearInterval(timer);
}
