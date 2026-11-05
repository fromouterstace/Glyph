# Test-gap closure and evidence

## What changed

### Controlled extension clocks

The source-contract suite runs the actual Gmail compose script in JSDOM with
fake browser Date, timeout, and interval implementations. Its existing `wait`
helper advances virtual time and flushes promise/MutationObserver jobs; it no
longer sleeps for a fixed amount of real time. Every fixture uninstalls its clock
and disposes the script/window. The background-script VM also has a fixed Date.

This preserves the race, recipient-change, reinjection, and draft-safety
scenarios rather than disabling them to make the suite pass.

### Authenticated owner isolation

The new service suite mounts the **production Express application**, its actual
routes, Zod contracts, mailbox-eligibility checks, and database queries against
isolated PostgreSQL schemas.

Only the external Clerk identity lookup and connected Gmail API are replaced.
Clerk's validated user identity is injected at that boundary; there is no
test-authentication middleware or header backdoor in the application.

Cases cover:

- Owner-scoped message lists, detail bodies, links, activity, and overview counts.
- The rightful owner's successful detail read as a positive control.
- Foreign-message edit, deletion, and send denial with unchanged database state.
- Mark-read behavior that updates own events but leaves foreign events unread.
- Settings reads and writes, including an attempted input owner-ID override.
- Owner-scoped native compose identity so another owner's key cannot be reused.

A separate HTTP negative control checks that the test identity header is ignored
by the normally running application and cannot authorize a write.

These are authorization contracts assuming a validated Clerk identity, not a
claim that Clerk sign-in itself has been browser-tested.

### Connector failures and the tracking journey

Tests replace the connector SDK's external `proxy` method, not `gmailRequest`.
They exercise the real adapter's Gmail path/method/response contract, queued 429
handling, numeric Retry-After deadlines, ordinary permission errors, malformed
and unavailable profiles, and transport errors. Failed/rate-limited sends are
never retried automatically.

The journey suite runs:

1. The actual compose and guarded-messaging scripts in a Gmail-shaped browser DOM.
2. A real HTTP native-prepare request and PostgreSQL draft/link creation.
3. A simulated provider Sent response verified by the production native scanner.
4. Public pixel and click HTTP requests through the production tracking handlers.
5. A standards-based reply from a non-Gmail-domain recipient through the actual
   reply scanner and connector adapter.
6. Fresh message-detail API reads and independent SQL assertions of the stored
   sent/open/click/reply events, including repeat-sync reply idempotency.

A second scenario injects a provider 429 after one matching reply. It requires
that reply to remain in PostgreSQL while the API reports partial, paused checks.
No click or reply is converted into an artificial pixel load.

### Missing-source coverage gate

The unit runner emits LCOV as well as enforcing its existing line, branch, and
function thresholds. Before returning success it compares the report's source
paths with an explicit critical-source inventory, including the separate frontend
and backend origin implementations.

Any omitted source fails the run regardless of the percentages reported for the
remaining files. Unit cases omit each required source in turn; a subprocess
negative control also proves the actual inventory CLI rejects a nominally
100%-covered report for unrelated code.

This is still selected critical-source coverage, not whole-application coverage.
Maintain the inventory when critical modules are added or moved.

## Reproduction and gates

- `pnpm check`: lint, formatting, TypeScript, units with required-source coverage,
  controlled-clock source contracts, UI cases, and gate negative controls.
- `pnpm check:integration`: existing PostgreSQL route contracts followed by the
  owner-isolation, connector-failure, and tracking-journey service suites.
- `pnpm check:http`: anonymous boundaries plus the test-identity-header negative
  control against the normally running local application.
- `PORT=3000 BASE_PATH=/ pnpm build`: mandatory fast gates and production bundles.

Existing database and GitHub CI gates include the new service suites through the
same integration command. Schemas are created/dropped only in test processes;
the harness refuses production mode and never seeds customer tables.

## Live production verification remains separate

The automated journey uses production **code**, a real database, real local
HTTP, and actual extension scripts, but controlled identity/provider responses.
It does not prove Google's live image proxy fetched a published pixel, a real
recipient read a message, or the deployed extension is the current workspace build.

For a live release smoke check, use a controlled sender/recipient pair:

1. Publish the tested build and use its published connection origin throughout.
2. Connect the current extension and compose one identifiable tracked test email.
3. Confirm Sent reconciliation, then open the delivered email in the recipient
   mailbox with external images allowed; click the link and reply normally.
4. Verify the recipient's proxied image response and the published dashboard's
   independently recorded pixel, click, and reply signals. A cached/proxied image
   request is not a verified human-read receipt.
5. Record the release, UTC time, provider, observed counts, and pass/fail outcome
   in the release log. Do not save tokens, session cookies, addresses, or mail bodies.

Do not manually request a real customer's pixel to “prove” an open, backfill opens
from replies/clicks, reset production data, or treat mocked responses as live
Google evidence. No live emails were sent by these automated tests.
