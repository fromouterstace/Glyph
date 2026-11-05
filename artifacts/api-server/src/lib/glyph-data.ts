import {
  db,
  glyphMessages,
  glyphEvents,
  type GlyphMessage,
  type GlyphEvent,
} from '@workspace/db';
import { desc, eq, inArray } from 'drizzle-orm';

export function publicMessage(message: GlyphMessage, events: GlyphEvent[]) {
  const signals = events.filter((e) => e.messageId === message.id);
  return {
    id: message.id,
    recipientEmail: message.recipientEmail,
    recipientName: message.recipientName,
    subject: message.subject,
    body: message.body,
    trackOpens: message.trackOpens,
    trackClicks: message.trackClicks,
    status: message.status as
      'draft' | 'sent' | 'sending' | 'failed' | 'uncertain',
    createdAt: message.createdAt.toISOString(),
    sentAt: message.sentAt?.toISOString() ?? null,
    opens: signals.filter((e) => e.type === 'open' && !e.automated).length,
    clicks: signals.filter((e) => e.type === 'click' && !e.automated).length,
    replies: signals.filter((e) => e.type === 'reply' && !e.automated).length,
    lastActivityAt: (signals[0]?.occurredAt.toISOString() ?? null) as
      string | null,
    deliverySource: message.deliverySource as 'web' | 'gmail',
  };
}

export function publicEvent(event: GlyphEvent, message: GlyphMessage) {
  return {
    id: event.id,
    messageId: message.id,
    recipientName: message.recipientName,
    recipientEmail: message.recipientEmail,
    subject: message.subject,
    type: event.type as 'sent' | 'open' | 'click' | 'reply',
    occurredAt: event.occurredAt.toISOString(),
    url: event.url,
    automated: event.automated,
    source: event.source,
    read: event.read,
  };
}

export async function ownerData(ownerId: string) {
  const messages = await db
    .select()
    .from(glyphMessages)
    .where(eq(glyphMessages.ownerId, ownerId))
    .orderBy(desc(glyphMessages.createdAt));
  const events = messages.length
    ? await db
        .select()
        .from(glyphEvents)
        .where(
          inArray(
            glyphEvents.messageId,
            messages.map((m) => m.id),
          ),
        )
        .orderBy(desc(glyphEvents.occurredAt))
    : [];
  return { messages, events };
}

export const defaultSettings = {
  notifyOpens: true,
  notifyClicks: true,
  notifyReplies: true,
  defaultTrackOpens: true,
  defaultTrackClicks: true,
  trackingBaseUrl: '',
};

export function overview(
  messages: ReturnType<typeof publicMessage>[],
  events: ReturnType<typeof publicEvent>[],
  readOnly: boolean,
) {
  const sent = messages.filter((m) => m.status === 'sent');
  const eligibleOpen = sent.filter((m) => m.trackOpens);
  const eligibleClick = sent.filter((m) => m.trackClicks);
  const daily = Array.from({ length: 14 }, (_, i) => {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() - 13 + i);
    const key = date.toISOString().slice(0, 10);
    return {
      date: key,
      sent: sent.filter((m) => m.sentAt?.startsWith(key)).length,
      opens: events.filter(
        (e) =>
          e.type === 'open' && !e.automated && e.occurredAt.startsWith(key),
      ).length,
      clicks: events.filter(
        (e) =>
          e.type === 'click' && !e.automated && e.occurredAt.startsWith(key),
      ).length,
    };
  });
  return {
    readOnly,
    totalSent: sent.length,
    totalOpens: events.filter((e) => e.type === 'open' && !e.automated).length,
    totalClicks: events.filter((e) => e.type === 'click' && !e.automated)
      .length,
    openRate: eligibleOpen.length
      ? Math.round(
          (eligibleOpen.filter((m) => m.opens > 0).length /
            eligibleOpen.length) *
            100,
        )
      : 0,
    clickRate: eligibleClick.length
      ? Math.round(
          (eligibleClick.filter((m) => m.clicks > 0).length /
            eligibleClick.length) *
            100,
        )
      : 0,
    unreadCount: events.filter(
      (e) => !e.read && !e.automated && e.type !== 'sent',
    ).length,
    daily,
  };
}
