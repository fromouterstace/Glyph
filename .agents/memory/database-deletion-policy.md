---
name: Database deletion policy
description: The user's selected deletion restriction permits normal application updates.
---

Block deletion and destructive database changes while allowing normal
application updates. Protected-operation exceptions require both designated
approvers; this is not an instruction to make the database literally insert-only.

**Why:** The user explicitly selected “Block deletion; allow updates” after being
informed that an insert-only restriction would break draft edits, send-state
transitions, Gmail sync progress and tracking budgets.

**How to apply:** Preserve updates when designing database permissions and retained
states. Follow the exact authorization policy in
`docs/database-deletion-protection.md`; never equate lint or permission-test
success with an activated production lock.
