# Database safety canon, guardrails, and release safetyrails

## Approved deletion policy

Normal application updates remain allowed. Physical deletion, truncation,
dropping objects and destructive schema changes require protection and both
designated approvers for any exception. See
[deletion protection](database-deletion-protection.md) for the exact policy,
permission preflight, proven isolated-role tests and outstanding activation
prerequisites. This policy is **not yet enforced on the deployed database**.

## Scope and supported production path

Glyph uses PostgreSQL with Drizzle, not Prisma. Replit manages this project's
production database. **Replit Publish is the only production schema application
path.** Never run Drizzle push, Prisma deploy, custom SQL migration runners, build
hooks, or startup DDL against managed production. An explicit instruction to
change production still does not authorize bypassing the supported Publish path.

The user's requested principles apply: version every schema change, block
destructive plans, expand before contracting, rehearse against an isolated clone,
and verify recovery before execution. On this platform, committed review plans
are **not an executable production migration ledger**. Publish computes its own
development-to-production diff; its actual proposed changes must be reviewed too.
Do not represent a reviewed SQL file as the exact SQL Publish will apply.

For a future explicitly authorized move to an external production database,
design a separate versioned author/deploy migration workflow. Do not introduce
Prisma solely to apply this guidance to an existing Drizzle app.

## Automated guardrails

`pnpm check:database` is read-only and makes no database connection:

- Every schema source file, including additions and removals, must match the
  latest SHA-256 inventory in `lib/db/schema-reviews/NNNN.json`.
- Each version also records `NNNN.shape.json`. The gate imports the actual
  Drizzle schema (not its database client) to verify table/column/type/nullability
  inventory. Comparing successive shapes blocks removed tables/columns, renames,
  type changes and nullability changes even if new source hashes are supplied.
  Defaults, check/index/foreign-key semantics and backfill correctness still
  require diff review and PostgreSQL contracts; this shape check is not a full
  semantic migration analyzer.
- Records are sequential. The first record is a baseline of the existing schema,
  not a claim that historical changes were migrated or rehearsed.
- Later records must be expand-phase reviews with a nonempty reason,
  compatibility explanation, recovery evidence reference, and a matching
  `NNNN.sql` plan with `planSha256`.
- CI checks every existing review record and SQL plan byte-for-byte against the
  PR base or push-before commit. Existing history cannot be edited or deleted.
  Manual CI runs without a base still check current inventory and SQL; they do
  not independently establish append-only history.
- The conservative SQL blocker rejects DROP, TRUNCATE, DELETE, UPDATE, renames,
  existing-column ALTER, procedural/dynamic SQL, comments, dollar quoting, and unsupported
  statements. Its allowlist is CREATE TABLE / CREATE INDEX review plans and
  the strictly validated nullable/constant-default ADD COLUMN forms below.
  It is not Atlas or a full SQL parser, and it does not prove an additive
  statement has no locking/performance effects. It may reject harmless literals.
  Extending support (for example nullable ADD COLUMN) requires a reviewed policy
  change and positive/negative tests, not a force flag or local waiver.
- Runtime API/web-server source and artifact run/build configuration are checked
  for direct schema-execution patterns. This is defense-in-depth, not whole-program
  analysis of imported tools or arbitrary dynamically constructed SQL.
- Root quality/build and CI run this gate. CI must be enabled in the repository
  and required by branch rules for it to prevent merges; checked-in YAML alone
  does not establish those external settings.

The development push wrapper refuses production NODE_ENV, requires
`GLYPH_DATABASE_TARGET=development`, rejects additional/force flags, and checks
the schema inventory first. The target marker is an operator assertion, **not**
proof that a connection points to development. Confirm the selected environment
without printing credentials. Never relabel production as development.

`push-force` was removed. Post-merge installs dependencies and validates the
schema; it no longer silently pushes schema changes. After a schema-changing
merge, an authorized operator must review and apply the development change using:

```sh
GLYPH_DATABASE_TARGET=development pnpm --filter @workspace/db run push
```

Do not run this command during ordinary validation. Direct developer access to
Drizzle/psql remains possible: these controls do not replace permissions, review,
or the platform's production safeguards.

## Required expand-and-contract sequence

Reviewed expansion plans may add nullable text/timestamptz columns or boolean
columns with constant true/false defaults (including NOT NULL with that default).
Expression defaults, type changes, renames, removals and arbitrary ALTER remain
blocked. New-table foreign keys may use ON DELETE CASCADE to preserve existing
message deletion semantics; this does not permit DROP CASCADE or data-changing
statements. The alert delivery expansion does not run DDL or backfill at startup.

1. **Expand:** design additive structures and backwards-compatible readers.
   Document old/new application compatibility, owner isolation, indexes,
   defaults, uniqueness, foreign keys, lock budget, and expected table size.
2. **Migrate:** separately authorize a bounded, resumable, idempotent backfill.
   Use dual-write/compatible reads as needed. Prove parity, retries, rollback
   behavior, partial-failure recovery, and that old instances can still run.
   No automatic production backfill is installed by this work.
3. **Observe:** verify counts, constraints, owners, associations and application
   behavior over an explicit observation window. Retain evidence without email
   contents, recipient addresses, tokens, or secrets.
4. **Contract:** only after old code, queued jobs, extensions, and deployed
   instances no longer depend on the old structure. Removal/type narrowing/
   NOT NULL/constraint removal requires explicit approval, a restored-clone
   rehearsal, and a separate reviewed policy extension; current SQL lint blocks
   contractions by default. Never drop/recreate to work around a rename prompt.

Sent-message tokens and historical events must remain resolvable. Deleting a
message cascades to links, events, and tracking budgets; treat this as intentional
data deletion, not cleanup. The application archives the authenticated owner's
unsent web drafts/failed messages instead of physically deleting their rows.
It also retires obsolete links, OAuth states and attachments without erasing
their metadata; retired attachment bytes remain stored and count toward quota.
Attachments live in App Storage: a PostgreSQL restore alone cannot restore
deleted attachment bytes or their exact object generations.

## Tenant security and integrity boundaries

The current data-access security model is **application-enforced owner scoping**:
authenticated handlers derive Clerk owner IDs server-side and owner-isolation
integration tests cover account reads, writes, pagination, settings, activity,
draft claims and attachments. Catalog inspection on 2026-11-08 found PostgreSQL
row-level security disabled for every Glyph table in both environments. Therefore
a database credential or future query path that bypasses those handlers is not
contained by RLS. Do not claim database-level tenant isolation. Before adding
direct SQL clients, analytics, or another service, design and test transaction-
scoped tenant identity plus RLS (including FORCE RLS, table owner/BYPASSRLS
behavior, pool reuse and background jobs). Enabling policies ad hoc would break
existing pooled queries; this audit does not apply that breaking schema change.

Current DB-enforced integrity includes primary keys, unique pixel/link tokens,
reply fingerprints, owner-scoped native-compose keys, cascading message→event/
link/budget references and validated tracking-budget checks. The readiness probe
checks every table and column in the current reviewed inventory with a zero-row
query, plus bounded catalog-only checks for primary keys, critical unique
indexes, required cascading foreign keys and budget checks, without disclosing
catalog data. Delivery deduplication keys and foreign references are checked by
their columns, target and delete action, not generated constraint names. The
existing `/api/readyz` smoke path exercises those checks in Preview and published
smoke; an unhealthy database returns only `not_ready`.

The unit gate compares the probe with the latest reviewed schema shape, so a new
table or column cannot silently be omitted. Isolated PostgreSQL negative controls
remove delivery storage/keys/references and replace same-named constraints with
incorrect definitions; readiness must fail closed. These tests use only a
guarded, temporary test schema. They never mutate application tables.

Readiness is not a full semantic schema verifier: other name-based guards do not
prove every check expression or key definition. Nor does a green probe establish
backup recoverability, least-privilege credentials or workload performance.

Other integrity boundaries remain application-enforced: message status,
delivery source, event type/source, attachment size/shape, attachment JSON-to-
table ownership/generation, and owner IDs that refer to Clerk rather than an
in-database account table do not all have PostgreSQL constraints. Preserve
server-side validation, transaction/owner checks and focused integration tests.
Before adding a database constraint, inspect existing production values and
exercise an expand/backfill/validate plan; do not infer safety just from the
schema types. On the audit date, aggregate-only checks found zero unexpected
statuses, delivery sources, event types/sources, missing sent timestamps, orphan
message children, unowned attachment references, or nonpositive attachment
sizes in development and production. This is a point-in-time check, not a
continuous integrity guarantee.

There is no automated message/event retention purge or account-wide database
erasure path. The product canon intentionally has not promised a retention
window/export contract. Do not create a purge job until those requirements,
legal/privacy review and attachment/App Storage cleanup semantics are defined.
OAuth state expiry is checked when state is consumed and stale owner states are
cleaned on a later OAuth initiation; no database-wide expiry worker was verified.

## Mandatory pre-execution release checklist

Copy this checklist into the schema-change review. **Stop if evidence is missing.**
Free-text fields in JSON do not verify that these operational steps happened.

- [ ] Record target environment and schema version; validate that the connection
      belongs to that environment without recording its URL or credentials.
- [ ] Review the development schema diff and Publish's actual proposed production
      diff. Confirm renames preserve data; reject drop/add substitutions and
      “overwrite production data.” Do not assume a CLI `--dry-run` exists.
- [ ] Record a recovery point for the correct production database, timestamp,
      retention window, authorized operator, and recovery objective. Verify it
      is available before execution. A development checkpoint is not proof of a
      production backup, and a newly created empty database is not a backup.
- [ ] Restore that recovery point into an isolated access-controlled clone and
      validate recovery: schema, row counts, constraints, owner associations,
      token/event continuity and attachment object generations. Do not restore
      over production just to test a backup.
- [ ] Rehearse the proposed change and old/new application compatibility on that
      clone, with no live email, customer pixels, notifications, or active OAuth
      workers. Mask data/minimize access; never commit dumps, sensitive evidence
      or connection strings to Git or CI artifacts.
- [ ] Rehearse bounded locks/timeouts, data-copy verification and rollback or
      forward-repair; measure duration against the release downtime budget.
      A transaction rollback is not a safe dry-run for every operation or
      external side effect.
- [ ] Obtain explicit approval for any destructive action; publish through the
      supported flow, observe readiness and owner-scoped critical journeys.
- [ ] Retain sanitized review/rehearsal evidence; delete clone/exports according
      to the agreed retention policy. Never let a cleanup target production.

No backup, production clone, restore, or schema change was executed as part of
adding these controls. Production backup retention/recovery permissions must be
confirmed in the platform before a schema-changing release.

Platform references:
[Publish schema changes](https://docs.replit.com/features/data-and-storage/publish-database-changes),
[data recovery](https://docs.replit.com/features/data-and-storage/data-recovery),
[development/production isolation](https://docs.replit.com/features/data-and-storage/development-and-production).
