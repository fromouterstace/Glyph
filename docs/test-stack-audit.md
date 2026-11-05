# Test-stack adherence audit

> Initial audit snapshot. The four automated-evidence gaps identified here have
> since been addressed; see [gap closure and evidence](test-gap-closure.md) for
> the current implementation and the separate live-provider verification limit.

## Scope and conclusion

Compared the supplied meaningful-testing checklist with executable Node, React,
source-contract, PostgreSQL, HTTP, lint, coverage, build, and CI checks.

The stack substantially follows the checklist, but **does not yet fully conform**.
In particular, real-time extension waits, authenticated cross-owner API coverage,
and a complete Gmail browser/service journey remain gaps in automated evidence.
Passing tests do not establish a sub-1% regression rate.

The NQT-specific examples are illustrative, not instructions to replace Glyph's
UUIDs, opaque tokens, or email headers with QBR identifiers.

## Checklist results

| Guidance                          | Result                         | Evidence and limits                                                                                                                                                                                                                                                                               |
| --------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Test intent → business truth      | Substantial                    | Cases name observable rules: one event per GET, no events from HEAD, no inferred pixel loads, draft safety, provider-independent reply matching.                                                                                                                                                  |
| Arrange–Act–Assert and invariants | Substantial                    | Small fixtures plus PostgreSQL uniqueness, foreign keys, cascade deletion, reply idempotency, and state-preservation assertions. This is selected behavioral coverage, not every operation in the application.                                                                                    |
| Fast, autonomous, deterministic   | Partial                        | Pure unit logic uses fixed inputs/clocks. Database tests explicitly provision isolated schemas. Source-contract tests are separate from units, but extension tests still use real-time waits and observers.                                                                                       |
| Risk-weighted pyramid             | Partial                        | Unit, source-contract, mocked UI, database, and running-app HTTP layers exist. There is no automated complete Gmail browser journey.                                                                                                                                                              |
| Realistic, minimal data           | Substantial                    | Fixtures use the actual Drizzle schema, deterministic database IDs, email headers, tokens, and minimal message/link/event records. Only isolation-schema naming is random.                                                                                                                        |
| Properties and boundaries         | Substantial for selected risks | Origin idempotence/cross-environment ownership, complete Message-ID matching, proxy/scanner classification, duplicate loads, disabled tracking, missing runtime, and cooldown boundaries. Not a general property suite for every domain entity.                                                   |
| Contracts at boundaries           | Partial                        | Real PostgreSQL and tracking-router contracts; extension runtime/bridge contracts; anonymous HTTP boundaries. Authenticated owner-A/owner-B API access and the real connector adapter's failure mapping need additional integration coverage.                                                     |
| Observability is an assertion     | Substantial for tracking       | Database-backed route tests now use real Pino HTTP middleware and production serializers, requiring correlated success/failure logs and token redaction. This does not prove logging for every application operation.                                                                             |
| Permanent regression harness      | Substantial                    | Malformed GIF, extension context loss, origin mismatch, reply matching, form lifetime, and rate-limit cases remain executable. Build/coverage negative controls prove the gates can fail. “Test first for every future bug” remains a development practice, not a mechanically provable property. |
| Clear names and failure messages  | Substantial                    | Scenario names state rules; property failures identify their host fixture; gate failures identify missing enforcement. Generic assertion differences still supplement scenario names in older cases.                                                                                              |
| Test size                         | Enforced                       | Lint now caps unit, contract, integration, and end-to-end test functions at 50, 100, 150, and 200 lines respectively. A negative-control gate verifies each layer's classification and rejects the over-budget case.                                                                              |
| Single issue/item                 | Improved                       | The multi-purpose Add-glyph scenario was split into pixel/copy integrity, link rewriting, request payload, and native-Send safety cases. Multi-step cases remain only where the rule is a sequence, such as invalidation or confirmation.                                                         |

## Changes made during this audit

- Classified filesystem-reading extension/package checks as source contracts and
  subprocess/temp-directory checks as gate integration tests, not pure units.
  All remain mandatory in the main check.
- Kept pure origin policy checks in unit coverage; moved only the on-disk popup
  default assertion into a source-contract file.
- Added per-layer 50/100/150/200-line budgets, retaining explicit exemptions only
  for reusable setup and suite grouping.
- Split the broad compose case into focused assertions of separate behaviors.
- Replaced the tracking-route logger stub with real Pino middleware. The same
  request/response serializers are used in the application and integration tests.
  Added pure serializer privacy/correlation tests.
- Strengthened lint against option-based skips and chained test focus, with a
  negative control that executes the actual lint configuration.
- Grouped 32 deterministic host samples under two property tests. Sample count
  is not represented as 64 independent business scenarios.

## Remaining priorities

1. **Remove timing sensitivity from extension source contracts.** Replace fixed
   sleeps with a controlled browser clock and explicit observer/event completion.
   They are local and autonomous today, but can still be slow or flaky under load.
2. **Add authenticated cross-owner route contracts.** Test legitimate owner A
   reading/editing/deleting owner B's messages, links, activity, and settings.
   Existing anonymous-401 checks and origin isolation are not substitutes.
   This is a test gap, not a finding that cross-owner access currently succeeds.
3. **Exercise the connector adapter with injected provider failures.** Pure
   cooldown and header-scan tests do not by themselves prove the SDK/proxy boundary
   preserves status codes, retry headers, and partial results.
4. **Maintain a release-level Gmail journey.** Verify browser compose → Sent
   confirmation → recipient pixel request → PostgreSQL event → dashboard →
   standards-based reply. Local router success cannot prove Google's image proxy
   fetched a production pixel.
5. **Keep coverage claims bounded.** The threshold covers selected critical
   modules, not the entire application. Node coverage measures loaded sources;
   the current gate does not independently require an expected-source inventory.
   A passing percentage alone cannot prove a critical module was not omitted.

## Reproduction

Verified after the changes: lint, formatting, strict TypeScript, 74 unit cases,
38 source-contract cases, 15 UI cases, five gate negative controls, and 18 real
PostgreSQL integration cases passed. Both production bundles built successfully.
Selected-module coverage was 98.06% lines, 96.05% branches, and 100% functions.
These numbers are execution evidence, not a measured regression probability.

- `pnpm check`: lint, formatting, TypeScript, unit/source-contract/UI tests,
  critical-module coverage, and real lint/build/coverage negative controls.
- `pnpm check:integration`: real router and Pino middleware against an isolated
  PostgreSQL schema; no customer records are modified.
- `pnpm check:http`: safe anonymous contracts against the running local app.
- `PORT=3000 BASE_PATH=/ pnpm build`: mandatory fast checks and production bundles.

See [testing canon](testing-canon.md) for fixture isolation, CI setup, and the
release log used to measure actual regression outcomes over time.
