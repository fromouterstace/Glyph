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

| Finding | Resolution |
| --- | --- |
| Drizzle push and force-push commands had no application-level environment guard | Replace push with a dev-only opt-in wrapper; remove force command |
| No versioned schema-review inventory | Commit existing schema hashes as baseline; require sequential append-only reviews and SQL plans for subsequent changes |
| Hashes alone cannot detect an omitted destructive change in the SQL plan | Compare actual exported Drizzle table/column/type/nullability shape with versioned shapes and block removals, renames and changes |
| No migration-plan destructive-SQL gate | Fail closed on destructive/opaque/unsupported SQL; initial policy allows only reviewed CREATE TABLE/INDEX plans |
| Post-merge used an incorrect workspace selector and implicitly attempted schema push | Replace with read-only safety validation; schema-changing merges now require an explicit reviewed development application |
| Existing instruction allowed production push with authorization | Correct canon/project instructions: managed production uses Publish, never direct pushes |
| No explicit clone/backup/recovery evidence requirements | Add required release checklist, expand/migrate/observe/contract policy, attachment recovery caveat, and approval boundary |
| No tests for the new safety boundaries | Unit/negative-control suite is mandatory in discovered tests; CI validates immutable review history |

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

- `pnpm check` passed: lint with zero warnings, independent Prettier check,
  strict TypeScript, mandatory suite discovery and critical-source coverage,
  226 unit tests, 76 contracts, 74 UI tests and 13 gate controls.
- The eight database-safety tests exercise positive and negative cases, including
  production push refusal before database access and removed/narrowed shapes.
- `pnpm check:database` passed, including a local base-commit history invocation.
  The small final baseline-SQL rejection/formatting change was followed by a
  fresh safety-gate and Prettier check.
- Signed-out `/emails` Preview still renders the sign-in wall.
- No database fixtures, schema push, backup export, restore, real mail or
  production publication was performed. Existing isolated PostgreSQL contracts
  were not rerun for these tooling/documentation-only changes.
