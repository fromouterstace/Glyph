# Glyph testing canon and regression gates

The complete product, privacy, safety, release, and supplied meaningful-test
guidance is [Glyph's engineering canon](glyph-canon.md). This file specifies
the executable gates and the current test evidence; consult the canon when
choosing behavior to test.

The follow-up safeguards and their scope are documented in
[test-gap closure](test-gap-closure.md): controlled extension clocks,
authenticated owner isolation, real adapter/service journey contracts, and a
required-source LCOV inventory. The database integration command includes those
service suites; the running-app HTTP gate also rejects test-only identity headers.

## Business truth comes first

Every test names the rule it proves and uses Arrange–Act–Assert. Prefer one act,
one focused fixture, and one assertion cluster (outcome plus invariants). Lint
enforces these per-test function budgets, excluding blank lines and comments:

| Test layer  | Maximum lines | Typical scope                                            |
| ----------- | ------------: | -------------------------------------------------------- |
| Unit        |            50 | Pure logic and isolated UI behavior                      |
| Contract    |           100 | One module boundary, adapter, or source/runtime contract |
| Integration |           150 | One behavior spanning the service and a real dependency  |
| End-to-end  |           200 | One user-visible journey and at most one high-risk edge  |

Reusable setup and fixtures should live in separate helpers rather than inflate
the test case. Do not inflate assertions to chase counts. A sequence is
appropriate only when the rule itself is sequential, such as extension
invalidation or duplicate-request handling.

NQT examples in the source guidance are not Glyph schema requirements. Use Glyph's
actual message IDs, opaque tokens, owner boundaries and standard email headers.
Never implement QBR identifiers or change customer data just to fit a fixture.

## Audit findings addressed

The starting suite tested many pure and UI behaviors, but the HTTP checks were
outside the normal check command, database constraints had no executable
integration suite, coverage had no enforced budget, test discovery used a
hand-maintained list, no named validations were registered, and publishing
artifact builds did not require the complete fast gate. These gaps are now
covered by the layers below. Running-app HTTP contracts deliberately remain a
separate explicit gate because an autonomous unit run must not require a server.
They are included in `check:all`, not silently treated as CI-passing unit tests.

## Repeatable commands

| Command                            | Purpose                                                                                                                                                                      | Dependencies                                               |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `pnpm check`                       | Zero-warning lint, verified formatting, strict TypeScript, pure unit tests, local source-contract tests, mocked UI tests, critical coverage and build-gate negative-controls | Installed packages; no Gmail, database, or running app     |
| `pnpm check:integration`           | Actual PostgreSQL constraints and production tracking router                                                                                                                 | Development/test PostgreSQL; schema create/drop permission |
| `pnpm check:http`                  | Anonymous access, image responses, authentication/write boundary checks                                                                                                      | Running local app/proxy on port 80                         |
| `pnpm check:smoke`                 | Read-only page, entry-asset, extension-download, anonymous API and invalid-token delivery checks                                                                             | Running local app/proxy; bounded startup-health preflight  |
| `pnpm check:all`                   | All of the above                                                                                                                                                             | Running local app plus test database                       |
| `PORT=3000 BASE_PATH=/ pnpm build` | Fast checks followed by both production artifact bundles                                                                                                                     | Installed packages                                         |

The ordinary API and web `build` commands run the fast gate before bundling, so
configured publishing builds are gated too. `build:artifact` is the internal
ungated bundle primitive used _after_ a successful root preflight; it is not a
release command. Development startup remains fast and does not run the gate.
Negative-control tests prove a failed preflight prevents each configured build.
The complete gate also executes smoke and propagates a smoke failure. The UI test
entrypoint explicitly selects test mode, with a negative control for inherited
production mode. HTTP contracts wait up to 15 seconds for healthy API JSON before
their assertions; they do not retry a failed security or persistence assertion.
The Replit `release` validation runs `pnpm check:all` before building both
production artifacts. GitHub Actions runs the fast build gate and PostgreSQL
integration suite; running-app HTTP contracts remain in the configured Replit
gate because they require a running API with Clerk configuration.

GitHub Actions runs gated builds and PostgreSQL integration on pull requests and
main pushes using a disposable PostgreSQL service. This workflow activates when
the repository is pushed to GitHub. Require its `quality` job in branch protection
there; a workflow file cannot enforce repository protection settings itself.
Replit named validations expose the same commands without requiring GitHub.

## Risk-weighted coverage, not a promised defect percentage

### Web-composer regression protection

`pnpm check:composer` is a fail-closed **discovery inventory**, not a substitute
for executing tests. It asks both real Vitest configurations which files they
discover and requires the composer lifecycle, rich editor, private attachments,
delivery-origin, recipient, owner-isolation, connector-failure and send lifecycle
suites. Deleting or excluding a required suite fails the fast gate. Negative
controls prove both the inventory CLI and its inclusion in `pnpm check` fail
closed. The normal `pnpm test` executes the UI suites; `pnpm check:integration`
executes the PostgreSQL/service suites. Both run in `pnpm check:all`.

Focused UI cases cover failed saves preventing confirmation, explicit cancellation,
failed sends retaining edits/files without automatic retries, pending-send
controls, settings failure revoking confirmation, and invalid/duplicate/empty
recipient groups. Attachment cases reject failed byte uploads and failed
finalization without adding unverified files. The service layer confirms that
retrying a confirmed send yields one provider submission and one persisted Sent
event, with rich content retained after reload. Existing atomic-claim cases
cover concurrent draft edits and concurrent sends.

Smoke now checks anonymous message-detail and attachment downloads as well as
the list/settings endpoints. These use nonexistent fixture IDs and GET only;
they cannot send mail, upload files, or generate customer engagement. Smoke
checks HTML/asset delivery and unauthenticated boundaries, **not** execution of
the composer, authenticated delivery, or recipient-side Gmail behavior.

All additions follow the supplied single-rule/AAA guidance and existing
50/100/150/200-line budgets. They do not establish a <1% regression rate.
Send-later scheduling is not implemented or implied by these checks.

Node's built-in coverage fails the unit gate below **95% lines, 90% branches,
100% functions**, aggregated over the selected native-send verification,
provider-independent reply matching, tracking-origin policy, pixel modules,
Gmail read throttling, incremental reply-header processing, and request-log
privacy/correlation serializers, plus owner-scoped message presentation.
Both frontend and backend origin helpers are included. This is deliberately
**not** a claim of whole-app coverage. A negative control proves an uncovered
branch fails the coverage mechanism. A separate fail-closed LCOV inventory now
requires every selected critical backend source and the frontend origin source
to be present; high percentages cannot hide an omitted source.

New `test-*.mjs` and `*.test.mjs` unit files are discovered automatically.
Database tests use `.integration.test.mjs`; tests that read extension output/source
are explicit local source-contract checks, not pure unit tests; the running-app
HTTP suite is explicitly separate. `.e2e.test.*` cases are excluded from unit
coverage and must be added to the full check/CI runner when introduced. Missing
unit discovery fails rather than returning green. Lint rejects focused, skipped,
and TODO test calls and negative-control tests prove all four size budgets.
Never quarantine a flaky test silently.

## Risk matrix

| Business invariant                                                                          | Automated evidence                                                   |
| ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| One pixel GET creates one durable event; repeated loads remain distinct                     | Real router + isolated PostgreSQL                                    |
| HEAD, disabled tracking, unconfirmed web drafts, Gmail compose loads do not fabricate opens | Real router + PostgreSQL                                             |
| Clicks and replies do not imply pixel loads                                                 | Router/database contracts + reply unit cases                         |
| Scanner/proxy signals are honestly labeled                                                  | Real router + persisted source fields                                |
| Pixel insert failures are observable even when an image is returned                         | Real router + injected database failure                              |
| Tracking outcomes and failures retain request IDs without exposing tracking tokens          | Real Pino HTTP middleware + correlated PostgreSQL route checks       |
| No orphan events/links; deletion cascades correctly                                         | PostgreSQL foreign keys and cascade checks                           |
| Tokens, native compose identity, reply fingerprints remain unique                           | PostgreSQL uniqueness checks                                         |
| Recipient/service matching uses real message headers                                        | Native verification and reply matching fixtures                      |
| Production/preview tokens cannot cross environments                                         | Origin tests, deterministic property cases, extension contract tests |
| Extension context loss cannot corrupt or send a draft                                       | JSDOM runs of the actual extension scripts                           |
| Polling does not overwrite edits; forms reset on record changes                             | React component tests                                                |
| Anonymous clients cannot mutate account data                                                | Local HTTP suite against the running application                     |
| A failed check actually stops a build                                                       | Negative controls execute the real configured build commands         |
| Database columns and public JSON fields preserve distinct casing conventions                | Drizzle/OpenAPI casing contract checks                               |

## Fixture safety and determinism

Unit logic has no external services. Use fixed timestamps and minimal realistic
fixtures. Property cases enumerate a fixed domain, not random network inputs.
Database fixture IDs are deterministic; only the isolation schema name is random
to prevent two test processes colliding.

The integration process generates DDL from the current Drizzle source, sets its
own PostgreSQL pool's search path to a unique `glyph_test_*` schema, retargets
generated foreign-key references to that schema, and drops only that schema in
teardown. It does **not** migrate or write customer tables, call Gmail, send
emails, or request real customer pixels. Setup failure fails closed. Running the
integration command in NODE_ENV=production is prohibited. A killed process may
leave a test schema; do not broaden teardown into deleting arbitrary schemas.

Never substitute an in-memory fake for a database contract. Log assertions prove
the outcome is emitted and do not include pixel tokens or recipient addresses.
Keep returned GIF responses distinct from evidence that an event was committed.

## Release discipline and measurement

For every discovered bug, reproduce it with a failing focused test, then fix it
and retain the case. Run the appropriate level once per coherent change.
Browser testing is reserved for changed high-risk journeys or explicit browser
verification, not every refactor.

The goal “less than 1% regression” needs a denominator and observations. Track
**releases with at least one confirmed regression / observed releases**, with a
consistent observation window (recommended: 7 days after release). Record release
date, affected invariant, detection method, severity and regression test added.
Do not substitute test pass percentage or code coverage for this release rate.
There is no historical release series here, so the current regression rate is
**unknown**, not <1%. Even zero failures over a small sample is not proof.

Remaining integration evidence that local simulation cannot supply: Google’s
actual recipient image proxy fetching a newly sent pixel, real Chrome/Edge
extension lifecycle behavior, real provider replies reaching the connected Gmail
mailbox, and notification delivery across browser/server restarts. Use controlled
test mailboxes for those release smoke checks; do not manufacture customer opens.

## Running smoke against a published release

Use `pnpm check:smoke https://YOUR-PUBLISHED-ORIGIN` with the current URL returned
by publishing metadata. Remote targets must use HTTPS, without credentials,
query strings or subpaths. The default is the local proxy on port 80.

This command issues only anonymous GETs. It uses deliberately invalid tracking
tokens, so it cannot create customer engagement or follow a customer link. It
checks bounded PostgreSQL/critical-table readiness, HTML shells and directly
referenced local JavaScript/CSS, not execution of JavaScript, transitive chunks,
sign-in, user isolation after sign-in, every schema column, Gmail authorization,
notification delivery or valid-token persistence.
An HTML fallback for a missing asset/ZIP fails. An account-read 200 or redirect
fails even when its result appears empty. Do not relax those assertions to make
an older published release appear healthy.

See [smoke and server-health audit](smoke-health-audit.md) for the current evidence
and the distinction between liveness, readiness and a successful user journey.

## Operational recovery and release observation

The integration gate now also runs real-child-process shutdown and recovery
contracts with isolated PostgreSQL schemas. Readiness has fake-clock timeout,
late-client cleanup and waiter-coalescing tests, and is required in the
critical-source coverage inventory. Actual extension background runtimes are
recreated with persisted storage to verify notification cursor recovery without
claiming real Chrome/OS delivery.

Scheduled external smoke and explicit seven-day release observation commands are
documented in [the operations runbook](operations-runbook.md). A workflow file is
not evidence a scheduler is active; a recorded publication is not a completed
regression observation. Live Gmail evidence remains separately permission-gated.
