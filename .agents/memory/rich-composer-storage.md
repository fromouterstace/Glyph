---
name: Rich composer storage decisions
description: Why attachments pin immutable storage generations and messages retain HTML plus a plain alternative
---

Keep rich email HTML sanitized and retain a plain-text alternative. Store file
bytes in private App Storage and only ownership/metadata in PostgreSQL.

**Why:** The user explicitly requested functional formatting and attachments in
the optional web composer, not just a redirect to Gmail. A signed upload URL can
remain usable after finalization; pinning the finalized object generation avoids
silently sending replacement bytes if that URL is reused.

**How to apply:** New formatting must round-trip through drafts and actual MIME.
Validate attachment ownership and completion before saving; resolve the exact
stored generation before claiming a send. Missing files must leave the message
unsent. Never replace this with a mutable-path read or anonymous file URLs.
