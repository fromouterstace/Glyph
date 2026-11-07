---
name: Provider-independent replies
description: User's requirement that reply detection not depend on the recipient using Gmail
---

The user stated: "reply detection should work with any email service - not just gmail".

**Why:** The user explicitly requested service-independent reply detection.

**How to apply:** Do not tie reply attribution to Gmail-only conversation IDs or require the recipient to use Gmail. Distinguish recipient-service compatibility from which sender mailbox integrations are connected. Replies are separate evidence and must not be converted into pixel-open events.

Reconnects must invalidate authorization and message caches without changing
the identity used to deduplicate existing replies.

**Why:** Renewing credentials for the same mailbox does not create a new reply.
Changing deduplication identity during reconnect or migration would recount old
replies and could deliver duplicate alerts.

**How to apply:** Keep cache-generation identity separate from stable reply
identity. Preserve the previous reply identity when migrating existing mailbox
history from the shared connector to personal authorization.
