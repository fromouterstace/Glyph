ALTER TABLE "glyph_messages" ADD COLUMN "prepared_tracking_origin" text;
CREATE TABLE "glyph_pixel_diagnostics" (
  "scope" text NOT NULL,
  "message_id" text REFERENCES "glyph_messages"("id") ON DELETE CASCADE,
  "day" timestamp with time zone NOT NULL,
  "outcome" text NOT NULL,
  "requests" integer DEFAULT 1 NOT NULL,
  CONSTRAINT "glyph_pixel_diagnostics_scope_day_outcome_pk" PRIMARY KEY ("scope", "day", "outcome"),
  CONSTRAINT "glyph_pixel_diagnostics_count_check" CHECK ("requests" > 0),
  CONSTRAINT "glyph_pixel_diagnostics_outcome_check" CHECK ("outcome" in ('recorded', 'sender_compose_ignored', 'tracking_disabled', 'send_not_confirmed', 'unknown_token', 'event_budget_exceeded', 'native_reconciliation_budget_exceeded', 'native_reconciliation_failed')),
  CONSTRAINT "glyph_pixel_diagnostics_scope_check" CHECK (("message_id" is null and "scope" = 'unknown' and "outcome" = 'unknown_token') or ("message_id" is not null and "scope" = "message_id" and "outcome" <> 'unknown_token'))
);
CREATE INDEX "glyph_pixel_diagnostics_message_idx" ON "glyph_pixel_diagnostics" ("message_id");
