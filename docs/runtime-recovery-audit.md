# Runtime recovery, complexity and redundancy audit

## Scope and evidence

Reviewed API startup/shutdown and pool readiness, extension startup/reinjection,
notification polling/recovery, current workflow/browser logs, and lint complexity
results across API, web and extension sources. Existing HTTP, process, database,
UI and extension regression suites provide the broader safety checks.

The observed workspace API and web services were running. Logs showed successful
requests and a Vite connection that reconnected, not an ongoing application
crash/respawn loop. This is a point-in-time development observation, not a claim
about historical production availability or every possible failure.

## Findings and fixes

### Overlapping extension polls could repeat work and notifications

An alarm and explicit sync could both read the same notification cursor before
either wrote its result. A controlled regression case reproduced two syncs.
Polling now shares one in-flight promise. Later polls can run normally after that
promise settles. No send operation is retried.

### Failure reporting could itself reject

If polling failed and the browser's badge API was also unavailable, the catch
handler rejected. A focused test reproduced the rejected sync response; the same
poll is invoked without awaiting by the alarm listener. Badge failure now produces
a fixed, non-sensitive warning instead of escaping the recovery path.

### A disconnected poll could restore stale notification state

Disconnect now invalidates the current connection generation. A poll that resumes
from a blocked provider response must not emit old alerts or restore the previous
mailbox cursor. A controlled-promise test verifies this boundary without sleeps.

### Idle PostgreSQL errors lacked a non-request handler

The shared pg pool had no `error` listener. Idle-client error events are emitted
outside request promises and can otherwise terminate Node through EventEmitter's
unhandled-error behavior. The API now classifies these errors without logging the
raw database error or connection details. pg removes the failed idle client;
subsequent acquisitions can establish fresh connections.

A child-process regression emits a synthetic idle-error event outside the
command's try/catch, then verifies the API remains alive and ready. This checks
the actual application's handler, not a test-only production endpoint. It does
not simulate every network partition; existing readiness timeout and shutdown
contracts remain in place.

## Complexity and redundancy

- Extracted the duplicated app-bridge registration into one helper.
- Reused connection cleanup for explicit disconnect and invalid stored state.
- Isolated notification preference/type selection from polling orchestration.
- Kept the existing maximum complexity of 20 and all test-size limits unchanged.
  A stricter diagnostic pass at 12 identified review candidates; a long UI
  component or function above that diagnostic threshold is not itself a defect.
- Left the working send-claim, auth/owner isolation, tracking semantics and
  rich-composer implementation intact rather than broadly rewriting risky paths
  without evidence of a problem.

## Verification and rollout

The regression cases use synthetic identities/events, isolated PostgreSQL schemas
and controlled browser-API boundaries. No customer email or engagement is created.
Verification completed: `pnpm check:all` passed (408 cases across unit, contract,
UI, negative-control, database/service, process and HTTP suites), including safe
smoke. Both production artifact bundles built. The managed API and web workflows
restarted successfully; readiness returned 200 and the signed-out `/gmail` preview
rendered the expected sign-in wall.

The production frontend build still reports its existing approximately 699 kB
main-chunk warning. This is a load-size improvement opportunity, not an observed
respawn failure. Browser logs included transient HMR failures during editing;
the fresh post-restart capture connected normally and had no runtime exception.

The extension package is v0.5.2. Publishing the app does not replace an installed
unpacked extension: download the updated package, replace its files, reload the
extension and reconnect. Browser invalidation during update/disable remains a
browser lifecycle limitation; never automatically reload an unsaved Gmail draft.

Live Chrome/OS notification delivery and genuine database network failover are
not established by these deterministic checks.
