import {
  and,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNotNull,
  lt,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import { db, glyphEvents, glyphMessages } from '@workspace/db';
import { publicEvent, publicMessage } from './message-presentation';
import type { MessageSignalSummary } from './message-presentation';

const PAGE_SIZE = 50;
const EMPTY_SIGNALS: MessageSignalSummary = {
  opens: 0,
  clicks: 0,
  replies: 0,
  lastActivityAt: null,
};

function pagination(
  limit: number,
  offset: number,
  total: number,
  count: number,
) {
  return { limit, offset, total, hasMore: offset + count < total };
}

function signalExists(type: 'open' | 'click'): SQL {
  return sql`exists (
    select 1 from ${glyphEvents}
    where ${glyphEvents.messageId} = ${glyphMessages.id}
      and ${glyphEvents.type} = ${type}
      and ${glyphEvents.automated} = false
  )`;
}

function messageConditions(
  ownerId: string,
  search?: string,
  status?: string,
): SQL {
  const conditions: SQL[] = [eq(glyphMessages.ownerId, ownerId)];
  const needle = search?.trim();
  if (needle) {
    const pattern = `%${needle}%`;
    const matches = or(
      ilike(glyphMessages.subject, pattern),
      ilike(glyphMessages.recipientName, pattern),
      ilike(glyphMessages.recipientEmail, pattern),
    );
    if (matches) conditions.push(matches);
  }
  if (status && status !== 'all') {
    if (status === 'opened') conditions.push(signalExists('open'));
    else if (status === 'clicked') conditions.push(signalExists('click'));
    else if (status === 'unopened')
      conditions.push(
        and(
          eq(glyphMessages.status, 'sent'),
          sql`not ${signalExists('open')}`,
        )!,
      );
    else conditions.push(eq(glyphMessages.status, status));
  }
  return and(...conditions)!;
}

async function messageSignalSummaries(messageIds: string[]) {
  if (!messageIds.length) return new Map<string, MessageSignalSummary>();
  const rows = await db
    .select({
      messageId: glyphEvents.messageId,
      opens: sql<number>`count(*) filter (where ${glyphEvents.type} = 'open' and ${glyphEvents.automated} = false)::int`,
      clicks: sql<number>`count(*) filter (where ${glyphEvents.type} = 'click' and ${glyphEvents.automated} = false)::int`,
      replies: sql<number>`count(*) filter (where ${glyphEvents.type} = 'reply' and ${glyphEvents.automated} = false)::int`,
      lastActivityAt: sql<Date | string | null>`max(${glyphEvents.occurredAt})`,
    })
    .from(glyphEvents)
    .where(inArray(glyphEvents.messageId, messageIds))
    .groupBy(glyphEvents.messageId);
  return new Map<string, MessageSignalSummary>(
    rows.map((row) => [row.messageId, row]),
  );
}

export async function listOwnerMessages(
  ownerId: string,
  params: {
    search?: string;
    status?: string;
    limit: number;
    offset: number;
  },
) {
  const where = messageConditions(ownerId, params.search, params.status);
  const [{ total = 0 } = {}] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(glyphMessages)
    .where(where);
  const messages = await db
    .select()
    .from(glyphMessages)
    .where(where)
    .orderBy(desc(glyphMessages.createdAt), desc(glyphMessages.id))
    .limit(params.limit)
    .offset(params.offset);
  const summaries = await messageSignalSummaries(messages.map((m) => m.id));
  const items = messages.map((message) =>
    publicMessage(message, summaries.get(message.id) ?? EMPTY_SIGNALS),
  );
  return {
    items,
    pagination: pagination(params.limit, params.offset, total, items.length),
  };
}

export async function getOwnerOverview(ownerId: string) {
  const [summary] = await db
    .select({
      totalSent: sql<number>`count(distinct ${glyphMessages.id}) filter (where ${glyphMessages.status} = 'sent')::int`,
      trackedSentForOpens: sql<number>`count(distinct ${glyphMessages.id}) filter (where ${glyphMessages.status} = 'sent' and ${glyphMessages.trackOpens} = true)::int`,
      trackedSentForClicks: sql<number>`count(distinct ${glyphMessages.id}) filter (where ${glyphMessages.status} = 'sent' and ${glyphMessages.trackClicks} = true)::int`,
      messagesOpened: sql<number>`count(distinct ${glyphMessages.id}) filter (where ${glyphMessages.status} = 'sent' and ${glyphMessages.trackOpens} = true and ${glyphEvents.type} = 'open' and ${glyphEvents.automated} = false)::int`,
      messagesClicked: sql<number>`count(distinct ${glyphMessages.id}) filter (where ${glyphMessages.status} = 'sent' and ${glyphMessages.trackClicks} = true and ${glyphEvents.type} = 'click' and ${glyphEvents.automated} = false)::int`,
      totalOpens: sql<number>`count(${glyphEvents.id}) filter (where ${glyphEvents.type} = 'open' and ${glyphEvents.automated} = false)::int`,
      totalClicks: sql<number>`count(${glyphEvents.id}) filter (where ${glyphEvents.type} = 'click' and ${glyphEvents.automated} = false)::int`,
      unreadCount: sql<number>`count(${glyphEvents.id}) filter (where ${glyphEvents.id} is not null and ${glyphEvents.read} = false and ${glyphEvents.automated} = false and ${glyphEvents.type} <> 'sent')::int`,
    })
    .from(glyphMessages)
    .leftJoin(glyphEvents, eq(glyphEvents.messageId, glyphMessages.id))
    .where(eq(glyphMessages.ownerId, ownerId));

  const now = new Date(Date.now());
  const start = new Date(now);
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCDate(start.getUTCDate() - 13);
  const end = new Date(start.getTime() + 14 * 24 * 60 * 60 * 1000);
  const sentDay = sql<string>`to_char(${glyphMessages.sentAt} at time zone 'UTC', 'YYYY-MM-DD')`;
  const eventDay = sql<string>`to_char(${glyphEvents.occurredAt} at time zone 'UTC', 'YYYY-MM-DD')`;
  const [dailyMessages, dailyEvents] = await Promise.all([
    db
      .select({
        date: sentDay,
        sent: sql<number>`count(*)::int`,
      })
      .from(glyphMessages)
      .where(
        and(
          eq(glyphMessages.ownerId, ownerId),
          eq(glyphMessages.status, 'sent'),
          gte(glyphMessages.sentAt, start),
          lt(glyphMessages.sentAt, end),
        ),
      )
      .groupBy(sentDay),
    db
      .select({
        date: eventDay,
        opens: sql<number>`count(*) filter (where ${glyphEvents.type} = 'open' and ${glyphEvents.automated} = false)::int`,
        clicks: sql<number>`count(*) filter (where ${glyphEvents.type} = 'click' and ${glyphEvents.automated} = false)::int`,
      })
      .from(glyphEvents)
      .innerJoin(glyphMessages, eq(glyphMessages.id, glyphEvents.messageId))
      .where(
        and(
          eq(glyphMessages.ownerId, ownerId),
          gte(glyphEvents.occurredAt, start),
          lt(glyphEvents.occurredAt, end),
        ),
      )
      .groupBy(eventDay),
  ]);

  const days = new Map<
    string,
    { date: string; sent: number; opens: number; clicks: number }
  >();
  for (let i = 0; i < 14; i++) {
    const date = new Date(start.getTime() + i * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    days.set(date, { date, sent: 0, opens: 0, clicks: 0 });
  }
  for (const row of dailyMessages) {
    const day = days.get(row.date);
    if (day) day.sent = row.sent;
  }
  for (const row of dailyEvents) {
    const day = days.get(row.date);
    if (day) {
      day.opens = row.opens;
      day.clicks = row.clicks;
    }
  }

  return {
    readOnly: false,
    totalSent: summary.totalSent,
    totalOpens: summary.totalOpens,
    totalClicks: summary.totalClicks,
    openRate: summary.trackedSentForOpens
      ? Math.round((summary.messagesOpened / summary.trackedSentForOpens) * 100)
      : 0,
    clickRate: summary.trackedSentForClicks
      ? Math.round(
          (summary.messagesClicked / summary.trackedSentForClicks) * 100,
        )
      : 0,
    unreadCount: summary.unreadCount,
    daily: Array.from(days.values()),
  };
}

export async function listOwnerActivity(
  ownerId: string,
  params: { limit: number; offset: number; type?: string },
) {
  const conditions: SQL[] = [eq(glyphMessages.ownerId, ownerId)];
  if (params.type && params.type !== 'all') {
    if (params.type === 'human')
      conditions.push(eq(glyphEvents.automated, false));
    else if (params.type === 'automated')
      conditions.push(eq(glyphEvents.automated, true));
    else conditions.push(eq(glyphEvents.type, params.type));
  }
  const where = and(...conditions)!;
  const [{ total = 0 } = {}] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(glyphEvents)
    .innerJoin(glyphMessages, eq(glyphMessages.id, glyphEvents.messageId))
    .where(where);
  const rows = await db
    .select({ event: glyphEvents, message: glyphMessages })
    .from(glyphEvents)
    .innerJoin(glyphMessages, eq(glyphMessages.id, glyphEvents.messageId))
    .where(where)
    .orderBy(desc(glyphEvents.occurredAt), desc(glyphEvents.id))
    .limit(params.limit)
    .offset(params.offset);
  const items = rows.map(({ event, message }) => publicEvent(event, message));
  return {
    items,
    pagination: pagination(params.limit, params.offset, total, items.length),
  };
}

export async function listMessageEvents(
  ownerId: string,
  messageId: string,
  offset: number,
) {
  const [message] = await db
    .select()
    .from(glyphMessages)
    .where(
      and(eq(glyphMessages.id, messageId), eq(glyphMessages.ownerId, ownerId)),
    );
  if (!message) return null;

  const [{ total = 0 } = {}] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(glyphEvents)
    .where(eq(glyphEvents.messageId, messageId));
  const events = await db
    .select()
    .from(glyphEvents)
    .where(eq(glyphEvents.messageId, messageId))
    .orderBy(desc(glyphEvents.occurredAt), desc(glyphEvents.id))
    .limit(PAGE_SIZE)
    .offset(offset);
  const items = events.map((event) => publicEvent(event, message));
  return {
    items,
    pagination: pagination(PAGE_SIZE, offset, total, items.length),
  };
}

export async function messageSignalSummary(messageId: string) {
  const [summary] = await db
    .select({
      opens: sql<number>`count(*) filter (where ${glyphEvents.type} = 'open' and ${glyphEvents.automated} = false)::int`,
      clicks: sql<number>`count(*) filter (where ${glyphEvents.type} = 'click' and ${glyphEvents.automated} = false)::int`,
      replies: sql<number>`count(*) filter (where ${glyphEvents.type} = 'reply' and ${glyphEvents.automated} = false)::int`,
      lastActivityAt: sql<Date | string | null>`max(${glyphEvents.occurredAt})`,
    })
    .from(glyphEvents)
    .where(eq(glyphEvents.messageId, messageId));
  return summary ?? EMPTY_SIGNALS;
}

export async function messageLinkClickCounts(messageId: string) {
  const rows = await db
    .select({
      url: glyphEvents.url,
      clicks: sql<number>`count(*)::int`,
    })
    .from(glyphEvents)
    .where(
      and(
        eq(glyphEvents.messageId, messageId),
        eq(glyphEvents.type, 'click'),
        eq(glyphEvents.automated, false),
        isNotNull(glyphEvents.url),
      ),
    )
    .groupBy(glyphEvents.url);
  return new Map(rows.map((row) => [row.url, row.clicks]));
}
