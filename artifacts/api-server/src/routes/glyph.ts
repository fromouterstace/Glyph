import { Router, type Request } from 'express';
import { getAuth } from '@clerk/express';
import { and, count, eq, inArray, isNull } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import {
  db,
  glyphMessages,
  glyphLinks,
  glyphEvents,
  glyphSettings,
  glyphDeliveries,
} from '@workspace/db';
import {
  CreateMessageBody,
  UpdateMessageBody,
  UpdateSettingsBody,
  ListMessagesQueryParams,
  ListMessagesResponse,
  ListActivityQueryParams,
  GetMessageResponse,
  GetOverviewResponse,
  ListActivityResponse,
  ListMessageEventsParams,
  ListMessageEventsResponse,
  CreateMessageResponse,
  UpdateMessageResponse,
  SendMessageResponse,
  GetSettingsResponse,
  UpdateSettingsResponse,
  GetConnectionResponse,
} from '@workspace/api-zod';
import { defaultSettings } from '../lib/glyph-data';
import { publicMessage } from '../lib/message-presentation';
import {
  getOwnerOverview,
  listMessageEvents,
  listOwnerActivity,
  listOwnerMessages,
  messageLinkClickCounts,
  messageSignalSummary,
} from '../lib/glyph-queries';
import {
  extractUrls,
  findSentMessage,
  userGmailRequest,
  userMailboxEmail,
  mimeMessage,
  newToken,
  ownsMailbox,
  safeMailboxOwnership,
} from '../lib/gmail';
import {
  getTrustedRequestOrigin,
  isSameTrustedOrigin,
} from '../middlewares/clerkProxyMiddleware';
import { trackedEmailHtml } from '../lib/email-content';
import { webRecipients } from '../lib/web-recipients';
import { messageHtml, richLinkUrls } from '../lib/email-html';
import {
  attachmentMetadata,
  readAttachment,
  withComposerLock,
} from '../lib/attachments';
import glyphAttachmentsRouter from './glyph-attachments';
import { resolveTrackingOrigin } from '../lib/tracking-origin';
import { logSafeError } from '../lib/logger';
import {
  claimDraftForSend,
  confirmSentMessage,
} from '../lib/message-lifecycle';

const router = Router();
const userId = (req: Request) => getAuth(req).userId;
async function settingsFor(ownerId: string | null) {
  if (!ownerId) return { ...defaultSettings, readOnly: true };
  const [row] = await db
    .select()
    .from(glyphSettings)
    .where(eq(glyphSettings.ownerId, ownerId));
  const counts = await db
    .select({ status: glyphDeliveries.status, count: count() })
    .from(glyphDeliveries)
    .where(eq(glyphDeliveries.ownerId, ownerId))
    .groupBy(glyphDeliveries.status);
  const total = (status: string) =>
    counts.find((c) => c.status === status)?.count ?? 0;
  const emailAlertStatus = `${total('pending')} queued · ${total('sent')} confirmed sent · ${total('sending') + total('uncertain')} awaiting confirmation. Unconfirmed sends are checked in Gmail Sent and never automatically resent.`;
  return { ...(row ?? defaultSettings), emailAlertStatus, readOnly: false };
}
const ownMessage = async (ownerId: string, id: string) => {
  const [row] = await db
    .select()
    .from(glyphMessages)
    .where(
      and(
        eq(glyphMessages.id, id),
        eq(glyphMessages.ownerId, ownerId),
        isNull(glyphMessages.archivedAt),
      ),
    );
  return row;
};
const responseMessage = async (id: string, ownerId: string) => {
  const m = await ownMessage(ownerId, id);
  if (!m) throw new Error('Message not found');
  return publicMessage(m, await messageSignalSummary(id));
};

router.use('/glyph', async (req, res, next): Promise<void> => {
  res.set('Cache-Control', 'private, no-store');
  if (req.method === 'OPTIONS') {
    next();
    return;
  }
  const ownerId = userId(req);
  if (!ownerId) {
    res.status(401).json({
      error: 'Sign in to view and change your account data.',
    });
    return;
  }
  if (['GET', 'HEAD'].includes(req.method)) {
    next();
    return;
  }
  const sameOrigin = isSameTrustedOrigin(
    req.get('origin'),
    getTrustedRequestOrigin(req),
  );
  if (!sameOrigin) {
    res
      .status(403)
      .json({ error: 'A same-origin browser request is required.' });
    return;
  }
  if (!(await safeMailboxOwnership(ownerId))) {
    res.status(403).json({
      error:
        'Connect your Gmail account from the Gmail page before changing mailbox data.',
    });
    return;
  }
  next();
});

router.get('/glyph/overview', async (req, res): Promise<void> => {
  res.json(GetOverviewResponse.parse(await getOwnerOverview(userId(req)!)));
});
router.use(glyphAttachmentsRouter);
router.get('/glyph/messages', async (req, res): Promise<void> => {
  const parsed = ListMessagesQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid filters' });
    return;
  }
  res.json(
    ListMessagesResponse.parse(
      await listOwnerMessages(userId(req)!, parsed.data),
    ),
  );
});
router.get('/glyph/messages/:id', async (req, res): Promise<void> => {
  const id = String(req.params.id);
  const ownerId = userId(req);
  const message = ownerId ? await ownMessage(ownerId, id) : undefined;
  if (!message) {
    res.status(404).json({ error: 'Email not found' });
    return;
  }
  const [summary, links, clicksByUrl] = await Promise.all([
    messageSignalSummary(id),
    db
      .select()
      .from(glyphLinks)
      .where(and(eq(glyphLinks.messageId, id), isNull(glyphLinks.retiredAt))),
    messageLinkClickCounts(id),
  ]);
  res.json(
    GetMessageResponse.parse({
      message: publicMessage(message, summary),
      links: links.map((l) => ({
        id: l.id,
        url: l.url,
        clicks: clicksByUrl.get(l.url) ?? 0,
      })),
    }),
  );
});
router.get(
  '/glyph/messages/:id/events/:offset',
  async (req, res): Promise<void> => {
    const parsed = ListMessageEventsParams.safeParse(req.params);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid signal-history page' });
      return;
    }
    const page = await listMessageEvents(
      userId(req)!,
      parsed.data.id,
      parsed.data.offset,
    );
    if (!page) {
      res.status(404).json({ error: 'Email not found' });
      return;
    }
    res.json(ListMessageEventsResponse.parse(page));
  },
);
router.post('/glyph/messages', async (req, res): Promise<void> => {
  const parsed = CreateMessageBody.safeParse(req.body);
  if (!parsed.success || /[\r\n]/.test(parsed.data?.recipientEmail ?? '')) {
    res
      .status(400)
      .json({ error: 'Enter a valid recipient, subject and message.' });
    return;
  }
  const ownerId = userId(req)!;
  const id = randomUUID();
  const { attachmentIds, bodyHtml, ...fields } = parsed.data;
  const recipients = webRecipients(fields);
  await withComposerLock(ownerId, async (tx) => {
    const attachments = await attachmentMetadata(
      tx,
      ownerId,
      attachmentIds ?? [],
    );
    await tx.insert(glyphMessages).values({
      ...fields,
      ...recipients,
      bodyHtml: messageHtml(bodyHtml),
      attachments,
      recipientEmail: fields.recipientEmail.toLowerCase().trim(),
      id,
      ownerId,
      pixelToken: newToken(),
      rfcMessageId: `${id}@glyph.mail`,
    });
  });
  res
    .status(201)
    .json(CreateMessageResponse.parse(await responseMessage(id, ownerId)));
});
router.patch('/glyph/messages/:id', async (req, res): Promise<void> => {
  const ownerId = userId(req)!,
    id = String(req.params.id);
  const parsed = UpdateMessageBody.safeParse(req.body);
  if (!parsed.success || /[\r\n]/.test(parsed.data?.recipientEmail ?? '')) {
    res
      .status(400)
      .json({ error: 'Enter a valid recipient, subject and message.' });
    return;
  }
  const row = await ownMessage(ownerId, id);
  if (!row) {
    res.status(404).json({ error: 'Email not found' });
    return;
  }
  if (row.deliverySource === 'gmail') {
    res
      .status(409)
      .json({ error: 'Edit this email in Gmail, then add its glyph again.' });
    return;
  }
  if (!['draft', 'failed'].includes(row.status)) {
    res.status(409).json({ error: 'Only unsent drafts can be edited.' });
    return;
  }
  const { attachmentIds, bodyHtml, ...fields } = parsed.data;
  const recipients = webRecipients(fields, row);
  const updated = await withComposerLock(ownerId, async (tx) => {
    const attachments =
      attachmentIds === undefined
        ? undefined
        : await attachmentMetadata(tx, ownerId, attachmentIds);
    return tx
      .update(glyphMessages)
      .set({
        ...fields,
        ...recipients,
        recipientEmail: fields.recipientEmail.toLowerCase().trim(),
        bodyHtml: messageHtml(bodyHtml),
        ...(attachments === undefined ? {} : { attachments }),
        status: 'draft',
      })
      .where(
        and(
          eq(glyphMessages.id, id),
          eq(glyphMessages.ownerId, ownerId),
          inArray(glyphMessages.status, ['draft', 'failed']),
        ),
      )
      .returning();
  });
  if (!updated.length) {
    res.status(409).json({ error: 'This draft is already sending.' });
    return;
  }
  res.json(UpdateMessageResponse.parse(await responseMessage(id, ownerId)));
});
router.delete('/glyph/messages/:id', async (req, res): Promise<void> => {
  const ownerId = userId(req)!,
    id = String(req.params.id);
  const archived = await db
    .update(glyphMessages)
    .set({ archivedAt: new Date() })
    .where(
      and(
        eq(glyphMessages.id, id),
        eq(glyphMessages.ownerId, ownerId),
        isNull(glyphMessages.archivedAt),
        eq(glyphMessages.deliverySource, 'web'),
        inArray(glyphMessages.status, ['draft', 'failed']),
      ),
    )
    .returning();
  if (!archived.length) {
    res.status(409).json({ error: 'Only unsent drafts can be archived.' });
    return;
  }
  res.status(204).end();
});

router.post('/glyph/messages/:id/send', async (req, res): Promise<void> => {
  const ownerId = userId(req)!,
    id = String(req.params.id);
  const message = await ownMessage(ownerId, id);
  if (!message) {
    res.status(404).json({ error: 'Email not found' });
    return;
  }
  if (message.deliverySource === 'gmail') {
    res.status(409).json({
      error:
        "Use Gmail's own Send button for this email. Glyph never sends native drafts through the API.",
    });
    return;
  }
  if (message.status === 'sent') {
    res.json(SendMessageResponse.parse(await responseMessage(id, ownerId)));
    return;
  }
  if (['sending', 'uncertain'].includes(message.status)) {
    const gmailId = await findSentMessage(ownerId, message.rfcMessageId);
    if (!gmailId) {
      res.status(409).json({
        error:
          'Gmail send status is still uncertain. Check Gmail Sent before sending a new email. Glyph will not retry automatically.',
      });
      return;
    }
    await confirmSentMessage(message, {
      gmailId,
      sentAt: message.sentAt ?? new Date(),
      source: 'Gmail — verified in Sent',
      expectedStatuses: ['sending', 'uncertain'],
    });
    res.json(SendMessageResponse.parse(await responseMessage(id, ownerId)));
    return;
  }
  if (message.status !== 'draft') {
    res
      .status(409)
      .json({ error: 'Edit and save this draft before trying again.' });
    return;
  }
  const from = await userMailboxEmail(ownerId);
  const settings = await settingsFor(ownerId);
  const requestOrigin = req.get('origin');
  let base: string;
  try {
    base = resolveTrackingOrigin(
      requestOrigin,
      settings.trackingBaseUrl,
      'web',
    );
  } catch (error) {
    res.status(409).json({ error: (error as Error).message });
    return;
  }
  const urls = [
    ...new Set([
      ...extractUrls(message.body),
      ...richLinkUrls(message.bodyHtml),
    ]),
  ].slice(0, 100);
  const links = message.trackClicks
    ? urls.map((url) => ({
        id: randomUUID(),
        messageId: id,
        url,
        token: newToken(),
      }))
    : [];
  const html = trackedEmailHtml(message, base, links);
  const attachments = [];
  for (const file of message.attachments)
    attachments.push(await readAttachment(ownerId, file.id));
  const raw = mimeMessage({
    from,
    to: message.recipientEmail,
    toEmails: message.toEmails,
    ccEmails: message.ccEmails,
    bccEmails: message.bccEmails,
    subject: message.subject,
    body: message.body,
    html,
    attachments,
    rfcMessageId: message.rfcMessageId,
  });
  const claimed = await claimDraftForSend(message, links);
  if (!claimed) {
    res.status(409).json({
      error:
        'This draft changed or is already sending. Review it before sending again.',
    });
    return;
  }
  try {
    const result = await userGmailRequest(ownerId, '/messages/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw }),
    });
    if (!result.ok) {
      // Only explicit client rejections are safe to treat as unsent. Server errors remain uncertain.
      const status =
        result.status >= 400 && result.status < 500 ? 'failed' : 'uncertain';
      await db
        .update(glyphMessages)
        .set({ status })
        .where(eq(glyphMessages.id, id));
      req.log.warn({ status: result.status }, 'Gmail rejected send request');
      res.status(502).json({
        error:
          status === 'failed'
            ? `Gmail rejected this email (${result.status}). Check the connection and recipient, then edit/save the draft.`
            : 'Gmail send status is uncertain. Check Sent before sending a new message.',
      });
      return;
    }
    const sent = (await result.json()) as { id?: string };
    if (!sent.id) throw new Error('Gmail returned no message ID');
    await confirmSentMessage(message, {
      gmailId: sent.id,
      sentAt: new Date(),
      source: 'Gmail',
      expectedStatuses: ['sending'],
    });
    res.json(SendMessageResponse.parse(await responseMessage(id, ownerId)));
  } catch (err) {
    logSafeError(req.log, err, 'Send response uncertain');
    await db
      .update(glyphMessages)
      .set({ status: 'uncertain' })
      .where(
        and(eq(glyphMessages.id, id), eq(glyphMessages.status, 'sending')),
      );
    res.status(502).json({
      error:
        'The Gmail response was interrupted. Check Gmail Sent. Glyph will not automatically resend this email.',
    });
  }
});

router.get('/glyph/activity', async (req, res): Promise<void> => {
  const parsed = ListActivityQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid activity filters' });
    return;
  }
  res.json(
    ListActivityResponse.parse(
      await listOwnerActivity(userId(req)!, parsed.data),
    ),
  );
});
router.post('/glyph/activity/read', async (req, res): Promise<void> => {
  await db
    .update(glyphEvents)
    .set({ read: true })
    .where(
      inArray(
        glyphEvents.messageId,
        db
          .select({ id: glyphMessages.id })
          .from(glyphMessages)
          .where(eq(glyphMessages.ownerId, userId(req)!)),
      ),
    );
  res.json({ ok: true });
});
router.get('/glyph/settings', async (req, res): Promise<void> => {
  res.json(GetSettingsResponse.parse(await settingsFor(userId(req))));
});
router.patch('/glyph/settings', async (req, res): Promise<void> => {
  const parsed = UpdateSettingsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid preferences' });
    return;
  }
  let origin = parsed.data.trackingBaseUrl.trim();
  if (origin) {
    try {
      origin = resolveTrackingOrigin(req.get('origin'), origin);
    } catch (error) {
      res.status(400).json({
        error: (error as Error).message,
      });
      return;
    }
  }
  const ownerId = userId(req)!;
  const mailbox = await userMailboxEmail(ownerId);
  await db.transaction(async (tx) => {
    await tx.insert(glyphSettings).values({ ownerId }).onConflictDoNothing();
    const [previous] = await tx
      .select()
      .from(glyphSettings)
      .where(eq(glyphSettings.ownerId, ownerId))
      .for('update');
    const emailAlerts = parsed.data.emailAlerts ?? previous.emailAlerts;
    const renewed =
      emailAlerts &&
      (!previous.emailAlerts || previous.alertMailbox !== mailbox);
    await tx
      .update(glyphSettings)
      .set({
        ...parsed.data,
        trackingBaseUrl: origin,
        emailAlerts,
        emailAlertsSince: emailAlerts
          ? renewed
            ? new Date()
            : previous.emailAlertsSince
          : null,
        alertMailbox: emailAlerts ? mailbox : null,
      })
      .where(eq(glyphSettings.ownerId, ownerId));
  });
  res.json(UpdateSettingsResponse.parse(await settingsFor(ownerId)));
});
router.get('/glyph/connection', async (req, res): Promise<void> => {
  const ownerId = userId(req);
  if (!ownerId) {
    res.json(
      GetConnectionResponse.parse({
        connected: false,
        authorized: false,
        email: null,
        message: 'Sign in to connect your own Gmail account.',
      }),
    );
    return;
  }
  try {
    const authorized = await ownsMailbox(ownerId);
    res.json(
      GetConnectionResponse.parse({
        connected: authorized,
        authorized,
        email: authorized ? await userMailboxEmail(ownerId) : null,
        message: authorized
          ? 'Gmail connected. Ready to send tracked emails.'
          : 'Connect or reconnect your Gmail account on the Gmail page.',
      }),
    );
  } catch (err) {
    logSafeError(req.log, err, 'Gmail connection check failed', 'warn');
    res.json(
      GetConnectionResponse.parse({
        connected: false,
        authorized: false,
        email: null,
        message:
          'Gmail is unavailable. Connect or reconnect your account on the Gmail page.',
      }),
    );
  }
});
export default router;
