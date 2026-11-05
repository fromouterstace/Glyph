import { Router, type Request } from 'express';
import { getAuth } from '@clerk/express';
import { and, eq, inArray, desc } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import {
  db,
  glyphMessages,
  glyphLinks,
  glyphEvents,
  glyphSettings,
} from '@workspace/db';
import {
  CreateMessageBody,
  UpdateMessageBody,
  UpdateSettingsBody,
  ListMessagesQueryParams,
  ListMessagesResponse,
  GetMessageResponse,
  GetOverviewResponse,
  ListActivityResponse,
  CreateMessageResponse,
  UpdateMessageResponse,
  SendMessageResponse,
  GetSettingsResponse,
  UpdateSettingsResponse,
  GetConnectionResponse,
} from '@workspace/api-zod';
import {
  defaultSettings,
  ownerData,
  overview,
  publicEvent,
  publicMessage,
} from '../lib/glyph-data';
import {
  extractUrls,
  findSentMessage,
  gmailRequest,
  mailboxEmail,
  mimeMessage,
  newToken,
  ownsMailbox,
} from '../lib/gmail';
import { trackedEmailHtml } from '../lib/email-content';
import { resolveTrackingOrigin } from '../lib/tracking-origin';
import { presentOwnerData } from '../lib/message-presentation';
import {
  claimDraftForSend,
  confirmSentMessage,
} from '../lib/message-lifecycle';

const router = Router();
const userId = (req: Request) => getAuth(req).userId;
async function dataFor(req: Request) {
  const ownerId = userId(req);
  if (!ownerId) return { messages: [], events: [] };
  const data = await ownerData(ownerId);
  return presentOwnerData(data.messages, data.events);
}
async function settingsFor(ownerId: string | null) {
  if (!ownerId) return { ...defaultSettings, readOnly: true };
  const [row] = await db
    .select()
    .from(glyphSettings)
    .where(eq(glyphSettings.ownerId, ownerId));
  return { ...(row ?? defaultSettings), readOnly: false };
}
const ownMessage = async (ownerId: string, id: string) => {
  const [row] = await db
    .select()
    .from(glyphMessages)
    .where(and(eq(glyphMessages.id, id), eq(glyphMessages.ownerId, ownerId)));
  return row;
};
const responseMessage = async (id: string, ownerId: string) => {
  const m = await ownMessage(ownerId, id);
  if (!m) throw new Error('Message not found');
  const events = await db
    .select()
    .from(glyphEvents)
    .where(eq(glyphEvents.messageId, id))
    .orderBy(desc(glyphEvents.occurredAt));
  return publicMessage(m, events);
};

router.use('/glyph', async (req, res, next): Promise<void> => {
  res.set('Cache-Control', 'private, no-store');
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
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
  const origin = req.get('origin');
  const hosts = [
    req.get('host'),
    req.get('x-forwarded-host')?.split(',')[0]?.trim(),
  ].filter(Boolean);
  let sameOrigin = false;
  try {
    sameOrigin = !!origin && hosts.includes(new URL(origin).host);
  } catch {
    /* invalid origin */
  }
  if (!sameOrigin) {
    res
      .status(403)
      .json({ error: 'A same-origin browser request is required.' });
    return;
  }
  if (!(await ownsMailbox(ownerId))) {
    res.status(403).json({
      error:
        'Sign in with the verified email address of the Gmail account connected to this project. This app currently supports that mailbox only.',
    });
    return;
  }
  next();
});

router.get('/glyph/overview', async (req, res): Promise<void> => {
  const data = await dataFor(req);
  res.json(
    GetOverviewResponse.parse(
      overview(data.messages, data.events, !userId(req)),
    ),
  );
});
router.get('/glyph/messages', async (req, res): Promise<void> => {
  const parsed = ListMessagesQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid filters' });
    return;
  }
  const { messages } = await dataFor(req);
  const { search, status } = parsed.data;
  const results = messages.filter((m) => {
    const searchable =
      `${m.subject} ${m.recipientName} ${m.recipientEmail}`.toLowerCase();
    const matchesStatus =
      !status ||
      status === 'all' ||
      m.status === status ||
      (status === 'opened' && m.opens > 0) ||
      (status === 'clicked' && m.clicks > 0) ||
      (status === 'unopened' && m.status === 'sent' && !m.opens);
    return (
      matchesStatus && (!search || searchable.includes(search.toLowerCase()))
    );
  });
  res.json(ListMessagesResponse.parse(results));
});
router.get('/glyph/messages/:id', async (req, res): Promise<void> => {
  const id = String(req.params.id);
  const ownerId = userId(req);
  const message = ownerId ? await ownMessage(ownerId, id) : undefined;
  if (!message) {
    res.status(404).json({ error: 'Email not found' });
    return;
  }
  const [events, links] = await Promise.all([
    db
      .select()
      .from(glyphEvents)
      .where(eq(glyphEvents.messageId, id))
      .orderBy(desc(glyphEvents.occurredAt)),
    db.select().from(glyphLinks).where(eq(glyphLinks.messageId, id)),
  ]);
  const clicksByUrl = new Map<string, number>();
  for (const event of events) {
    if (event.type === 'click' && !event.automated && event.url)
      clicksByUrl.set(event.url, (clicksByUrl.get(event.url) ?? 0) + 1);
  }
  res.json(
    GetMessageResponse.parse({
      message: publicMessage(message, events),
      events: events.map((event) => publicEvent(event, message)),
      links: links.map((l) => ({
        id: l.id,
        url: l.url,
        clicks: clicksByUrl.get(l.url) ?? 0,
      })),
    }),
  );
});
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
  await db.insert(glyphMessages).values({
    ...parsed.data,
    recipientEmail: parsed.data.recipientEmail.toLowerCase().trim(),
    id,
    ownerId,
    pixelToken: newToken(),
    rfcMessageId: `${id}@glyph.mail`,
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
  const updated = await db
    .update(glyphMessages)
    .set({ ...parsed.data, status: 'draft' })
    .where(
      and(
        eq(glyphMessages.id, id),
        eq(glyphMessages.ownerId, ownerId),
        inArray(glyphMessages.status, ['draft', 'failed']),
      ),
    )
    .returning();
  if (!updated.length) {
    res.status(409).json({ error: 'This draft is already sending.' });
    return;
  }
  res.json(UpdateMessageResponse.parse(await responseMessage(id, ownerId)));
});
router.delete('/glyph/messages/:id', async (req, res): Promise<void> => {
  const ownerId = userId(req)!,
    id = String(req.params.id);
  const deleted = await db
    .delete(glyphMessages)
    .where(
      and(
        eq(glyphMessages.id, id),
        eq(glyphMessages.ownerId, ownerId),
        eq(glyphMessages.deliverySource, 'web'),
        inArray(glyphMessages.status, ['draft', 'failed']),
      ),
    )
    .returning();
  if (!deleted.length) {
    res.status(409).json({ error: 'Only unsent drafts can be deleted.' });
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
    const gmailId = await findSentMessage(message.rfcMessageId);
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
  const from = await mailboxEmail();
  const settings = await settingsFor(ownerId);
  const requestOrigin = req.get('origin');
  let base: string;
  try {
    base = resolveTrackingOrigin(requestOrigin, settings.trackingBaseUrl);
  } catch (error) {
    res.status(409).json({ error: (error as Error).message });
    return;
  }
  const urls = extractUrls(message.body);
  const links = message.trackClicks
    ? urls.map((url) => ({
        id: randomUUID(),
        messageId: id,
        url,
        token: newToken(),
      }))
    : [];
  const html = trackedEmailHtml(message, base, links);
  const raw = mimeMessage({
    from,
    to: message.recipientEmail,
    subject: message.subject,
    body: message.body,
    html,
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
    const result = await gmailRequest('/messages/send', {
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
    req.log.error({ err }, 'Send response uncertain');
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
  const { events } = await dataFor(req);
  res.json(ListActivityResponse.parse(events.slice(0, 200)));
});
router.post('/glyph/activity/read', async (req, res): Promise<void> => {
  const rows = await db
    .select({ id: glyphMessages.id })
    .from(glyphMessages)
    .where(eq(glyphMessages.ownerId, userId(req)!));
  if (rows.length)
    await db
      .update(glyphEvents)
      .set({ read: true })
      .where(
        inArray(
          glyphEvents.messageId,
          rows.map((m) => m.id),
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
  const data = { ...parsed.data, trackingBaseUrl: origin };
  await db
    .insert(glyphSettings)
    .values({ ownerId, ...data })
    .onConflictDoUpdate({ target: glyphSettings.ownerId, set: data });
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
        message:
          'Sign in with the verified email address of the connected Gmail account to view your saved data.',
      }),
    );
    return;
  }
  try {
    const authorized = await ownsMailbox(ownerId);
    res.json(
      GetConnectionResponse.parse({
        connected: true,
        authorized,
        email: authorized ? await mailboxEmail() : null,
        message: authorized
          ? 'Gmail connected. Ready to send tracked emails.'
          : 'Use a verified sign-in email matching the Gmail account connected to this project. Additional mailboxes are not supported yet.',
      }),
    );
  } catch (err) {
    req.log.warn({ err }, 'Gmail connection check failed');
    res.json(
      GetConnectionResponse.parse({
        connected: false,
        authorized: false,
        email: null,
        message:
          "Gmail is unavailable. Reconnect Gmail in the project's Integrations panel.",
      }),
    );
  }
});
export default router;
