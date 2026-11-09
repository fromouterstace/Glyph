# Retained-state code audit

## Status

The workspace's executed quality checks pass after the fixes below. This is not
proof that every possible app error is absent, that production permissions are
restricted, or that the two-person approval workflow exists.

## Findings fixed

| Finding                                                                                        | Correction and evidence                                                                                                                       |
| ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Readiness omitted new retirement columns                                                       | The readiness projection now covers every column in the reviewed schema; the inventory test fails when one is omitted.                        |
| Click-budget test crossed real minute boundaries                                               | The test freezes its clock so prefilled counters and the HTTP request use the same fixed window. Actual budget admission/expiry tests remain. |
| An archived draft could receive a stale concurrent edit                                        | The update predicate now requires an unarchived row, matching the read and send-claim guards.                                                 |
| Reusing an active tracking-link ID could silently disagree with its supplied destination/token | Send claims reject changed immutable link mappings and roll back the status transition.                                                       |
| Test fixtures could select a configured application runtime connection                         | The database module rejects that combination before creating its pool; subprocess tests use synthetic URLs without connecting.                |
| Retaining rejected oversized upload bytes could accumulate unbudgeted storage                  | Malformed upload bytes are cleaned up while their retired database metadata remains. Valid removed attachments retain their bytes.            |
| The former staging counter did not bound retained saved attachments                            | The account retention budget includes all owner attachment metadata, including retired entries. Its sum avoids a 32-bit cast overflow.        |
| New retention suite could silently disappear from the dedicated runner                         | It is now mandatory in the discovery inventory, including a negative control for omission.                                                    |

## Verification

- The main `pnpm check` run passed schema safety, lint, Prettier, TypeScript,
  required discovery, critical-source coverage, unit/contract/UI tests and the
  50/100/150/200-line test-layer limits.
- After subsequent test-only edits, repository lint/format checks, mandatory
  discovery and its 40 inventory tests passed again.
- All 25 database integration tests passed, including actual restricted-role
  SELECT/INSERT/UPDATE success and DELETE/TRUNCATE/DROP denial.
- The initial service run passed the 114 existing tests but exposed a missing
  direct dependency import in the new suite. The import was removed rather than
  adding an unnecessary dependency. The three affected suites then passed all
  30 tests, covering the new suite and updated OAuth/attachment assertions.
- All nine process-level tests passed: readiness failure controls, graceful
  shutdown, blocked-write deadlines, crash recovery and send idempotency.
- All 36 HTTP contracts passed after restarting the API with the final code.
  The running readiness endpoint returned 200 and the route/asset/API smoke
  runner passed.
- A fresh signed-out `/gmail` screenshot showed the expected sign-in wall.
  No current browser application error was observed in that capture; expected
  development-SDK and rendering-environment warnings remain.

The new retention checks cover retained rows/valid file bytes, retired-link
inaccessibility, token preservation, immutable mappings, archived-send rejection,
cleared consumed OAuth verifiers and account-specific retention quotas.

## Unfinished protection and evidence

- No restricted production login or production permission lock was provisioned.
- The runtime URL override and required-setting check are configuration support,
  not evidence of restricted privileges. A privileged credential remaining in
  the web process is a separate boundary that must be resolved.
- No operation-specific two-person approval workflow is implemented.
- Production backup restoration, database-level tenant isolation and remote
  branch protection are not established by these checks.
- Live Gmail recipient delivery and authenticated real-browser behavior were
  not tested in this audit. The service tests use isolated fixtures.
- Nothing was published and no production permissions or schema were changed.

See [the deletion-protection policy](database-deletion-protection.md) for the
approved policy, development expansion and activation prerequisites.
