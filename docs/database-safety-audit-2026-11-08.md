# PostgreSQL and database-canon audit — 2026-11-08

## Evidence and scope

Read-only catalog queries against both development and production inspected
public table/column types, nullability, defaults, primary/foreign/unique/check
constraints and index definitions. Application schema sources, database client,
schema commands, isolated test setup, deletion/transaction paths, post-merge,
quality CI, and canon were reviewed. No customer rows, bodies, addresses, OAuth
tokens, or connection values were read or exported.

Both environments have the same nine public Glyph tables. Column definitions and
defaults match. Constraint and index definition sets match (catalog ordering can
differ, so comparison uses sets). Every table has a primary key. Message child
events, links and budgets have cascading foreign keys. Owner IDs reference
external Clerk identities and therefore are not SQL foreign keys to a local
users table. Attachment references in JSON require application-level checks.

This is a schema/tooling audit, not proof of every row's semantic integrity,
physical corruption checks, PITR availability, restore correctness, or a tested
production recovery procedure. Planner row estimates are not exact row counts.

## Findings and remediation

| Finding                                                                                | Resolution                                                                                                                                                |
| -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Drizzle push and force-push commands had no application-level environment guard        | Replace push with a dev-only opt-in wrapper; remove force command                                                                                         |
| No versioned schema-review inventory                                                   | Commit existing schema hashes as baseline; require sequential append-only reviews and SQL plans for subsequent changes                                    |
| Hashes alone cannot detect an omitted destructive change in the SQL plan               | Compare actual exported Drizzle table/column/type/nullability shape with versioned shapes and block removals, renames and changes                         |
| No migration-plan destructive-SQL gate                                                 | Fail closed on destructive/opaque/unsupported SQL; initial policy allows only reviewed CREATE TABLE/INDEX plans                                           |
| Post-merge used an incorrect workspace selector and implicitly attempted schema push   | Replace with read-only safety validation; schema-changing merges now require an explicit reviewed development application                                 |
| Existing instruction allowed production push with authorization                        | Correct canon/project instructions: managed production uses Publish, never direct pushes                                                                  |
| No explicit clone/backup/recovery evidence requirements                                | Add required release checklist, expand/migrate/observe/contract policy, attachment recovery caveat, and approval boundary                                 |
| No tests for the new safety boundaries                                                 | Unit/negative-control suite is mandatory in discovered tests; CI validates immutable review history                                                       |
| Readiness checked critical relations and columns but not essential database safeguards | Readiness and HTTP smoke now verify critical unique indexes, validated cascading foreign keys and tracking-budget checks without exposing catalog details |
| Tenant isolation is application-scoped, with PostgreSQL RLS disabled                   | Record defense-in-depth gap; require a deliberate pooled-connection/RLS design before adding direct database access paths                                 |
| Status, event-source/type and attachment shape rules are partly application-only       | Document the boundary and point-in-time integrity checks; retain server validation and PostgreSQL contracts before adding constraints                     |
| No account-wide erase flow or data-retention worker was found                          | Record unresolved privacy/operations scope; do not introduce an unreviewed purge or retention promise                                                     |

## Remaining operational evidence

- Confirm production recovery-point retention and permissions, and perform an
  authorized isolated restore drill before the next schema-changing release.
- Configure repository branch protections/required status checks; verify that
  checked-in CI actually runs for the repository receiving changes.
- A reviewed plan is not the generated Publish diff. Human review of that diff
  and rename confirmations remains mandatory; these local gates cannot intercept
  or attest to the platform's production DDL.
- Automated clone creation, production backfills, and an external-database
  migration runner were deliberately not introduced.

See [database safety canon](database-safety.md) for mandatory procedures,
enforcement scope and explicit limitations.

## Workspace verification

- `pnpm check:all` passed: lint with zero warnings, independent Prettier check,
  strict TypeScript, mandatory suite discovery and critical-source coverage,
  227 unit tests, 77 contracts, 74 UI tests and 13 gate controls.
- PostgreSQL verification passed: 21 tracking/database tests, 98 service/owner/
  attachment/lifecycle contracts, and nine actual API-process tests. Isolated
  negative controls remove a required unique constraint, cascading foreign key
  or OAuth-state primary key and establish a 503 readiness response.
- All 32 running-server HTTP contracts and the complete local HTTP smoke passed.
  The running Preview returned `{"status":"ready"}`. Readiness checks all nine
  relations and critical columns, primary keys, critical unique indexes,
  validated cascading references and budget checks.
- Aggregate-only development and production integrity queries found zero
  unexpected message statuses/delivery sources/event types/event sources,
  sent messages without timestamps, orphan message children, unowned attachment
  references or nonpositive attachment sizes. This is point-in-time evidence.
- Dependency, static-code and privacy/dataflow scans completed without findings.
  Clean scanners do not invalidate the manual RLS and integrity-boundary gaps.
- The eight database-safety tests exercise positive and negative cases, including
  production push refusal before database access and removed/narrowed shapes.
- `pnpm check:database` passed, including a local base-commit history invocation.
  The small final baseline-SQL rejection/formatting change was followed by a
  fresh safety-gate and Prettier check.
- Signed-out `/emails` Preview still renders the sign-in wall.
- No existing development/production records or schemas were changed. Tests
  created and dropped temporary isolated schemas only. No schema push, backup
  export, restore, real mail or production publication was performed.

## Follow-up audit of the current schema

The earlier nine-table snapshot is historical. A fresh read-only catalog check
found **12 public Glyph tables in both environments**, with RLS disabled on every
one. Production and development delivery references both target messages/events
with cascading deletes. The reviewed SQL and generated Drizzle fixtures assign
different names to equivalent delivery foreign/unique constraints; names alone
are not a reliable cross-environment contract.

Aggregate-only checks in both environments returned zero for:

- Sent messages missing their sent timestamp.
- Orphan events, links or tracking budgets.
- Delivery owners inconsistent with their message owner.
- Delivery events inconsistent with their message.
- Case-folded duplicate contacts within an owner.
- Nonpositive attachment sizes and expired OAuth states.

These are point-in-time results, not proof that the database prevents all such
states. No addresses, message content or credential values were retrieved.

### Coverage gap addressed

The readiness probe omitted the delivery table even though account summaries
query it. It could therefore report ready with broken alert-delivery storage.
The probe now covers all 12 tables and the columns in the reviewed inventory.
An inventory unit gate prevents later table/column omissions. Delivery primary,
deduplication and cascading-reference requirements are included; generated-name
differences are handled by checking key/reference semantics.

Real PostgreSQL negative controls cover eight broken delivery-schema cases,
including missing storage, primary/unique keys and references, plus a same-named
unique index on the wrong columns and a foreign key to the wrong parent. Only
temporary test schemas are changed. Existing readiness HTTP smoke consumes this
stronger probe; no account data or catalog detail is exposed by it.

### Remaining gaps and limits

- Tenant isolation is still application-enforced, not database-enforced RLS.
- Delivery owner/message/event consistency, enum-like values and attachment
  ownership/shape still depend partly on application code. The aggregate checks
  above found no current violations; they do not replace database constraints.
- Remaining name-based readiness checks and the schema column-shape ledger are
  not complete semantic verification of every constraint, default and index.
- A global insert-only lock and two-person approval mechanism are not established
  by the migration lint gate. The repository still has update/delete operations;
  restricting these globally would affect normal sending, drafts and tracking.
- Production least-privilege credentials, a verified backup restoration drill,
  remote required-status/branch protection and continuous production database
  monitoring are not established by this audit.
- The checked-in GitHub workflow runs quality/build and database integration, but
  does not run the separate HTTP-contract and smoke commands. The local release
  aggregate does include them; remote enforcement remains a separate gap.

### Current verification

- `pnpm check` passed schema safety, lint, Prettier, TypeScript, source/coverage
  inventories, unit/contract/UI suites and negative-control quality gates,
  including the 50/100/150/200-line test-layer budgets.
- `pnpm check:integration` passed 23 database tests, 114 service contracts and
  nine process/shutdown/recovery tests.
- `pnpm check:http` passed all 36 running-server HTTP contracts.
- `pnpm check:smoke` passed, including the strengthened `/api/readyz` probe and
  anonymous account-data rejection. The API rebuilt and restarted successfully.
- The signed-out `/gmail` Preview still displays the sign-in wall.

No production data, privileges or schema were changed. No migration was applied
or publication performed.
