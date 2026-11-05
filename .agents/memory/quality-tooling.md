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

A Node test that starts another independent `node --test` CLI must remove the inherited `NODE_TEST_CONTEXT` from that child's environment.

**Why:** The inherited test-worker context made a deliberately under-covered negative control exit successfully without normal discovery. Removing that internal flag made the same control correctly fail the coverage threshold.

**How to apply:** Preserve the rest of the child environment, clear only that worker flag when testing a fresh CLI, and assert both the nonzero status and the coverage failure reason. Do not assume a zero exit proves tests actually ran.

Selected-module Node coverage does not establish that every intended source was loaded.

**Why:** Coverage include patterns filter instrumented/loaded scripts; an unimported critical source can disappear from the denominator rather than contribute zero coverage.

**How to apply:** Preserve critical-source coverage when separating test layers. Require an independent expected-source inventory before claiming complete critical-module coverage; otherwise explicitly state the selected, loaded-source limitation.

When sharing Vitest hoisted mocks from a helper, declare the hoisted binding first and export it separately.

**Why:** Vitest 5 rejected an inline exported `vi.hoisted` variable before discovering any tests. A separate declaration and named export preserves mock hoisting across helper imports.

**How to apply:** Use `const edge = vi.hoisted(...); export { edge };` for shared external-boundary fixtures. Keep the mock itself test-only; never add a production identity-header bypass to simplify authorization tests.
