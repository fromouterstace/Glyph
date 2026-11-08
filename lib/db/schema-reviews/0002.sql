ALTER TABLE "glyph_settings" ADD COLUMN "email_alerts" boolean DEFAULT false NOT NULL;
ALTER TABLE "glyph_settings" ADD COLUMN "email_alerts_since" timestamp with time zone;
ALTER TABLE "glyph_settings" ADD COLUMN "alert_mailbox" text;
CREATE TABLE "glyph_deliveries" (
  "id" text PRIMARY KEY,
  "owner_id" text NOT NULL,
  "message_id" text NOT NULL REFERENCES "glyph_messages"("id") ON DELETE CASCADE,
  "event_id" text NOT NULL REFERENCES "glyph_events"("id") ON DELETE CASCADE,
  "type" text NOT NULL,
  "consent_at" timestamp with time zone NOT NULL,
  "mailbox" text NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "rfc_message_id" text NOT NULL UNIQUE,
  "gmail_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "glyph_delivery_signal_idx" ON "glyph_deliveries" ("message_id", "type");
CREATE INDEX "glyph_delivery_status_idx" ON "glyph_deliveries" ("status", "updated_at");
CREATE INDEX "glyph_delivery_owner_idx" ON "glyph_deliveries" ("owner_id", "updated_at");
