---
name: Gmail read budgets
description: Shared connector quotas, honest paused scans and partial progress
---

Rate limits belong to the connected Gmail mailbox, not to an individual dashboard tab or authenticated owner. Account for native-send checks, reply scans and profile reads together. Never solve read throttling by automatically retrying sends or other writes.

**Why:** A reply-header batch produced HTTP 429 while the UI framed the result as a failed reply check. Concurrent readers can amplify the limit, and an all-or-nothing batch can postpone already-fetched reply matches.

**How to apply:** Respect provider retry windows; stop upstream requests during cooldown; preserve successful matches before a later read fails; distinguish paused/partial checks from proof that no replies exist. Process-local protection alone is not a cross-instance or restart-persistent quota guarantee.
