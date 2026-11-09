import {
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';

export const glyphContacts = pgTable(
  'glyph_contacts',
  {
    id: text('id').primaryKey(),
    ownerId: text('owner_id').notNull(),
    firstName: text('first_name').notNull(),
    lastName: text('last_name').notNull(),
    email: text('email').notNull(),
    emailSuffix: text('email_suffix').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('glyph_contacts_owner_email_idx').on(t.ownerId, t.email),
    index('glyph_contacts_owner_name_idx').on(t.ownerId, t.lastName, t.id),
  ],
);

export const glyphLabelImports = pgTable('glyph_label_imports', {
  ownerId: text('owner_id').primaryKey(),
  mailboxIdentity: text('mailbox_identity').notNull(),
  pageToken: text('page_token'),
  status: text('status').notNull().default('pending'),
  lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
});
