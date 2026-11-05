# Glyph security audit — 2026-11-05

## Executive assessment

The reviewed workspace has meaningful authorization and data-integrity controls,
but is not free of security risks. Three automated scanners returned no findings.
Manual review reproduced an error-log confidentiality problem and identified a
high-impact extension-host trust weakness and several availability/hardening gaps.

This is a source, test, and local-development HTTP assessment, not a penetration
test of the deployed app or a certification. Severity below reflects potential
impact and prerequisites; it does not mean exploitation or compromise occurred.
No remediation or production changes were performed as part of this audit.

## Scope and methods

- Express middleware order, all application routes, public tracking paths, and
  the production Clerk proxy implementation.
- Clerk identity use, verified-mailbox checks, owner predicates, nested records,
  request origin validation, and session-related caches.
- Extension manifest, origin selection, background caller checks, cookie bridge,
  tracking URL checks, content handling, and notification behavior.
- React authentication cache invalidation, data rendering, link handling,
  server-side HTML/MIME generation, logging, validation, and database access.
- Dependency audit, SAST, and privacy/dataflow scans.
- `pnpm check:all`: lint, format, TypeScript, unit/source/UI/gate tests, isolated
  PostgreSQL/service contracts, and running local HTTP contracts.
- A synthetic Drizzle error passed through equivalent current Pino configuration.
  Only booleans indicating fixture leakage were printed, not real personal data.
- Local HEAD requests to the document and an invalid non-customer pixel token.

No real message was sent, no customer pixel was requested, no credentials were
read or printed, no production records/schema were changed, and nothing was
published. Isolated database fixtures were created and cleaned up by the suite.

## Scanner and test results

| Check                      | Result                                                   |
| -------------------------- | -------------------------------------------------------- |
| Dependency audit           | Completed: critical 0, high 0, moderate 0, low 0, info 0 |
| SAST                       | Completed, not marked incomplete: 0 findings             |
| Privacy/dataflow scan      | Completed: 0 findings                                    |
| Lint / format / TypeScript | Passed                                                   |
| Unit tests                 | 94 passed                                                |
| Extension/source contracts | 41 passed                                                |
| UI tests                   | 18 passed                                                |
| Gate negative controls     | 6 passed                                                 |
| PostgreSQL contracts       | 18 passed                                                |
| Service integration tests  | 38 passed                                                |
| Local HTTP contracts       | 20 passed                                                |
| Total                      | 235 passed                                               |

Selected critical-source coverage: 98.42% lines, 97.14% branches, 100% functions.
The required-source inventory passed. This is not whole-app security coverage.
Scanner success is not evidence that the manual findings below are absent.

## Findings

### SEC-01 — High: an approved extension host is not authenticated as Glyph

**Evidence:** `extensions/glyph-gmail/background.js`, `appOrigin`, `connect`,
`context`, and `bridge`; `popup.js`; manifest optional HTTPS host permissions.

HTTPS syntax, non-preview checks, and explicit optional permission approval do
not establish that an origin is a legitimate Glyph deployment. A user can approve
an attacker-controlled HTTPS origin. That origin can return a plausible
connection response and receive native preparation data, including recipient
roles, subject, message text, and links. The same-origin tracking response check
will accept URLs on that same malicious origin.

**Prerequisite:** the user must connect to and approve the hostile origin.
There is no demonstrated silent remote takeover of an already trusted origin,
and this does not imply that all optional HTTPS hosts are granted automatically.

**Remediation:** pin an independently trusted deployment identity/origin, or use
a reviewed enrollment mechanism for additional deployments. Do not let an
untrusted host self-attest by returning a Boolean or its own hostname. Reject
untrusted origins before permission registration or transmitting compose data.
Add tests for a convincing hostile host returning otherwise-valid responses.
The existing proposed extension-host hardening work already covers this scope.

### SEC-02 — Medium: raw error logging can disclose database parameters

**Evidence:** `artifacts/api-server/src/lib/logger.ts`; error handlers in
`app.ts`, `routes/glyph.ts`, and `routes/glyph-tracking.ts`.

The logger redacts selected request/response credential headers but callers log
raw `{ err }`. Drizzle query errors embed SQL and parameter values in their
message. Pino's error serialization includes that message/stack; field redaction
does not remove private strings embedded inside them.

**Reproduction:** a synthetic Drizzle insert error with fixture body/token
parameters logged through equivalent Pino redaction produced:

```json
{ "syntheticBodyLeaks": true, "syntheticTokenLeaks": true }
```

This confirms a reachable logging pattern, not that a particular real message or
credential has already leaked. Log access is required to read resulting data.

**Remediation:** serialize errors through a centralized safe classifier that
records request ID, allowlisted error codes/type, and operation/outcome, without
raw SQL, parameters, provider payloads, arbitrary causes, or private exception
messages. Test actual nested Drizzle/provider errors, not just successful request
path redaction. Review retention/access to existing logs without copying them
into an audit document.

### SEC-03 — Medium: public tokens permit unbounded event/resource consumption

**Evidence:** `routes/glyph-tracking.ts`, `lib/gmail-native.ts`, and `app.ts`.

Public tracking deliberately accepts unauthenticated requests. No application
request throttle or durable per-token abuse budget exists. An individual who
possesses a valid delivered token can repeatedly insert events. Native draft
requests can also initiate bounded Sent reconciliation. A five-second native
scan cache and in-flight deduplication reduce provider load, but are not an
application abuse limit and do not cap event writes.

**Impact:** inflated signals, PostgreSQL/storage/log growth, and resource or
shared-mailbox quota pressure. A token recipient can already share their token;
192-bit random tokens make blind discovery impractical.

**Remediation:** add explicit abuse controls and operational alerts, ideally
with shared/durable enforcement across processes. Preserve honest repeated-load
semantics: do not silently deduplicate legitimate requests or call a dropped
request a recorded load. Document degraded behavior and keep redirects useful.
Any edge protection in the published environment was not verified by this audit.

### SEC-04 — Medium, conditional: mailbox authorization can outlive reconnect

**Evidence:** `lib/gmail.ts`, `mailboxEmail` and `ownsMailbox`; sync candidate and
metadata caches in `gmail-native.ts` and `gmail-replies.ts`.

The profile cache lives for 60 seconds, and successful ownership decisions for
30 seconds. They are not bound to a connector revision or invalidated by an
observed reconnect. If the shared connector changes mailboxes in a running
process, an old verified user can temporarily retain mailbox authorization while
the underlying connector now refers to a different account. Layered cache timing
can extend the stale decision beyond either TTL in isolation. Other mailbox
caches also lack an explicit connector identity namespace.

**Prerequisite:** an actual connector account change/reconnect while the process
and caches remain alive. No cross-mailbox exploit was executed. Normal
cross-owner application data access remains guarded by owner predicates.

**Remediation:** bind every mailbox-dependent cache to a verified connector
account identity/revision, invalidate on reconnect, and recheck ownership against
that identity before mailbox operations. Add a deterministic A-to-B connector
change test, including pending operations and cached Sent/reply candidates.

### SEC-05 — Medium availability risk: account reads are not paginated

**Evidence:** `lib/glyph-data.ts` / `ownerData`, `routes/glyph.ts` / `dataFor`,
message list, overview, and activity handlers.

The app loads an owner's full message/event history before filtering or slicing
the response. For example, activity's 200-item limit is applied after loading and
presenting history. Large histories or repeated reads can consume excessive
database/network/Node resources; token-event amplification can worsen it.

**Remediation:** enforce database-level pagination, bounded queries and date
windows, SQL aggregation for summaries, and suitable indexed access paths.
Preserve owner predicates and accurate totals while changing API/UI contracts.
No load stress test or deployment-capacity measurement was performed.

### SEC-06 — Low / hardening: request-host trust and CSRF policy need tightening

**Evidence:** `routes/glyph.ts` shared mutation middleware;
`middlewares/clerkProxyMiddleware.ts`; Clerk middleware options in `app.ts`.

Mutation protection compares the Origin's host to either Host or the first
X-Forwarded-Host value. It does not compare full scheme-and-host origins against
an independently configured allowlist. Proxy host/protocol derivation likewise
trusts forwarded input; Clerk middleware does not explicitly set an application
authorized-party allowlist.

**Assessment:** no browser-reachable CSRF or Clerk signature bypass was
demonstrated. Browsers cannot freely set Host or X-Forwarded-Host, and edge header
normalization is decisive. A forged curl header is not, by itself, proof of CSRF.
Clerk signature validation still applies.

**Remediation:** define trusted public origins and proxy assumptions, normalize
protocol/host safely, reject ambiguous forwarded headers, and consider explicit
Clerk authorized-party restrictions with preview/custom-domain compatibility
tests. Verify actual edge behavior before assigning a higher severity.

### SEC-07 — Low / deployment verification gap: browser response policies

**Evidence:** `app.ts` and local document/pixel HEAD responses.

No app-wide CSP, frame-ancestor policy, Referrer-Policy, Permissions-Policy, or
HSTS is configured in reviewed source. Pixel responses set nosniff; link
responses set no-referrer. The local document response did not supply the broader
policies. The API exposes X-Powered-By: Express.

**Assessment:** this is not proof the published edge lacks protections. Missing
headers alone do not demonstrate XSS or clickjacking exploitation.

**Remediation:** check effective published headers and adopt a compatible policy.
Account for Clerk, required assets, and Replit preview embedding before enforcing
CSP/frame restrictions. Disable framework fingerprint headers. Apply HSTS only
with reviewed HTTPS/custom-domain behavior.

### SEC-08 — Low / hardening: Clerk proxy buffering has no explicit bound

**Evidence:** `middlewares/clerkProxyMiddleware.ts`, `proxyRes`.

Responses without Content-Length are buffered in an unlimited chunk array before
relay. There is no explicit application response-size cap or configured proxy
timeout. This upstream is fixed to Clerk, not a client-selected SSRF destination.

**Impact:** memory/availability pressure if an upstream response grows or stalls;
the prerequisite limits confidence and severity. No oversized upstream test was
run.

**Remediation:** add safe timeouts and a bounded response buffer, returning a
controlled 502 on overflow while preserving supported Clerk asset/stream
behavior. Test chunked error, overflow, abort, and bodyless paths.

### SEC-09 — Low: conflicting recipient rules in safety documentation

**Evidence:** `replit.md` Architecture decisions; `docs/glyph-canon.md` section 1
versus section 3.

Older one-recipient-only instructions remain alongside the implemented native
multi-recipient rule. This can lead a future change to restore the wrong behavior
or incorrectly assume per-recipient attribution.

**Remediation:** reconcile entry-point and canon instructions. Shared-body
tracking is aggregate. Recipient-specific attribution requires separately
personalized delivery, a product decision not made by this audit.

## Route and boundary inventory

Paths below are the application paths; `/api` is the Express API mount.

| Surface                             | Current boundary / audit outcome                                                                                |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `GET /api/healthz`                  | Deliberately public; narrow health response                                                                     |
| `GET /api/glyph/overview`           | Session-derived owner data; anonymous read-only empty totals                                                    |
| `GET /api/glyph/messages`           | Owner-scoped; anonymous empty list; query filtering validated                                                   |
| `GET /api/glyph/messages/:id`       | Owner lookup precedes link/event reads; foreign/anonymous 404                                                   |
| `POST /api/glyph/messages`          | Session + origin + verified mailbox; schema validation; server owner/IDs/tokens                                 |
| `PATCH /api/glyph/messages/:id`     | Same write guards; owner predicate and unsent-state restriction                                                 |
| `DELETE /api/glyph/messages/:id`    | Same guards; owner + web-draft state predicate; no sent-message deletion                                        |
| `POST /api/glyph/messages/:id/send` | Same guards; owner lookup; native drafts prohibited; atomic send claim and uncertain-send handling              |
| `GET /api/glyph/activity`           | Owner-scoped events; anonymous empty list                                                                       |
| `POST /api/glyph/activity/read`     | Write guards; event update limited to own message IDs                                                           |
| `GET /api/glyph/settings`           | Own preferences or documented anonymous defaults                                                                |
| `PATCH /api/glyph/settings`         | Write guards; server owner; validated production tracking origin                                                |
| `GET /api/glyph/connection`         | Verified mailbox comparison before address disclosure                                                           |
| `POST /api/glyph/native/prepare`    | Inherits shared write middleware; explicit session/From/schema/origin checks; owner-scoped compose key          |
| `POST /api/glyph/native/sync`       | Inherits shared write middleware; session owner passed to sync; shared-connector cache concern above            |
| `GET/HEAD /api/glyph/t/:token`      | Public opaque-token capability; narrow GIF; HEAD never records; no account data response                        |
| `GET/HEAD /api/glyph/l/:token`      | Public opaque-token capability; stored HTTP(S) destination; HEAD never records; no arbitrary URL query redirect |
| `/api/__clerk/*`                    | Production-only proxy to fixed Clerk host; no client-chosen upstream; forwarded-input/buffering concerns above  |
| Web routes and auth views           | UI routes are not authorization boundaries; API controls enforce data access                                    |
| Extension background                | Requires own extension ID and own popup or Gmail tab; no externally_connectable entry                           |
| Extension bridge                    | Same-extension sender + fixed action/path map; credentials stay in same-origin browser fetch                    |

Native routes currently inherit shared authorization through router mount order.
This is correct today but deserves an explicit invariant test before route
reorganization, rather than relying only on comments.

## Controls verified / no exploit found

- Application ownership is derived from Clerk, not caller body IDs; dedicated
  real-PostgreSQL tests cover foreign details, nested links/events, writes,
  sends, activity, preferences, and compose-key isolation.
- Running-app HTTP tests confirm the fixture identity header is not actual auth.
  The service harness replaces Clerk only in the isolated test environment.
- Mailbox authorization requires a verified Clerk email matching Gmail's profile;
  unauthorized connection responses do not disclose the mailbox address.
- Public tracking remains before Clerk intentionally, without making private
  write routes anonymous.
- Opaque pixel/link tokens use 24 cryptographically random bytes; malformed token
  formats are rejected/ignored without fabricated account data.
- Drizzle query builders and parameterized operations are used for app data;
  no user-controlled SQL execution, shell execution, or filesystem path sink was
  identified in the reviewed request paths.
- Native URL input permits only HTTP(S), rejects credentials, and bounds count/
  length. Redirects use the stored destination; they do not fetch it server-side.
  Redirects to external destinations are intended product behavior, not by
  themselves a demonstrated SSRF or auth bypass.
- Email body content is HTML-escaped; subjects are MIME-encoded; recipients are
  validated and newline-checked for the web composer. No reachable stored XSS
  was demonstrated. An unused/generic chart style helper's HTML insertion is not
  evidence of user-controlled script execution.
- Primary application data uses React rendering rather than raw body HTML.
  Authentication identity changes clear the React Query cache.
- Shared-message event/notification presentation excludes Bcc recipient arrays;
  private owner message detail intentionally includes them.
- Normal request logs remove query strings and redact canonical tracking paths.
  This does not cover the raw error problem in SEC-02.
- JSON request bodies are bounded to 100 KB and malformed/oversized JSON has
  controlled 400/413 responses.
- No new dependency vulnerability was reported by the dependency scanner.

## Residual risks and verification limits

- A delivered tracking token is a bearer capability. Forwarding, scanners,
  image proxies, or intentional replay can generate signals. This is not proof
  of recipient identity, and clicks/replies must not create inferred pixel loads.
- Reply sender/header matching is not independent cryptographic authentication
  of the remote sender. Spoofed email is a residual data-integrity risk; no live
  spoofing or Gmail spam/authentication behavior was tested.
- Bodies, addresses, tracking destinations, and tokens are intentionally stored
  in PostgreSQL. Field-level encryption, retention/export/deletion policy,
  backups, database privileges/network controls, and log-access configuration
  were not established by code review. Existing retention work remains relevant.
- The Clerk tenant is managed. Tenant session/MFA/provider settings and production
  cookie/edge behavior were not reviewed; no authentication configuration was
  changed.
- Integration authentication is deliberately stubbed at the provider boundary.
  These tests prove owner predicates and API behavior, not real JWT signature,
  expiry, issuer, audience, session revocation, or cross-deployment isolation.
- The live Gmail → recipient proxy → click → reply journey, installed-browser
  extension isolation, connector account switching, published security headers,
  and deployment-level abuse controls need separate controlled evidence.
- No infrastructure scan, credential-content scan, destructive fuzzing, DDoS
  test, or production penetration test was performed. Do not interpret this
  report as an exhaustive guarantee or a measured sub-1% regression rate.

## Recommended order of remediation

1. Stop raw error/parameter leakage and add adversarial logging tests.
2. Implement independently trusted extension-origin enrollment before compose
   data can be transmitted to a new origin.
3. Add abuse controls and bounded/paginated account queries without changing
   signal semantics.
4. Bind mailbox authorization and caches to the actual connector identity and
   test reconnect/revocation cases.
5. Harden proxy/origin handling, response limits, and deployment-compatible
   browser policies; reconcile contradictory safety documentation.
6. Perform a separately authorized, controlled production release smoke check.

Each behavior change needs its own focused regression evidence. Do not publish,
change production schema/data, send live email, request a customer's tracking
token, or alter authentication settings under the authority of this audit alone.
