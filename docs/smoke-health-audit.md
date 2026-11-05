# Smoke testing and server-health audit

Audit date: 2026-11-05. Production telemetry window:
2026-11-04 23:02 through 2026-11-05 23:02 UTC; point-in-time HTTP probes followed.
This is a bounded audit, not proof of zero defects or continuous availability.

## Remediation update

Subsequent workspace work added public, bounded PostgreSQL/critical-schema
readiness at `/api/readyz`; graceful SIGTERM/SIGINT draining with a hard deadline;
real-child-process/database restart tests; background-worker restart contracts;
and scheduled external smoke plus release-observation tooling.

A real-browser development Clerk lifecycle passed sign-in, refresh, protected
navigation and sign-out. Programmatic Clerk session setup is not proof of Google
OAuth. No real Gmail send, image-proxy fetch or recipient reply was performed.
Scheduled monitoring is **configured but not active**: this workspace has no
GitHub remote or selected monitoring repository. One verified successful
publication from deployment history has been registered with a pending
seven-day window. The release metric remains **unknown**, because no completed
observations have been supplied.

The table below preserves the original findings, not the post-remediation status.
Use [the operations runbook](operations-runbook.md) for current controls,
activation prerequisites and the remaining live evidence.

## Current findings, in priority order

| Priority         | Finding                                                                           | Evidence and disposition                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ---------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| High release gap | Published account-read behavior differs from the authenticated workspace contract | Anonymous production overview, messages, activity, settings and connection GETs returned 200 JSON. Overview numeric fields were zero; messages/activity were empty arrays. This does not establish customer-data exposure, but violates the required 401 boundary. Local smoke requires and receives 401. The published release must not be called fully smoke-passing. Publish the tested workspace only through the normal user-approved flow, then rerun production smoke. |
| Medium           | Recurring production probe-path mismatch                                          | The read-only production investigation found 41 healthcheck log matches, including `healthcheck /api returned status 500`. Independent public GET `/api` returned 404 while `/api/healthz` returned 200. The internal 500's cause is not established. Workspace startup configuration already targets `/api/healthz`; do not add a misleading catch-all health response or infer the current production probe is fixed without a new publish and log evidence.                |
| Medium           | Liveness is not dependency readiness                                              | `/api/healthz` returns a static status and does not query PostgreSQL, validate schema, test Gmail authorization, or establish worker delivery. PostgreSQL answered a separate read-only `SELECT 1` in the workspace. A bounded database readiness check and isolated failure test remain future work; do not add external Gmail calls to a frequent liveness probe.                                                                                                           |
| Medium           | No complete automated real-browser/live-provider release smoke                    | Existing JSDOM/component and provider-adapter tests do not establish actual Chrome/Edge injection, Clerk sign-in/sign-out, real per-user mailbox authorization, Google image-proxy fetching, real replies or closed-app notifications. Controlled live-mailbox evidence remains required before claiming these work in production. No live email or real tracking pixel was requested in this audit.                                                                          |
| Medium           | Shutdown/recovery evidence incomplete                                             | API startup listens and logs but has no application-owned SIGTERM draining or pool shutdown sequence. Long requests, in-flight send reconciliation and notification work across restarts lack full process-level evidence. Do not promise zero-loss restart behavior from unit tests.                                                                                                                                                                                         |
| Medium           | Deployment builds do not require every integration/runtime gate                   | Artifact builds run the fast `check`; the configured release workflow runs `check:all` before bundles. Publishing is not proved to depend on a previously successful release workflow. GitHub CI has fast checks/builds and isolated PostgreSQL integration, but no configured-Clerk running-app or browser smoke. A successful build is not a completed release smoke.                                                                                                       |
| Low–medium       | Smoke asset scope is explicit but limited                                         | New smoke verifies ten page shells, directly referenced local JS/CSS, ZIP signature, five anonymous account reads and invalid tracking responses. It does not execute JS, inspect lazy/transitive imports, prove the auth wall is rendered, or validate the ZIP's complete contents/version in the browser. SPA route 200s alone are not authorization evidence.                                                                                                              |
| Low–medium       | Release observation evidence is missing                                           | The release regression CSV has a header but no observations. No measured regression rate, continuously running external smoke schedule or alert-routing proof was established.                                                                                                                                                                                                                                                                                                |

## Workspace health observed

- Managed API, Glyph Vite and component-preview services were running.
- Direct API `/api/healthz` and proxied `/api/healthz` returned 200:
  approximately 20 ms and 7 ms in initial local samples.
- Frontend `/` and component preview returned 200. Local smoke subsequently
  verified page/asset/download delivery and account-read rejection.
- Development PostgreSQL answered read-only `SELECT 1` in approximately 143 ms.
- Snapshot RSS: API approximately 162 MiB, Vite approximately 158 MiB.
  Workspace storage approximately 1.1 GiB used of 256 GiB. These are local
  snapshots, not production capacity guarantees.
- The old standalone HTTP workflow was failed with 502 responses while a later
  full release run passed all 24 HTTP checks. A startup race is plausible, not
  conclusively proven. After adding a bounded startup preflight, rerunning that
  workflow passed. Its assertions were not weakened.

## Production health investigation

The delegated read-only production investigation reported a public Autoscale
deployment with a successful serving revision. The serving revision predates
the failed publishing attempt; deployment success metadata does not mean the
latest workspace code is live.

- Available aggregate telemetry: 10,935 requests, 8 4xx, aggregate p95 latency
  765 ms; native-sync p95 approximately 2.145 s, p99 4.101 s.
- Average CPU 1.19%, memory 2.11%; p95 CPU 1.95%, memory 2.94%; latest instance
  count 1. These aggregates do not demonstrate absence of brief saturation.
- Visible endpoint metrics reported no 5xx. The aggregate 5xx query had no
  points, which is **not** a measured zero.
- No disk metric was available. Time-series queries failed and the prior
  comparison window had no telemetry, limiting trend/incident conclusions.
- Public `/`, `/api/healthz`, static assets and the extension download responded.
  Production smoke failed on the anonymous overview status rather than reporting
  a false green; it stops at its first failed assertion.

## Safeguards added during this audit

- `pnpm check:smoke [origin]`: anonymous read-only checks, remote HTTPS target
  validation, request timeouts, per-check status/latency and fail-closed exit.
- `check:all` now includes smoke after the HTTP contracts; release inherits it.
- A 15-second bounded health preflight before local HTTP contracts prevents an
  immediately-starting proxy from generating a misleading assertion cascade.
  Only startup health retries; actual assertions execute once.
- Fake-clock preflight tests, false-green asset/ZIP/API negative controls and a
  negative control that proves a failed smoke command fails the complete gate.
- An environment-boundary regression test guards the prior production-mode
  React test failure. Application bundles remain in production mode.

## Required release evidence still outstanding

1. Publish the tested workspace with user approval. Verify serving revision,
   startup probe path and absence of recurring internal probe errors.
2. Run production read-only smoke; all protected account reads must reject
   anonymous requests rather than return empty 200 responses.
3. Use controlled accounts to verify sign-in lands on Gmail instructions,
   refresh preserves a valid session, sign-out clears account state, and another
   user cannot read or mutate the first user's records.
4. With controlled mailboxes, perform one Gmail-native tracked send, reconcile
   Sent, allow the recipient's images, click and reply. Verify independent
   PostgreSQL-backed signals and correct source labels without inferring opens.
5. Verify extension update/context-loss recovery and notification/reply behavior
   across browser and API restarts. Record UTC release evidence, not tokens,
   addresses, message bodies or session secrets.
