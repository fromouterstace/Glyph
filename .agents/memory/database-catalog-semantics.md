---
name: Database catalog semantics
description: Why database readiness must allow equivalent generated constraint names.
---

Check delivery uniqueness and foreign references by key columns, referenced
table/columns and delete action rather than assuming generated names match.

**Why:** Reviewed additive SQL used PostgreSQL-default constraint names while
Drizzle-generated isolated fixtures used different names for equivalent
constraints. Name-only checks can falsely reject a healthy deployment and can
miss a same-named constraint protecting the wrong columns.

**How to apply:** When extending database readiness or comparing schema catalogs,
verify semantics in both the reviewed-SQL and generated-fixture environments.
Keep broken-definition negative controls, not only missing-name tests.
