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

The optional rich web composer, private attachments, delivery limits and its
regression checks are specified in [web-composer.md](web-composer.md).

## 1. Product intent and supported workflow

- The product is Glyph. A _glyph_ is the tracking pixel, not a contact identifier.
- The primary experience is the desktop Gmail browser extension. It augments
  Gmail's own rich-text compose. Gmail retains ownership of Send, keyboard
  shortcuts, and Undo Send. The web app is the connection, installation, settings,
  and reporting companion. The web composer is secondary.
- The Gmail extension supports up to 100 unique recipients across To, Cc, and
  Bcc in one rich-text compose; duplicates and unsupported layouts fail safely.
  That shared message has one pixel and shared tracked links, so its signals are
  aggregate and cannot identify which recipient acted.
- The secondary web composer also supports up to 100 unique To, Cc and Bcc
  recipients, with explicit role lists in drafts and send confirmation. Shared
  tracking remains aggregate; Bcc must never be promoted into To or Cc headers.
  A single intended recipient still does not make a pixel or click a verified
  human action. Plain-text Gmail mode cannot carry a tracking pixel.
- Each Glyph user can authorize one personal Gmail mailbox matching a verified
  email on their Glyph account. Mailbox switching and send-as aliases are not
  supported. A recipient can use any email service. Preserve the original
  shared connector only for its verified owner until personal OAuth migration.
- Require Clerk sign-in for `/app`, `/email` (and `/emails`), `/activity`,
  `/settings`, and `/gmail`, with account-data APIs independently enforcing
  authentication and owner scope. After sign-in or sign-up, send users to the
  Gmail instructions at `/gmail`. Keep `/` as a public, static landing page.
- The earlier Frevana / QBR / NaturalQuoteTracker identifiers belong to a
  different product. Do not add QBR strings, contact IDs, or NQT domain concepts
  to Glyph's message, owner, or event model.

## 2. Truthful tracking and status semantics

- A pixel signal means Glyph received an eligible pixel request and committed an
  event. It is **not** proof that a human opened or read a message, who fetched it,
  or how many distinct people saw it. Image proxies, caching, sender previews,
  forwarded mail, security scanners, and clients that block images affect results.
- Count pixel requests, not inferred opens. Each eligible request admitted by the
  persisted safety budget is a separate event; repeat loads are not silently
  collapsed into a unique-person count. A source may be labeled as an image proxy
  or suspected automation, but source classification is a request-metadata
  heuristic, not trustworthy identity verification.
- A tracked-link signal means Glyph received a redirect request. Link scanners,
  previews, forwarding, and automation can generate it; it does not prove a
  recipient intentionally clicked.
- Enforce message-scoped PostgreSQL budgets across API instances: pixel loads
  120 per 60-second window and 2,000 per UTC day; clicks 300 per 60-second window
  and 5,000 per UTC day; Gmail Sent reconciliation one request per 5-second
  window and 50 per tracked message per UTC day. A rate-limited pixel still
  returns the transparent image and a rate-limited link still redirects, but no
  extra activity event is recorded and no extra Sent scan is triggered. High
  volume bursts can therefore be undercounted; never label them as recorded.
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
- Sign-in is required before private dashboard pages or account-data APIs are
  viewed. Associate messages, links, events/activity, settings, and Gmail sync
  state with the authenticated Clerk user ID. Derive ownership from the validated
  session on the server; never accept a client-supplied owner ID as authority.
  Test cross-owner denial and rightful-owner success against PostgreSQL.
- The public landing page may contain static copy only, not account activity or
  another user's data. Static UI copy and documented first-use preference
  defaults are not activity data.
- Persist native recipient roles privately and verify them against the sender's
  Sent copy. Match replies from every original participant; never disclose Bcc
  addresses in public tracking URLs or notification/activity payloads.
- Personal Gmail grants belong to the server-authenticated Clerk user. Store
  refresh/access tokens only as authenticated ciphertext in PostgreSQL, never
  in browser/extension storage or logs. Bind OAuth state to the owner, session,
  canonical origin, expiry and PKCE verifier; make callback claiming single-use.
  Disconnect and a newer authorization attempt must invalidate in-flight older
  callbacks. Verify the Google profile and matching verified Clerk email before
  saving a grant. Pin each owner's mailbox binding across reconnect/disconnect.
- The old project Gmail connector is a shared server resource, not per-user
  OAuth. Retain its exact verified-owner checks during migration. Once a
  personal connection row exists, revoked or disconnected personal access must
  never fall back to this shared connector. Verify Gmail compose `From` against
  the signed-in owner's selected connection. Never accept client owner IDs.
- Treat a mailbox reconnect or account switch as an authorization boundary.
  Revalidate the current Gmail connector identity and provider profile before
  sensitive mailbox work; fail closed if either is unknown or changes during
  verification. Scope authorization, Sent-candidate, and reply-metadata caches
  to both the connector identity and mailbox identity. Never log or persist the
  mailbox identity as operational diagnostic data, and never reuse cached
  authorization or message metadata across identities.
- Public tracking routes are intentionally unauthenticated so a recipient's mail
  client can fetch the pixel or redirect a tracked link. Accept only valid,
  high-entropy opaque tokens that resolve to the specific stored tracking record.
  Keep public responses narrow: no message bodies, recipient addresses, owner IDs,
  or other-account data.
- The health check, sign-in/sign-up, and Clerk frontend API proxy are public
  protocol or availability surfaces; keep their responses limited to their
  purpose. All other account-data reads and writes require a signed-in session.
- The System navigation item is only a visibility hint. The server must authorize
  every system-data request against a verified Clerk email in the server-side
  `GLYPH_ADMIN_EMAILS` allowlist; never trust client-side email checks or accept a
  client-supplied role. Keep system metrics aggregate-only and do not expose
  message bodies, recipient lists, IP addresses, or full user-agent strings.
- System login metrics count unique Clerk sessions observed by Glyph after a
  signed-in account opens the app. They are not a complete count of Clerk sign-ins
  and must be labeled accordingly. Persist deduplicated session observations and
  authenticated denied-admin attempts in PostgreSQL; store only a one-way
  session fingerprint for deduplication.
- Do not persist raw client IP addresses or full user-agent strings. Store only
  the classification and event data needed for the signal. Keep request IDs for
  operational correlation, but do not log email addresses, body text, complete
  Gmail headers, pixel/link tokens, cookies, access tokens, or credential-bearing
  URLs. Sanitize paths before logging them. Never serialize raw exception
  messages, stacks, SQL, parameters, provider responses, or nested causes; log
  only fixed error classifications and safe operation context.
- Browser-extension storage may hold its selected Glyph origin, non-secret
  preferences, poll cursor, and notification deduplication state. It must not hold
  Gmail passwords, OAuth/access tokens, Clerk session cookies, or API credentials.
  Use workspace-managed secret handling for server credentials.
- Deleting a message must continue to remove its dependent links and events through
  the database's foreign-key behavior. The repository does not define an automatic
  message-retention window or a data-export contract. Do not promise either—or
  claim a compliance certification—without a reviewed product decision and an
  implemented, tested contract.
- **Casing across boundaries:** PostgreSQL table/column identifiers use
  `snake_case`. Drizzle's TypeScript property names, server-side TypeScript,
  OpenAPI JSON property names, and frontend API models use `camelCase`. Drizzle
  maps the storage spelling to the TypeScript property; do not snake-case JSON
  payload keys or leak physical database column names into UI code. External
  provider payloads keep the provider's own documented field names. Enum values,
  SQL expressions, CSS/data attributes, and machine-readable identifiers are not
  property names and may legitimately use underscores. Test schema mappings and
  API property casing when changing these contracts.

## 4. Gmail extension, permissions, and content handling

- Keep the native Gmail interaction small and explicit: inspect the selected
  compose's recipient, subject, body, and links only as needed to prepare tracking
  after the user acts. Do not crawl the mailbox or read unrelated messages through
  the compose integration.
- The extension trusts only the exact published origin
  `https://glyph.rocks`; its endpoint cannot enroll itself or claim a
  different trusted identity. Do not accept user-entered, preview, custom, or
  suffix-matched hosts. Never take a bridge origin from an email, message body,
  tracking destination, or untrusted API response. Changing this allowlist is a
  security-boundary change requiring review, an extension version update, exact
  manifest permission changes, and regression tests.
- Request optional host access only for the exact published Glyph origin. Keep
  the popup policy, background origin check, and manifest host permission aligned.
  Do not request all-site access, broaden permissions, add a remote-code
  pathway, or expose a new extension message command without a documented need
  and review. On update or browser startup, unregister stale dynamic bridges,
  revoke untrusted optional host permissions, and clear their connection and
  notification state before any bridge can send compose data.
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
- Mailbox-read capacity is shared within each connected Gmail account. Serialize
  reads, respect provider `Retry-After` and permission errors, make no uncontrolled
  retries, and keep send retries disabled. Cooldowns currently live in process
  memory; do not claim they survive an API process restart unless persistent
  storage and restart tests are added.
- Notifications reflect persisted eligible event types and the user's individual
  preferences. Browser alarms/notifications require a live browser context and
  signed-in connection tab; offline or throttled polling can delay alerts. Do not
  promise delivery while the browser is closed.

## 6. Environment, origin, and release safety

- `https://glyph.rocks` is the canonical production origin, chosen for
  deterministic setup and operations. New user-facing setup links, extension
  connections, and tracking workflows use it. Treat `glyph-mail.replit.app` as a
  compatibility alias, not an interchangeable primary. Preserve existing token
  URLs and alias response protections; do not rewrite already-sent emails or
  silently migrate sessions/OAuth callbacks between origins.
- The published smoke primary must be `https://glyph.rocks`; the app constant,
  extension permission policy and smoke primary must agree in a contract test.
  Alias compatibility checks remain required, not a second canonical workflow.
- Use a stable published HTTPS origin for new real sends, connection, redirects,
  pixels, and reporting. The extension connection, server-approved tracking URLs,
  and dashboard must refer to the same deployment origin.
- Do not enable blanket Express proxy trust. Resolve the public request origin
  from one validated forwarded host/protocol value, or the direct Host header
  when no forwarded host exists. Reject comma-separated or duplicate forwarded
  values for browser writes and Clerk proxy requests. Require the browser Origin
  to exactly equal the normalized request origin; do not use the first value in
  an ambiguous header list.
- Production browser writes and Clerk proxy requests allow the verified
  `glyph-mail.replit.app` and `glyph.rocks` hosts. Any additional custom domain
  must be explicitly allowlisted. Regression tests must cover direct and
  forwarded origins on every allowed host, preserve that host in Clerk's proxy
  URL, and reject HTTP, lookalike hosts, and ambiguous forwarding. After publishing,
  verify Clerk assets and sign-in on each production domain; preview alone
  cannot validate the production-only proxy.
- Keep Clerk proxy responses bounded: stream responses with known lengths,
  buffer chunked responses only up to the configured cap, and return controlled
  timeout/overflow/upstream-failure responses. Preserve bodyless HEAD/204/304
  behavior and verify actual published Clerk assets before changing those limits.
- Production HTML must be delivered by the header-capable web service, not
  headerless static hosting. API headers, `.replit` configuration, and HTML meta
  tags are not evidence of document protection. Preserve the production GET/HEAD
  HTTP build gate and the contract guard against reverting to static serving.
- Browser security guardrails: require the unambiguous CSP
  `frame-ancestors 'none'; object-src 'none'; base-uri 'self'`, `X-Frame-Options:
  DENY`, MIME sniffing protection, strict-origin referrer policy, disabled
  camera/microphone/geolocation, and no-store documents. Duplicate critical CSP
  directives must fail verification. Hashed assets may retain immutable caching.
- Release safetyrails: run read-only `pnpm check:published` against both verified
  HTTPS origins. Every app document must pass GET and HEAD policies; public
  responses must retain at least one year of edge HSTS. An unhealthy primary must
  not skip the alias, and either failure must fail the overall result. Retain
  per-origin timestamped evidence; never mark the gap closed from workspace
  checks or a successful publishing status alone.
- Keep Vite Preview separate from the production framing ban. Preserve `/api`
  routing, public token endpoints, deep links, missing-asset errors, and extension
  ZIP delivery. Do not add a restrictive script CSP or Clerk authorized-party
  rule until supported preview and production/custom-domain browser flows have
  been verified. This minimal CSP is not comprehensive XSS protection.
- See [HTML header delivery](html-security-header-delivery.md) for the serving
  decision and release evidence boundary; [testing canon](testing-canon.md) defines
  the enforced tests and external smoke configuration.
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

- **Unit tests:** default choice for pure logic; at most **50 lines per test
  function**; one act, no filesystem/database/network I/O; keep assertions to the
  outcome plus a small number of related invariants.
- **Contract tests:** at most **100 lines per test function** for one module,
  adapter, or source/runtime contract.
- **Integration tests:** one behavior across a real boundary (PostgreSQL, HTTP,
  or provider adapter); at most **150 lines per test function**; use a
  purpose-built fixture instead of a kitchen sink.
- **End-to-end tests:** keep scenarios few and focused, at most **200 lines per
  test function**. Test the user-visible journey and one high-risk edge
  separately instead of making one mega-script.
- Lint enforces these four size budgets. Reusable fixture helpers should be
  extracted; any longer helper exception must state why inline.
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

- Does the implementation preserve Gmail-native sending and the
  same-origin, verified-mailbox rules? Do shared To/Cc/Bcc messages preserve roles,
  keep Bcc private, and report aggregate signals without claiming recipient identity?
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
