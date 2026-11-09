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

## Managed production boundary

Replit Publish does not transfer PostgreSQL role grants, functions or triggers.
Selecting a restricted pool is not proof that administrative credentials are
absent from the web process. Application approval checks cannot constrain an
administrator who uses the database console or bypasses project gates.

**Why:** Official platform documentation confirms the unsupported-object boundary;
the inspected development connection was privileged. Treating an additive schema
review or selected-role test as database-wide enforcement would overstate safety.

**How to apply:** Require separate administrator provisioning and published-runtime
evidence before claiming enforcement. Follow the supported production schema path,
use the secure secrets flow, and distinguish approval records from controls over
external administrative execution.
