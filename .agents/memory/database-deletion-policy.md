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

A restricted pool alone does not establish least privilege if an owner-level
connection is still available to the same web process.

**Why:** The managed database credential can remain injected independently of an
application-specific connection override. Checking the selected role does not
prove that other privileged credentials are absent.

**How to apply:** Verify the deployed process's credential boundary through the
supported administrative process before claiming production least privilege.
Do not print connection values or treat configuration support as provisioning.
