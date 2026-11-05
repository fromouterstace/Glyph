import type { GlyphMessage, GlyphEvent } from '@workspace/db';
import { recipientGroups } from './native-verification';

export function publicMessage(message: GlyphMessage, events: GlyphEvent[]) {
  const signals = events.filter((e) => e.messageId === message.id);
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
    opens: signals.filter((e) => e.type === 'open' && !e.automated).length,
    clicks: signals.filter((e) => e.type === 'click' && !e.automated).length,
    replies: signals.filter((e) => e.type === 'reply' && !e.automated).length,
    lastActivityAt: signals[0]?.occurredAt.toISOString() ?? null,
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
