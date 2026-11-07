import {
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

// Disconnected rows retain the immutable mailbox binding, not credentials.
export const glyphGmailConnections = pgTable(
  'glyph_gmail_connections',
  {
    ownerId: text('owner_id').primaryKey(),
    id: text('id').notNull(),
    email: text('email').notNull(),
    generation: text('generation').notNull(),
    replyIdentity: text('reply_identity').notNull(),
    encryptedTokens: text('encrypted_tokens'),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [uniqueIndex('glyph_gmail_connections_email_idx').on(table.email)],
);

export const glyphGmailOAuthStates = pgTable(
  'glyph_gmail_oauth_states',
  {
    stateHash: text('state_hash').primaryKey(),
    ownerId: text('owner_id').notNull(),
    sessionHash: text('session_hash').notNull(),
    origin: text('origin').notNull(),
    encryptedVerifier: text('encrypted_verifier').notNull(),
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (table) => [index('glyph_gmail_oauth_states_expiry_idx').on(table.expiresAt)],
);
