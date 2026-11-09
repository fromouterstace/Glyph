ALTER TABLE glyph_messages ADD COLUMN archived_at timestamp with time zone;
ALTER TABLE glyph_links ADD COLUMN retired_at timestamp with time zone;
ALTER TABLE glyph_attachments ADD COLUMN retired_at timestamp with time zone;
