---
name: Database-backed activity
description: Source-of-truth, persistence, and privacy boundaries for Glyph activity data
---

Persist actual messages, tracking tokens and destinations, and sent/open/click/reply events in PostgreSQL. Derive displayed counters from persisted events. Never substitute hardcoded sample messages or engagement records for an empty account. Signed-out reads must remain empty and read-only.

**Why:** The user requires all actual activity and pixel information to be stored in the PostgreSQL database, rather than simulated in the UI or held only in API-process memory.

**How to apply:** Verify the data path from sender or tracking request, through the database insert, to the authenticated read endpoint. Keep caches and browser storage limited to temporary provider lookups, session/UI state, or notification cursors, not canonical engagement. Count each accepted pixel request as its own stored load; preserve idempotency for sync-derived events such as the same reply or sent message.

Do not store raw IP addresses or full user-agent strings as a side effect of tracking; retain only the event classification and client-source label needed by the product.
