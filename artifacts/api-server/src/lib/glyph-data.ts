import { db, glyphMessages, glyphEvents } from '@workspace/db';
import { desc, eq, inArray } from 'drizzle-orm';
import { publicMessage, publicEvent } from './message-presentation';
export { publicMessage, publicEvent } from './message-presentation';

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
