import { and, count, desc, eq, sql } from 'drizzle-orm';
import { db, glyphContacts, glyphEvents, glyphMessages } from '@workspace/db';

const MESSAGE_LIMIT = 25;
const EVENT_LIMIT = 50;

function relatedMessages(ownerId: string, email: string) {
  return and(
    eq(glyphMessages.ownerId, ownerId),
    sql`(
      lower(${glyphMessages.recipientEmail}) = ${email.toLowerCase()}
      or exists (
        select 1 from unnest(
          ${glyphMessages.toEmails} || ${glyphMessages.ccEmails} || ${glyphMessages.bccEmails}
        ) as participant(address)
        where lower(participant.address) = ${email.toLowerCase()}
      )
    )`,
  );
}

function latestCommunication(...values: (string | null)[]) {
  const times = values
    .filter((value): value is string => value !== null)
    .map((value) => new Date(value).getTime());
  if (!times.length) return { at: null, days: null };
  const latest = Math.max(...times);
  return {
    at: new Date(latest).toISOString(),
    days: Math.max(0, Math.floor((Date.now() - latest) / 86_400_000)),
  };
}

export async function contactDetail(
  ownerId: string,
  id: string,
  messageOffset: number,
  eventOffset: number,
) {
  const [contact] = await db
    .select()
    .from(glyphContacts)
    .where(and(eq(glyphContacts.id, id), eq(glyphContacts.ownerId, ownerId)));
  if (!contact) return null;
  const predicate = relatedMessages(ownerId, contact.email);
  const [messages, [messageSummary], events, [eventSummary]] =
    await Promise.all([
      db
        .select({
          id: glyphMessages.id,
          subject: glyphMessages.subject,
          excerpt: sql<string>`left(${glyphMessages.body}, 240)`,
          sentAt: glyphMessages.sentAt,
          createdAt: glyphMessages.createdAt,
          deliverySource: glyphMessages.deliverySource,
          status: glyphMessages.status,
          trackOpens: glyphMessages.trackOpens,
          trackClicks: glyphMessages.trackClicks,
        })
        .from(glyphMessages)
        .where(predicate)
        .orderBy(
          desc(
            sql`coalesce(${glyphMessages.sentAt}, ${glyphMessages.createdAt})`,
          ),
          desc(glyphMessages.id),
        )
        .limit(MESSAGE_LIMIT)
        .offset(messageOffset),
      db
        .select({
          count: count(),
          latest: sql<
            string | null
          >`max(case when ${glyphMessages.status} = 'sent' then ${glyphMessages.sentAt} end)::text`,
        })
        .from(glyphMessages)
        .where(predicate),
      db
        .select({
          id: glyphEvents.id,
          messageId: glyphEvents.messageId,
          subject: glyphMessages.subject,
          type: glyphEvents.type,
          occurredAt: glyphEvents.occurredAt,
          url: glyphEvents.url,
          automated: glyphEvents.automated,
          source: glyphEvents.source,
        })
        .from(glyphEvents)
        .innerJoin(glyphMessages, eq(glyphMessages.id, glyphEvents.messageId))
        .where(predicate)
        .orderBy(desc(glyphEvents.occurredAt), desc(glyphEvents.id))
        .limit(EVENT_LIMIT)
        .offset(eventOffset),
      db
        .select({
          count: count(),
          pixelLoads:
            sql<number>`count(*) filter (where ${glyphEvents.type} = 'open')`.mapWith(
              Number,
            ),
          linkRequests:
            sql<number>`count(*) filter (where ${glyphEvents.type} = 'click')`.mapWith(
              Number,
            ),
          replies:
            sql<number>`count(*) filter (where ${glyphEvents.type} = 'reply')`.mapWith(
              Number,
            ),
          latestCommunication: sql<
            string | null
          >`(max(${glyphEvents.occurredAt}) filter (where ${glyphEvents.type} in ('sent', 'reply')))::text`,
        })
        .from(glyphEvents)
        .innerJoin(glyphMessages, eq(glyphMessages.id, glyphEvents.messageId))
        .where(predicate),
    ]);
  const last = latestCommunication(
    messageSummary.latest,
    eventSummary.latestCommunication,
  );
  const { ownerId: _ownerId, ...publicContact } = contact;
  return {
    contact: {
      ...publicContact,
      createdAt: contact.createdAt.toISOString(),
    },
    lastCommunicationAt: last.at,
    daysSinceLastCommunication: last.days,
    totalMessages: messageSummary.count,
    messages: messages.map((message) => ({
      ...message,
      excerpt: message.excerpt.slice(0, 240).replace(/[\uD800-\uDBFF]$/, ''),
      createdAt: message.createdAt.toISOString(),
      sentAt: message.sentAt?.toISOString() ?? null,
    })),
    messageOffset,
    messageLimit: MESSAGE_LIMIT,
    totalEvents: eventSummary.count,
    events: events.map((event) => ({
      ...event,
      occurredAt: event.occurredAt.toISOString(),
    })),
    eventOffset,
    eventLimit: EVENT_LIMIT,
    pixelLoads: eventSummary.pixelLoads,
    linkRequests: eventSummary.linkRequests,
    replies: eventSummary.replies,
  };
}
