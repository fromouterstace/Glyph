# Test, gate, and smoke audit — 2026-11-08

## Scope and claims

This audit covers the executable test stack, runner discovery, failure
propagation, production bundle/extension packaging, public HTTP delivery, and
existing critical application journeys. It does not claim every possible input
or every application branch is covered.

The supplied meaningful-test guidance remains mandatory:

| Layer | Maximum nonblank, noncomment lines per test |
| --- | ---: |
| Unit and isolated UI | 50 |
| Contract | 100 |
| Integration | 150 |
| End-to-end | 200 |

Use focused Arrange–Act–Assert cases and reusable helpers. The limits are
enforced by lint and independently exercised by negative-control gate tests.
Test counts and coverage percentages are not probabilities of regression.

## Findings closed

1. **Discovery protected only composer suites.** The existing discovery CLI now
   requires all current critical UI and service suites: auth forms/gates, protected
   pages, downloads, Gmail authorization/sync, message presentation, owner isolation,
   mailbox identity, OAuth, proxy behavior, admin access, composer lifecycle, and
   the controlled tracking journey. Each required suite has an omission test.
2. **Dedicated runner boundaries could disappear.** Inventory checks now protect
   contract, database/service/process, HTTP, and standalone extension runner
   membership. Required unit-suite discovery is checked before unit execution.
   Discovery checks do not replace behavioral tests.
3. **Standalone extension contracts used plain Node despite a TypeScript import.**
   Their entrypoint now uses `tsx --test`, matching the working contract runner.
4. **Smoke checked entry assets, not lazy dependencies.** It now traverses
   same-origin compiled ESM dependencies and Vite preload JS/CSS references,
   checks types/nonempty/non-HTML responses, handles cycles, and bounds the
   traversal by module count and total asset bytes. Missing lazy pages fail.
   This is delivery evidence, not browser execution of those modules.
5. **Four ZIP magic bytes could pass download smoke.** It now verifies archive
   directory/local-header bounds, filenames, CRC checksums, a Manifest V3
   manifest, version format, and required nonempty extension runtime files.
   The validator intentionally follows the stored-file ZIP format emitted by
   the actual packager. Changing archive formats requires updating the gate.
6. **Built files were not checked through that same asset/package logic.**
   The Glyph `build:artifact` command now runs `check-built-assets.mjs` after
   bundling and the existing lazy-route manifest check. It validates the actual
   built files, including nonroot base-path handling, without pretending a
   mocked API is healthy. CI and ordinary publishing builds inherit this gate.
7. **New gates needed proof of failure propagation.** CLI/subprocess negative
   controls demonstrate missing lazy chunks, failed built-asset verification,
   and failures at each database/service/process integration stage prevent a
   successful overall result.
8. **A process test incorrectly equated forced exit with transaction rollback.**
   The earlier failed workflow expected no event after a blocked PostgreSQL
   statement's client process exited. Disconnect detection can race with lock
   release: an in-flight write can commit despite the exit. The deadline test
   still requires bounded nonzero exit and at most one valid event, but does not
   claim rollback. Separate real-process tests retain graceful draining and
   committed sending-claim/restart idempotency coverage.
9. **Published smoke rejected an infrastructure cookie.** Live read-only smoke
   reached all built chunks and anonymous API checks, but the pixel assertion
   rejected Google's `GAESA` routing cookie. Replit documents it as a
   platform-managed routing identifier, not application/session data. Smoke now
   permits that exact cookie name only and still rejects unexpected cookies;
   failure diagnostics never include cookie values.

No real customer tracking token was requested, no production data was changed,
and no real email was sent for this audit.

## Existing coverage checked

| Boundary | Executable evidence |
| --- | --- |
| Anonymous reads/writes and test-header rejection | Local HTTP contracts against the running API |
| Authenticated cross-owner isolation | Actual application routes and PostgreSQL, controlled Clerk identity boundary |
| Gmail connection owner binding, OAuth state/reconnect | Personal-mailbox integration suites with controlled Google responses |
| Composer formatting, attachments, To/Cc/Bcc and lifecycle | UI and PostgreSQL/service integration suites |
| Pixel persistence, repeat requests, HEAD, disabled tracking, budgets | Real tracking handlers and isolated PostgreSQL |
| Pixel/click/reply independence and reply deduplication | Unit, database, and controlled tracking-journey suites |
| Gmail quota/failure behavior, no automatic send retry | Adapter/service integration suites |
| Extension context loss, setup, narrow compose placement, draft safety | Actual extension scripts in controlled DOM/VM contracts |
| Readiness, shutdown, blocked writes, recovery | Unit, HTTP, and real child-process tests |
| Logging, origins, headers, proxy/admin boundaries | Critical units plus service integration |
| Test discovery, skipped/focused tests, size limits, coverage gates | Gate tests with intentional failure controls |
| Published delivery availability | Read-only scheduled-smoke workflow configuration; actual activation is external |

## Remaining evidence boundaries

- Real Clerk/Google consent on the published custom domain is not proved by
  synthetic test identity or mocked provider responses.
- The Gmail DOM fixtures do not prove that every live Gmail layout, browser
  version, localization, or extension lifecycle works.
- Actual Gmail image-proxy fetching, delivered-recipient replies, and notification
  delivery require controlled live-provider checks. Pixel requests never prove
  recipient identity or human reading.
- Coverage thresholds remain **selected critical-module coverage**, not a
  whole-application per-file or branch guarantee. UI/service suites have required
  discovery and assertions but no whole-source coverage percentage is claimed.
- Source/CI workflow files do not establish that GitHub branch protections are
  enabled, that scheduled runs are executing, or that the repository's production
  origin variable is configured. Those require repository-side evidence.
- Source-level asset traversal cannot discover arbitrary computed import URLs or
  prove runtime hydration, interactive authentication, or third-party availability.

## Reproduction

- `pnpm check`: lint, format verification, strict types, critical discovery,
  selected-source coverage, units, contracts, UI tests, and gate negative controls.
- `pnpm check:integration`: isolated PostgreSQL, service, and process suites.
- `pnpm check:http`: local running-application HTTP/security contracts.
- `pnpm check:smoke`: local delivery/readiness/API/asset/ZIP smoke.
- `PORT=3000 BASE_PATH=/ pnpm --filter @workspace/glyph run build:artifact`:
  bundle, lazy-route separation, recursive built-asset and ZIP integrity gates.
  Run the fast gate first; this remains an internal build primitive.
- `pnpm release:regressions`: measured release outcomes, not test percentages.

At audit time the release ledger contained one pending observation window and
zero completed observations. Its regression rate is **unknown**, not below 1%.
Maintain release observation evidence before making a numerical risk claim.

## Final verification results

| Check | Result |
| --- | --- |
| Lint, Prettier verification, TypeScript | Passed |
| Critical unit tests | 203 passed |
| Extension/other contracts | 71 passed |
| UI tests | 74 passed across 12 files |
| Gate negative controls | 13 passed |
| Isolated PostgreSQL contracts | 21 passed |
| Service integration | 98 passed across 11 files |
| Process lifecycle/recovery | 6 passed; configured database workflow finished successfully |
| Local HTTP contracts | 32 passed |
| Local and published `https://glyph.rocks` read-only smoke | Passed |
| Production Glyph bundle, route chunks, recursive asset graph, extension archive | Passed |
| Signed-out `/emails` preview | Sign-in wall rendered |

That is 518 passing test cases across these runners. The selected critical
unit-source report measured 98.70% lines, 97.17% branches, and 100% functions.
Those percentages do not describe whole-application coverage.

These changes are in the workspace; this audit did not publish a new release.
