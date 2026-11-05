# Glyph correctness and refactor audit

## Scope and approach

Reviewed the maintained API/tracking and Gmail lifecycle, PostgreSQL data
presentation, extension boundaries, frontend query/form/error paths, and workspace
lint/type/test/build configuration. The full baseline `pnpm check` passed; that
was not treated as proof that no runtime bugs existed. Generated clients, scaffold
files, and copied UI primitives were not rewritten merely to reduce file size.

No schema migration, production-data change, email send, permission expansion,
authentication-provider change, or automatic publishing is part of this audit.

## Correctness findings fixed

### Reconciled sends lost their Sent activity

The uncertain/sending web-send path verified Gmail Sent and updated the message,
but did not insert its Sent event. The message could therefore be sent while its
activity trail omitted that transition. A regression first reproduced the absent
event against isolated PostgreSQL.

All successful web sends, reconciled sends, and verified native sends now use one
transactional confirmation function. It owner-scopes the eligible transition and
creates the idempotent Sent event together. Tests verify no resend during
reconciliation, exactly one event on repeated requests, owner isolation, and
rollback of the message status when event insertion fails.

### A send could claim contents different from those rendered

The web sender read a draft and rendered its MIME, then claimed only by ID and
draft status. An edit committed between reading and claiming could make the
stored draft differ from the email being sent.

The claim now atomically compares the owner, delivery source, recipient fields,
subject, body, and tracking flags from the rendered snapshot. If anything changed,
the request must be reviewed again. Existing edit-status protection remains in
place. Real PostgreSQL tests cover each editable field, simultaneous claims with
one winner, foreign-owner claims, and mismatched link parents.

### Bad request bodies were reported as server failures

The general error handler converted malformed JSON and oversized JSON into HTTP
500 responses. Regressions first reproduced both behaviors against the running
application.

Known parser failures now return a safe HTTP 400 or 413 response. Their logs contain
the classified outcome rather than the parser error object or rejected body.
Unexpected errors still use the existing generic 500 boundary.

### Metadata-only link checks could consume Gmail read quota

The click handler already avoided counting HEAD as a click. However, a HEAD
request for a pending native message still invoked Gmail Sent reconciliation.
A focused test reproduced those upstream calls.

HEAD now returns link metadata without native reconciliation. Web and pending
native cases assert redirect metadata, no engagement event, and no Gmail calls.

## Redundancy and complexity improvements

- Centralized sent-state/event persistence instead of separate native, successful
  web, and reconciled-web implementations.
- Extracted pure message/event presentation from database access. Owner inboxes
  index messages and events once rather than searching all messages for each
  event and scanning all history for every message.
- Message detail now checks the target's owner before loading only that message's
  links/events. It no longer loads and serializes the account's complete inbox.
  Click totals use one indexed pass rather than a history scan per link.
- Kept existing lint complexity/nesting thresholds and zero-warning policy;
  did not raise limits or silence checks to make the audit pass.
- Added the pure presentation module to the mandatory coverage-source inventory
  and covered attribution, ordering, empty state, automation, and invalid parents.

The public success-response shapes, event meanings, mailbox eligibility checks,
and Gmail-native Send behavior remain unchanged.

## Verification

```sh
PORT=3000 BASE_PATH=/ pnpm build
pnpm check:integration
pnpm check:http
pnpm audit
git diff --check
```

The build gate includes lint, formatting, strict TypeScript, selected-source
coverage with its required-source inventory, extension source contracts, UI tests,
and gate negative controls. Database checks use isolated PostgreSQL schemas and
controlled external provider/identity boundaries. The HTTP gate targets the
normally running local application, not a customer pixel.

Final verification passed:

- 89 unit/inventory cases, 38 extension/source contracts, 15 UI cases, and 6
  negative-control gate checks.
- 18 PostgreSQL route/constraint cases and 35 owner, connector, lifecycle, and
  journey service cases.
- 20 HTTP cases against the restarted local server.
- 221 automated cases in total; zero lint warnings/errors, strict TypeScript and
  formatting passed, production bundles built, and dependency audit reported no
  known vulnerabilities.
- Selected critical-source coverage: 98.35% lines, 96.55% branches, 100% functions;
  every required source was present. This is not whole-application coverage.
- The activity preview rendered successfully with its expected signed-out,
  read-only state.

These checks do not establish a defect-free application or a sub-1% release
regression rate. Real Google image-proxy delivery, actual Gmail/Chrome lifecycle,
and production notification behavior remain separate controlled release checks.
No real emails were sent, and no production activity was fabricated.
