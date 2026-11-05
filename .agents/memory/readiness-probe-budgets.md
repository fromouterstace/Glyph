---
name: Readiness probe budgets
description: Why probe timeouts must bound database work, not only HTTP response latency
---

A wall-clock readiness timeout does not cancel a pending PostgreSQL pool
acquisition. Keep at most one actual database probe outstanding until the
underlying operation settles, even after its HTTP result has timed out.

**Why:** Replacing an unresolved pool acquisition at every health-check interval
turns a database outage into an accumulating queue competing with email tracking.
Releasing a late connection without accounting for an outstanding query can also
return a busy client to application traffic.

**How to apply:** Bound response time and query time separately, destroy late
clients, coalesce callers, and briefly cache failures as well as successes.
Keep operational liveness independent of database readiness and Gmail access.
