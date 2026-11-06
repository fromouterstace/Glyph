import { pgTable, text, integer, timestamp, index } from 'drizzle-orm/pg-core';
import { createInsertSchema } from 'drizzle-zod';

export const glyphAttachments = pgTable(
  'glyph_attachments',
  {
    id: text('id').primaryKey(),
    ownerId: text('owner_id').notNull(),
    name: text('name').notNull(),
    size: integer('size').notNull(),
    contentType: text('content_type').notNull(),
    objectPath: text('object_path').notNull(),
    generation: text('generation'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [index('glyph_attachments_owner_idx').on(t.ownerId, t.createdAt)],
);
export const insertGlyphAttachmentSchema = createInsertSchema(glyphAttachments);
