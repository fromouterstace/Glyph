import type { GlyphMessage, GlyphEvent } from '@workspace/db';
import { recipientGroups } from './native-verification';

export type MessageSignalSummary = {
  opens: number;
  clicks: number;
  replies: number;
  lastActivityAt: Date | string | null;
};

function isoTimestamp(value: Date | string | null) {
  if (value === null) return null;
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}

export function publicMessage(
  message: GlyphMessage,
  eventsOrSummary: GlyphEvent[] | MessageSignalSummary,
) {
  const summary = Array.isArray(eventsOrSummary)
    ? eventsOrSummary
        .filter((event) => event.messageId === message.id)
        .reduce<MessageSignalSummary>(
          (result, event) => {
            if (!event.automated) {
              if (event.type === 'open') result.opens++;
              if (event.type === 'click') result.clicks++;
              if (event.type === 'reply') result.replies++;
            }
            if (
              !result.lastActivityAt ||
              event.occurredAt > result.lastActivityAt
            ) {
              result.lastActivityAt = event.occurredAt;
            }
            return result;
          },
          { opens: 0, clicks: 0, replies: 0, lastActivityAt: null },
        )
    : eventsOrSummary;
  const groups = recipientGroups(message);
  const count = new Set(Object.values(groups).flat()).size;
  return {
    id: message.id,
    recipientEmail: message.recipientEmail,
    recipientName:
      count > 1
        ? `Shared message (${count} recipients)`
        : message.recipientName,
    toEmails: groups.to,
    ccEmails: groups.cc,
    bccEmails: groups.bcc,
    subject: message.subject,
    body: message.body,
    trackOpens: message.trackOpens,
    trackClicks: message.trackClicks,
    status: message.status as
      'draft' | 'sent' | 'sending' | 'failed' | 'uncertain',
    createdAt: message.createdAt.toISOString(),
    sentAt: message.sentAt?.toISOString() ?? null,
    opens: summary.opens,
    clicks: summary.clicks,
    replies: summary.replies,
    lastActivityAt: isoTimestamp(summary.lastActivityAt),
    deliverySource: message.deliverySource as 'web' | 'gmail',
  };
}

export function publicEvent(event: GlyphEvent, message: GlyphMessage) {
  const groups = recipientGroups(message);
  const count = new Set(Object.values(groups).flat()).size;
  const visibleRecipient = groups.to[0] ?? groups.cc[0];
  return {
    id: event.id,
    messageId: message.id,
    recipientName:
      count > 1
        ? `Shared message (${count} recipients)`
        : visibleRecipient
          ? message.recipientName
          : 'Bcc message',
    recipientEmail: visibleRecipient ?? '',
    subject: message.subject,
    type: event.type as 'sent' | 'open' | 'click' | 'reply',
    occurredAt: event.occurredAt.toISOString(),
    url: event.url,
    automated: event.automated,
    source: event.source,
    read: event.read,
  };
}

/** Index once so presenting an inbox does not scan its full history per row. */
export function presentOwnerData(
  messages: GlyphMessage[],
  events: GlyphEvent[],
) {
  const byId = new Map(messages.map((message) => [message.id, message]));
  const grouped = new Map<string, GlyphEvent[]>();
  const publicEvents = events.map((event) => {
    const message = byId.get(event.messageId);
    if (!message) throw new Error('Engagement event has no owned message');
    const group = grouped.get(event.messageId) ?? [];
    group.push(event);
    grouped.set(event.messageId, group);
    return publicEvent(event, message);
  });
  return {
    messages: messages.map((message) =>
      publicMessage(message, grouped.get(message.id) ?? []),
    ),
    events: publicEvents,
  };
}
