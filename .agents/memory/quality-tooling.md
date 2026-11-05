---
name: Quality-tooling checks
description: Non-obvious dependency-graph and formatter behavior encountered during audits
---

Audit the complete dependency graph after adding quality tools, not only production dependencies or the first vulnerable parent.

**Why:** Current lint tooling brought the same vulnerable transitive glob matcher through multiple independent parents. Fixing one parent-specific edge left an advisory through another edge.

**How to apply:** Prefer supported parent updates. If the latest parents still require a vulnerable version, constrain an override to the affected version range, verify the affected tool still works, and rerun the audit across the complete graph. Do not broaden application-library versions unnecessarily.

Treat formatting verification separately from the formatting write command.

**Why:** Prettier 3.9.10 produced a non-idempotent first pass when expanding some formerly single-line fluent response chains. An immediate check still found three files; a second pass stabilized them.

**How to apply:** Require a clean format check, not merely a successful format write. Revisit this caveat after upgrading Prettier rather than assuming an immediate mismatch proves concurrent edits.
