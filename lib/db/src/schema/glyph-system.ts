import {
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

export const glyphSystemEvents = pgTable(
  'glyph_system_events',
  {
    id: text('id').primaryKey(),
    ownerId: text('owner_id').notNull(),
    eventType: text('event_type').notNull(),
    sessionFingerprint: text('session_fingerprint').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('glyph_system_events_session_idx').on(
      table.ownerId,
      table.eventType,
      table.sessionFingerprint,
    ),
    index('glyph_system_events_type_time_idx').on(
      table.eventType,
      table.occurredAt,
    ),
  ],
);
