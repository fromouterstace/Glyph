# Readiness, restart recovery, monitoring and release observations

## Operational endpoints

- `/api/healthz`: public, no-store liveness JSON `{ "status": "ok" }`. No
  database query or Clerk login handshake. Keep the startup probe on this path.
- `/api/readyz`: public, no-store readiness JSON. It returns 200 with
  `{ "status": "ready" }` only after a PostgreSQL query parses the critical
  message/event/link tables. Failure or draining returns 503 with only
  `{ "status": "not_ready" }`; connection details and account data are excluded.
- The readiness query scans no rows. It has a one-second wall-clock deadline,
  a one-second query timeout, coalesced concurrent callers and a one-second
  result cache (including failures). A late client is destroyed instead of
  being returned to the pool with a timed-out query.
- Readiness does not establish every schema column, Gmail authorization,
  browser notification availability or a real recipient image fetch.
- `pnpm check:smoke [verified-HTTPS-origin]` requires readiness, page/asset/ZIP
  delivery, anonymous account-read rejection and invalid-token tracking behavior.
  It is safe for a public published app and never requests a real pixel token.

## Graceful shutdown and recovery

SIGTERM or SIGINT immediately marks readiness false and stops accepting new
connections. Accepted HTTP requests have up to ten seconds to drain before the
PostgreSQL pool closes and the process exits successfully. Repeated signals are
idempotent. Exceeding the total deadline force-closes HTTP connections and exits
nonzero, rather than pretending the shutdown was clean.

A shutdown is not a guarantee that every caller received an acknowledgement.
PostgreSQL transactions remain the authority. A persisted `sending` or `uncertain`
message is reconciled against Gmail Sent; never blindly retry the Gmail send API
after restart, timeout or ambiguous delivery.

`pnpm --filter @workspace/scripts test:process` starts real child Node processes
with the actual app/lifecycle code and separate `glyph_test_*` PostgreSQL schemas.
It verifies:

1. Missing critical schema fails readiness but not liveness.
2. SIGINT shuts down an idle API and pool cleanly.
3. SIGTERM waits for an actual pixel event INSERT blocked by a database lock;
   after unlock, the response completes and exactly one open event is committed.
4. A deadline interrupts a permanently blocked request, exits nonzero and does
   not manufacture an event.
5. A committed send claim survives SIGKILL and restart. Controlled confirmation
   records exactly one Sent event, not an inferred open.

These are isolated process/database contracts, not live Gmail-provider evidence.
The process suite is included in `check:integration`, hence `check:all`, the
release workflow and GitHub's existing PostgreSQL quality job.

The actual extension background source also has controlled-runtime restart
contracts: persisted seen-event IDs prevent duplicate reply alerts, temporary API
failure preserves the cursor, and first startup baselines historical events.
These tests do not prove a real browser's OS notification delivery. The current
extension requires a running browser and a signed-in connection tab; do not
claim browser-closed push delivery.

## Scheduled external monitoring

`.github/workflows/production-smoke.yml` is configured for minute 7, 22, 37 and 52
of every hour, plus manual dispatch. It uses only Node built-ins and anonymous
read-only HTTP. Each run retains timestamped evidence for 14 days. Failure opens
one marked GitHub issue; recovery comments on and closes that issue. The final
workflow status remains failed on an unhealthy probe, including a missing target.
GitHub issue/workflow subscribers receive notifications according to their own
settings; actual notification receipt has not been verified.

**Activation is not automatic in this workspace.** No GitHub repository remote
is configured. To activate:

1. Commit/push the workflow and scripts to the intended GitHub repository's
   default branch through the normal approved source-control flow.
2. Set repository **variable** `GLYPH_SMOKE_ORIGIN` to the current public HTTPS
   origin verified from deployment metadata. It is not a credential.
3. Enable Actions and scheduled workflows; permit the smoke job to write issues.
4. Manually dispatch once and inspect its artifact and incident status. Verify a
   controlled failed run and recovery, and subscribe an operator to the issue.
5. Observe an actual scheduled run before claiming continuous monitoring active.

Schedules may be delayed by GitHub and are not an uptime SLA. Do not use an
Autoscale process's own interval or a workspace background shell as proof of
external continuous monitoring. This setup does not change deployment privacy.

## Release-regression measurement

`docs/regression-release-log.csv` is the operational release ledger, not sample
activity or customer data. The CLI uses exclusive locking and atomic replacement.
It rejects duplicates, future publication times, missing evidence, early clean
observations and attempts to erase a confirmed regression.

Commands:

```sh
pnpm release:record RELEASE_ID ACTUAL_PUBLISHED_UTC_TIMESTAMP
pnpm release:observe RELEASE_ID path/to/sanitized-observation.json
pnpm release:regressions
```

Record only a verified successful publication, using publishing metadata rather
than a workspace build. Newly recorded releases start `unknown`, with a seven-day
window. Publication IDs are operational identifiers, not names or addresses.

An observation file must explicitly contain `regression_found` as `"true"` or
`"false"` and nonempty `detection` evidence. A confirmed regression also requires
`invariant`, `severity` and `regression_test` evidence. Do not include addresses,
message bodies, tokens, session cookies or full sensitive URLs.

A clean observation cannot be recorded until the window is complete. Mere
passage of seven days is not evidence: unobserved releases remain unknown and
are listed as missing observations rather than counted as successes.

The reported rate is completed, explicitly observed releases with a confirmed
regression divided by all completed, explicitly observed releases. No denominator
means `null`/unknown, not zero. A small measured zero is not proof of a <1%
regression risk. Monitor failures are not automatically classified as application
regressions without review.

## Browser and live Gmail evidence

The real-browser development test used a fresh controlled identity and the
supported programmatic Clerk session helper. It verified the anonymous `/emails`
wall, authenticated `/gmail` instructions, session preservation on reload,
authenticated navigation, sign-out and subsequent API 401. It did not automate
Google OAuth, access another user's data or claim a production session.

Live-provider acceptance still requires explicit permission and controlled
sender/recipient mailboxes:

1. Record the published release, UTC time and browser/extension version. Connect
   the extension only to the published origin, never the development URL.
2. Send one clearly identified tracked test message to the permitted test
   mailbox. Verify Sent reconciliation without resending.
3. In the real recipient mailbox, allow external images and open the message.
   Record the actual image-proxy response and the independently persisted pixel
   count; a click or reply does not substitute for a pixel load. Do not manually
   fetch the pixel as evidence of a recipient open.
4. Click the tracked link and reply normally. Record independent click/reply
   counts, source classification and matching message identity.
5. Restart the extension/browser with its saved state and restore the signed-in
   connection tab; then trigger one new test signal. Confirm the new alert
   arrives without replaying old alerts. Separately restart the API and repeat
   with a new signal to verify process-independent persistence.
6. Record only sanitized evidence: UTC timestamps, release/browser/provider
   names, expected/actual counts, HTTP outcome and pass/fail/blocked. Exclude
   addresses, mail content, tokens and session details.

Without controlled mailbox access, send permission and recipient actions,
the live Gmail/OS-notification acceptance remains **blocked**, not passed.

## Verification recorded for this workspace change

The full check and artifact-bundle pass completed with 308 passing automated
tests: 115 units/coverage controls, 49 extension/configuration contracts, 24 UI,
9 gate controls, 21 PostgreSQL tracking contracts, 60 service integrations,
5 process-level recovery cases and 25 running-app HTTP contracts. Local smoke
also passed, including `/api/readyz`. Both API and Glyph production bundles built.

A real publication completed at 2026-11-05T23:17:49.093Z according to deployment
history; it is registered as pending observation, not declared regression-free.
Subsequent production point probes returned health 200 and anonymous overview
401, but readiness 404. That published revision therefore does not establish
this workspace's new readiness/recovery features; publish and retest them before
activating a supposedly passing external monitor.
