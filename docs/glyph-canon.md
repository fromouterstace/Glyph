# Glyph product, engineering, and safety canon

This document records the product rules and guardrails future changes must
preserve. Read it before changing tracking behavior, Gmail access, ownership,
event storage, notifications, test policy, or production operations.

`replit.md` is the short, workspace-facing entry point. This canon governs durable
product and safety decisions; `docs/testing-canon.md` specifies the automated
test gates and evidence. Read code, the database schema, and OpenAPI before editing:
if they disagree with this document, do not guess which is current. Verify the
behavior, resolve the discrepancy, and update this canon, the relevant contract,
and tests together. Dated audit reports are historical evidence, not current
product policy.

## 1. Product intent and supported workflow

- The product is Glyph. A _glyph_ is the tracking pixel, not a contact identifier.
- The primary experience is the desktop Gmail browser extension. It augments
  Gmail's own rich-text compose. Gmail retains ownership of Send, keyboard
  shortcuts, and Undo Send. The web app is the connection, installation, settings,
  and reporting companion. The web composer is secondary.
- Only one `To` recipient is supported for a tracked compose. CC, BCC, multiple
  recipients, unsupported layouts, and plain-text mode must fail safely; do not
  silently guess the recipient or claim tracking was added.
- The sender mailbox is the one Gmail mailbox connected to this deployment. A
  different mailbox requires its own appropriately connected deployment. Gmail
  send-as aliases are not supported. A recipient can use any email service.
- The earlier Frevana / QBR / NaturalQuoteTracker identifiers belong to a
  different product. Do not add QBR strings, contact IDs, or NQT domain concepts
  to Glyph's message, owner, or event model.

## 2. Truthful tracking and status semantics

- A pixel signal means Glyph received an eligible pixel request and committed an
  event. It is **not** proof that a human opened or read a message, who fetched it,
  or how many distinct people saw it. Image proxies, caching, sender previews,
  forwarded mail, security scanners, and clients that block images affect results.
- Count pixel requests, not inferred opens. Each eligible request is an event;
  repeat loads are not silently collapsed into a unique-person count. A source may
  be labeled as an image proxy or suspected automation, but source classification
  is a request-metadata heuristic, not trustworthy identity verification.
- A tracked-link signal means Glyph received a redirect request. Link scanners,
  previews, forwarding, and automation can generate it; it does not prove a
  recipient intentionally clicked.
- Sent, pixel, click, reply, automated, held/uncertain, and failed are independent
  states/signals. Never infer a pixel open from a click, send, reply, or elapsed
  time. Never create or backfill opens to make the interface appear consistent.
- A prepared draft is not sent. A button click is not proof of send. Confirm a
  native Gmail send from its verified Sent copy and marker; reconcile uncertain
  sends by RFC Message-ID. Do not automatically retry a possibly accepted send.
- Commit a verified sent-state transition and its one Sent activity event in the
  same PostgreSQL transaction. Web sending must claim the exact draft contents
  used to render the message; concurrent edits or a second send must not send a
  stale snapshot or produce duplicate sends.
- Explain proxy, cache, scanner, and blocked-image caveats wherever signal counts
  could otherwise read as verified human behavior. Do not market these events as
  guaranteed read receipts.

## 3. Data ownership, privacy, and persistence

- PostgreSQL is the system of record for message/draft data, recipient and body
  stored for tracked messages, pixel and link tokens/destinations, send/open/click/
  reply events, event read state, and account preferences. The UI derives activity,
  summaries, and counts from those records. Do not fabricate, hardcode, cache as
  authoritative, or re-create sample messages or engagement in a response.
- Signed-out views are explicitly read-only and contain no fabricated account
  activity. Static UI copy, empty states, and documented first-use preference
  defaults are not activity data.
- Every authenticated message, link, event, settings read, mutation, notification,
  and sync result must be scoped to its authenticated owner. Derive ownership from
  the validated session on the server; never accept a client-supplied owner ID as
  authority. Test cross-owner denial and rightful-owner success against PostgreSQL.
- The connected Gmail connector is a shared server-side resource, not a per-user
  OAuth grant. Before reading mailbox messages, syncing, or sending through it,
  verify the signed-in Clerk user's verified email against the connected mailbox;
  verify the compose `From` mailbox too. The ownership check may retrieve the
  provider profile address to make the comparison; never disclose a mismatched
  mailbox or its message data. Do not let an arbitrary signed-in user send or
  inspect the connected mailbox. Dashboard records remain owner-scoped.
- Public tracking routes are intentionally unauthenticated so a recipient's mail
  client can fetch the pixel or redirect a tracked link. Accept only valid,
  high-entropy opaque tokens that resolve to the specific stored tracking record.
  Keep public responses narrow: no message bodies, recipient addresses, owner IDs,
  or other-account data.
- Do not persist raw client IP addresses or full user-agent strings. Store only
  the classification and event data needed for the signal. Keep request IDs for
  operational correlation, but do not log email addresses, body text, complete
  Gmail headers, pixel/link tokens, cookies, access tokens, or credential-bearing
  URLs. Sanitize paths before logging them.
- Browser-extension storage may hold its selected Glyph origin, non-secret
  preferences, poll cursor, and notification deduplication state. It must not hold
  Gmail passwords, OAuth/access tokens, Clerk session cookies, or API credentials.
  Use workspace-managed secret handling for server credentials.
- Deleting a message must continue to remove its dependent links and events through
  the database's foreign-key behavior. The repository does not define an automatic
  message-retention window or a data-export contract. Do not promise either—or
  claim a compliance certification—without a reviewed product decision and an
  implemented, tested contract.

## 4. Gmail extension, permissions, and content handling

- Keep the native Gmail interaction small and explicit: inspect the selected
  compose's recipient, subject, body, and links only as needed to prepare tracking
  after the user acts. Do not crawl the mailbox or read unrelated messages through
  the compose integration.
- The popup accepts a configurable HTTPS origin; that validation alone does not
  authenticate the host as Glyph. Connect only to the published Glyph origin shown
  by the trusted Glyph setup page. Never take a bridge origin from an email,
  message body, tracking destination, or untrusted API response. Changing how that
  origin is validated, approved, or used for bridge injection is a security
  boundary change and needs specific tests and review.
- Request optional host access only for the HTTPS Glyph origin the user selected.
  Do not request all-site access, broaden permissions, add a remote-code pathway,
  or expose a new extension message command without a documented need and review.
- Reuse the open, same-origin, signed-in Glyph tab as the session bridge. Browser
  cookies stay in the browser and credentials never move into extension storage.
  Keep the bridge and background messaging guarded against extension reloads,
  missing receivers, closed channels, and stale Gmail tabs.
- Never intercept Gmail's native Send or cancel it as a tracking recovery
  mechanism. When the extension context is lost, remove only Glyph-generated
  markup when safe and give a clear, draft-preserving manual recovery path. Do not
  silently replace user-edited links, body text, formatting, or recipients.
- Escape message content when constructing HTML. Validate tracked destinations
  as safe HTTP(S) URLs; reject credentials and unsafe/malformed destinations. Keep
  the original destination tied to its stored token and redirect only after
  recording the click event.
- Keep generated extension build output distinct from source. Updating the
  workspace does not update an already installed extension; communicate when a
  new package and Gmail-tab reload are actually required.

## 5. Gmail sync, replies, quotas, and notifications

- Verify sent messages against Gmail Sent. The current native confirmation scan is
  bounded to the newest 25 Sent messages in the previous 7 days; prepare a fresh
  token in the same published environment and sync promptly. A preview token
  cannot be repaired by pointing it at production after the email was sent.
- Reply matching is provider-independent: match the reply's actual sender against
  the original recipient and standard `In-Reply-To` / `References` identifiers.
  Do not rely on a Gmail thread ID or subject line, and do not restrict the
  recipient to Gmail.
- Inspect reply headers only. Do not download reply bodies or attachments or mark
  received messages read. Exclude automatic replies, sender follow-ups, and
  delivery reports. A bounce-reporting feature is not implemented; do not imply
  that a bounce is a tracked reply.
- The current reply scan is bounded to the newest 100 received messages within 30
  days. Surface a partial scan or provider failure as partial/unknown; never turn
  one into a confident “no replies” result. Preserve already matched replies when
  later pages fail.
- Mailbox-read capacity is shared through the connected Gmail account. Serialize
  reads, respect provider `Retry-After` and permission errors, make no uncontrolled
  retries, and keep send retries disabled. Cooldowns currently live in process
  memory; do not claim they survive an API process restart unless persistent
  storage and restart tests are added.
- Notifications reflect persisted eligible event types and the user's individual
  preferences. Browser alarms/notifications require a live browser context and
  signed-in connection tab; offline or throttled polling can delay alerts. Do not
  promise delivery while the browser is closed.

## 6. Environment, origin, and release safety

- Use a stable published HTTPS origin for new real sends, connection, redirects,
  pixels, and reporting. The extension connection, server-approved tracking URLs,
  and dashboard must refer to the same deployment origin.
- Never use a preview, local, temporary, or one deployment's origin for a message
  sent from another deployment. Do not repair an already sent message by editing
  its pixel host: its token and event live in the original environment's database.
- Keep development and production messages, connector state, and PostgreSQL data
  separate. Automated tests use isolated schemas/local routes and controlled
  provider mocks. They must refuse to run destructive fixture setup against
  production. Never seed, clean, backfill, or reset production records as a test.
- Do not send real email, request a customer's pixel, change production records or
  schemas, alter Clerk configuration, publish, or print a secret unless the user
  explicitly authorizes that specific action. A local HTTP/GIF success and a
  simulated connector response do not prove Google's live image proxy fetched the
  published pixel.
- Use a deliberate controlled sender/recipient release smoke check for real Gmail,
  a freshly published extension, and recipient-side pixel/click/reply behavior.
  Record release, UTC observation window, outcome, and regression evidence only;
  do not put addresses, body text, tokens, cookies, or credentials in the release
  log.
- “Less than 1% regression” is a measured release outcome, not a test-coverage
  threshold. Use `confirmed releases with a regression / observed releases` and
  a consistent observation window. Record results in the
  [regression release log](regression-release-log.csv). With insufficient
  evidence the rate is **unknown**, not zero.

## 7. Test guidance (adapted from the supplied checklist)

### Business truth and structure

1. State the business rule a test proves in its name or short description.
   Prefer user-visible outcomes and durable invariants over private implementation
   details.
2. Use Arrange–Act–Assert: minimal realistic arrangement, the operation under
   test, then its outcome and important invariants. A test normally has one act,
   one focused fixture, and one assertion cluster. A multi-step sequence is valid
   only when the business rule itself is sequential, such as compose → send
   confirmation → pixel → click → reply.
3. One test should have one reason to fail. More expectations are appropriate
   when they prove the same rule (for example, a reply is recorded once and does
   not fabricate an open). Split unrelated outcomes, second fixture concerns, or
   a second external mock into separate cases. More than three to five assertions
   with independent reasons to fail is another signal to split.
4. A bug fix starts with a focused failing regression case. Keep the test after
   fixing the bug. Snapshot only stable business semantics, not volatile
   implementation output.
5. Name the invariant and make failure messages point to what rule broke. Avoid
   generic names such as `works`.

### Size and I/O boundaries

- **Unit tests:** default choice for pure logic; at most **50 lines of test code**,
  excluding shared setup/fixtures; one act, no filesystem/database/network I/O;
  keep assertions to the outcome plus a small number of related invariants.
- **Integration tests:** one module plus its real contract boundary (PostgreSQL,
  HTTP, or provider adapter); **120–150 lines maximum per scenario**; use a
  purpose-built fixture instead of a kitchen sink.
- **End-to-end tests:** keep scenarios few and focused, **at most 200 lines per
  scenario**. Test the user-visible journey and one high-risk edge separately
  instead of making one mega-script.
- More than one separate issue, fixture focus, or assertion cluster is a signal
  to split. If a fixture needs more than three domain objects, reduce it, extract
  a named reusable builder, or split the scenario.
- Unit tests must not hide I/O or depend on environment, provider, current time,
  filesystem state, ordering, or random values. Use controlled clocks and fixed
  fixture data. Tests that intentionally execute real app code may retain the
  app's secure token-generation behavior but must assert relationships and public
  outcomes, never a particular random token.

### Coverage selection and test pyramid

- Use many fast unit tests, fewer real database/HTTP contract tests, and only a
  small number of full journeys. Prioritize owner isolation, send uncertainty,
  origin separation, data integrity, quota failures, and partial reply progress
  over a vanity percentage.
- Cover boundaries and properties of Glyph's actual contracts: valid/invalid
  origin forms, first/repeated/disabled pixel requests, one versus unsupported
  recipients, ownership mismatch, duplicate sync, schema constraints, and
  parseable standard email references.
- NQT-specific slab/bundle/DEN/QBR formats, deterministic production IDs, and
  thresholds do **not** apply to Glyph. Test opaque-token validity and isolation;
  never replace high-entropy production IDs/tokens with predictable IDs for
  convenience.
- Keep line/branch/function thresholds and the explicit critical-source
  inventory. If a critical source is renamed or added, update the inventory and
  prove a missing-source report still fails. Report selected-source coverage as
  selected-source coverage—not whole-app coverage.

### Contracts, observability, and safety

- Use real isolated PostgreSQL for database contracts. Check schema, uniqueness,
  foreign keys, cascades, transaction boundaries, owner predicates, and one stored
  event for one accepted state change. Test a trigger only if the product actually
  uses one. Do not replace database tests with an in-memory database fake.
- Test service/API shapes at their boundary. Stub a third party at its connector
  or transport edge, not the adapter or application code being verified. No
  automated test may send a real email or call production Gmail.
- Make critical signals observable: assert persisted outcome and event type,
  request correlation on failures, partial-scan status, and useful error
  reporting. Assert that logs omit PII and credentials; do not treat a successful
  response as proof a database event committed.
- Every fixture uses valid current Glyph schema and the smallest plausible slice.
  Keep identity, sent status, tracking flags, token ownership, and reference
  headers realistic. Test cleanup may drop only its uniquely named isolated
  schema.
- Run the narrow focused test while developing, then the complete matching gate
  once per coherent change. Never silently skip, quarantine, or weaken a flaky
  safety test to restore a green check.

## 8. Required review checklist

Before merging or publishing a behavior change, verify:

- Does the implementation preserve Gmail-native sending and the one-recipient,
  same-origin, verified-mailbox rules?
- Are all reads and writes owner-scoped, including error paths and nested links or
  events? Are public token routes deliberately narrow?
- Are event meanings accurate, persisted once, and independent—especially that
  a click/reply cannot create an open?
- Are permissions, stored fields, logs, URLs, and test fixtures limited to what
  the feature requires, without PII/secrets leakage?
- Do rate limits, uncertain sends, partial reply scans, extension reloads, and
  browser-closed limitations fail safely and truthfully?
- Are schema/API/extension/generated-client contracts and the relevant tests
  updated? Does the required-source inventory include any newly critical module?
- Did the applicable check, integration, HTTP, and build gates pass? Is any real
  provider behavior still an explicit, honestly documented release-smoke item?

## 9. Canon change control

Update this document when product behavior, data meaning, ownership, privacy,
connector permissions, supported environments, or release policy changes. Update
code, API/schema/extension contracts, tests, and user-facing caveats in the same
change. Preserve historical audit results as dated snapshots; do not copy old test
counts or deployment findings forward as present-day guarantees.
