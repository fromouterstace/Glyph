import {
  pgTable,
  text,
  boolean,
  timestamp,
  integer,
  index,
  uniqueIndex,
  primaryKey,
  check,
  jsonb,
} from 'drizzle-orm/pg-core';
import { createInsertSchema } from 'drizzle-zod';
import { sql } from 'drizzle-orm';

export const glyphMessages = pgTable(
  'glyph_messages',
  {
    id: text('id').primaryKey(),
    ownerId: text('owner_id').notNull(),
    recipientEmail: text('recipient_email').notNull(),
    recipientName: text('recipient_name').notNull(),
    toEmails: text('to_emails').array().notNull().default([]),
    ccEmails: text('cc_emails').array().notNull().default([]),
    bccEmails: text('bcc_emails').array().notNull().default([]),
    subject: text('subject').notNull(),
    body: text('body').notNull(),
    bodyHtml: text('body_html'),
    attachments: jsonb('attachments')
      .$type<
        Array<{ id: string; name: string; size: number; contentType: string }>
      >()
      .notNull()
      .default([]),
    trackOpens: boolean('track_opens').notNull().default(true),
    trackClicks: boolean('track_clicks').notNull().default(true),
    status: text('status').notNull().default('draft'),
    pixelToken: text('pixel_token').notNull().unique(),
    gmailId: text('gmail_id'),
    rfcMessageId: text('rfc_message_id').notNull(),
    deliverySource: text('delivery_source').notNull().default('web'),
    nativeComposeKey: text('native_compose_key'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    sentAt: timestamp('sent_at', { withTimezone: true }),
  },
  (t) => [
    index('glyph_messages_owner_idx').on(t.ownerId, t.createdAt, t.id),
    index('glyph_messages_attachments_idx').using('gin', t.attachments),
    uniqueIndex('glyph_native_compose_idx').on(t.ownerId, t.nativeComposeKey),
  ],
);

export const glyphLinks = pgTable('glyph_links', {
  id: text('id').primaryKey(),
  messageId: text('message_id')
    .notNull()
    .references(() => glyphMessages.id, { onDelete: 'cascade' }),
  token: text('token').notNull().unique(),
  url: text('url').notNull(),
});

export const glyphEvents = pgTable(
  'glyph_events',
  {
    id: text('id').primaryKey(),
    messageId: text('message_id')
      .notNull()
      .references(() => glyphMessages.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    url: text('url'),
    automated: boolean('automated').notNull().default(false),
    source: text('source').notNull(),
    read: boolean('read').notNull().default(false),
    fingerprint: text('fingerprint').notNull().unique(),
    occurredAt: timestamp('occurred_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('glyph_events_message_idx').on(t.messageId, t.occurredAt, t.id),
    index('glyph_events_time_idx').on(t.occurredAt, t.id),
  ],
);

export const glyphTrackingBudgets = pgTable(
  'glyph_tracking_budgets',
  {
    messageId: text('message_id')
      .notNull()
      .references(() => glyphMessages.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    windowBucket: integer('window_bucket').notNull(),
    windowCount: integer('window_count').notNull(),
    dayBucket: integer('day_bucket').notNull(),
    dayCount: integer('day_count').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.messageId, t.kind] }),
    check(
      'glyph_tracking_budgets_kind_check',
      sql`${t.kind} in ('open', 'click', 'reconcile')`,
    ),
    check(
      'glyph_tracking_budgets_counts_check',
      sql`${t.windowCount} >= 1 and ${t.dayCount} >= 1`,
    ),
  ],
);

export const glyphSettings = pgTable('glyph_settings', {
  ownerId: text('owner_id').primaryKey(),
  notifyOpens: boolean('notify_opens').notNull().default(true),
  notifyClicks: boolean('notify_clicks').notNull().default(true),
  notifyReplies: boolean('notify_replies').notNull().default(true),
  defaultTrackOpens: boolean('default_track_opens').notNull().default(true),
  defaultTrackClicks: boolean('default_track_clicks').notNull().default(true),
  trackingBaseUrl: text('tracking_base_url').notNull().default(''),
});

export const insertGlyphMessageSchema = createInsertSchema(glyphMessages);
export const insertGlyphLinkSchema = createInsertSchema(glyphLinks);
export const insertGlyphEventSchema = createInsertSchema(glyphEvents);
export const insertGlyphSettingsSchema = createInsertSchema(glyphSettings);
export type GlyphMessage = typeof glyphMessages.$inferSelect;
export type GlyphEvent = typeof glyphEvents.$inferSelect;
export * from './glyph-attachments';
