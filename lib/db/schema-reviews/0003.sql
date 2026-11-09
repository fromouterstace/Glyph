CREATE TABLE "glyph_contacts" (
  "id" text PRIMARY KEY NOT NULL,
  "owner_id" text NOT NULL,
  "first_name" text NOT NULL,
  "last_name" text NOT NULL,
  "email" text NOT NULL,
  "email_suffix" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "glyph_contacts_owner_email_idx" ON "glyph_contacts" ("owner_id", "email");
CREATE INDEX "glyph_contacts_owner_name_idx" ON "glyph_contacts" ("owner_id", "last_name", "id");
CREATE TABLE "glyph_label_imports" (
  "owner_id" text PRIMARY KEY NOT NULL,
  "mailbox_identity" text NOT NULL,
  "page_token" text,
  "status" text DEFAULT 'pending' NOT NULL,
  "last_synced_at" timestamp with time zone
);
