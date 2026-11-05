# Glyph security remediation roadmap

**Status:** Proposed  
**Basis:** Manual security audit dated 2026-11-05  
**Audience assumption:** The person implementing the work and anyone reviewing
security priorities.  
**Planning assumption:** Work is sequenced by risk and dependency, not calendar
date. No team capacity, deadline, or rollout window has been estimated.

## Goal

Reduce the confirmed confidentiality risk and the extension trust-boundary risk
first, then limit abuse and unbounded resource consumption, and finally close
deployment-hardening gaps. Preserve the existing product rules while doing so:

- Gmail remains responsible for native Send.
- Private message access stays authenticated, mailbox-verified, and owner-scoped.
- Public pixel and redirect endpoints remain usable by recipient email clients.
- Signal events remain truthful; abuse controls must not silently fabricate,
  deduplicate, or mislabel pixel loads.
- Bcc identities stay private in public activity and notifications.
- Do not send real test mail, use customer tokens, or change production data as
  part of routine tests.

## Priority sequence

| Order | Workstream                                        | Audit issue                                                        | Priority                 |
| ----- | ------------------------------------------------- | ------------------------------------------------------------------ | ------------------------ |
| 1     | Safe error reporting                              | SEC-02: SQL parameters and private values in error logs            | Immediate                |
| 2     | Trusted extension-origin enrollment               | SEC-01: compose data can be sent to a user-approved hostile origin | Immediate                |
| 3     | Public tracking abuse controls                    | SEC-03: valid tokens can generate unbounded events and work        | High                     |
| 4     | Bounded, owner-scoped data access                 | SEC-05: full histories loaded before limits and filtering          | High                     |
| 5     | Connector identity and cache isolation            | SEC-04: stale mailbox authorization after reconnect                | High                     |
| 6     | Proxy, origin, and browser hardening              | SEC-06, SEC-07, SEC-08                                             | After behavior contracts |
| 7     | Documentation reconciliation and release evidence | SEC-09 and deployment verification gaps                            | Before release sign-off  |

Orders 3–5 can proceed in parallel after their API/data contracts are agreed.
Workstream 6 depends on documenting the real preview, published-domain, and
proxy behavior so hardening does not break legitimate Clerk or extension flows.
Release verification follows all changed workstreams.

## Workstreams and completion criteria

### 1. Stop logging sensitive exception contents

**Risk addressed:** SEC-02, reproduced with synthetic values.

**Implementation**

- Introduce a centralized safe error serializer for API and provider failures.
- Log a request ID, operation, status/classification, and allowlisted error
  identifiers only. Do not serialize raw exception messages, stacks, SQL,
  parameter arrays, provider responses, or arbitrary `cause` values.
- Preserve useful failure diagnosis through safe error classes and controlled
  codes, not private message content.
- Apply the serializer consistently to route handlers, middleware, tracking
  failures, native sync, proxy failures, and startup errors where relevant.

**Acceptance criteria**

- Synthetic errors containing message bodies, email addresses, SQL parameters,
  tracking tokens, cookies, and provider payloads produce no matching substrings
  in captured logs, including nested causes.
- Request correlation and safe error categories remain available.
- A test exercises the actual Drizzle error serialization path, not only a
  standalone redaction helper.
- Failure still returns a controlled response and does not change email-send
  retry behavior.

**Release gate:** logging regression tests and the full quality suite pass.
Review access and retention of historical logs separately; do not copy any
historical sensitive data into test fixtures or this roadmap.

### 2. Establish trust before the extension shares compose data

**Risk addressed:** SEC-01.

**Implementation**

- Decide how the extension recognizes an approved Glyph deployment independently
  of the endpoint's own claims.
- Bind the trusted deployment identity to the permission-grant and connection
  flow. Reject unrecognized origins before injecting the bridge or transmitting
  compose content.
- Keep preview blocking, least-privilege optional host access, exact-origin
  response validation, and extension reload recovery.
- Define how legitimate future custom domains or deployment changes are reviewed
  and enrolled; do not substitute a permissive hostname suffix rule.

**Acceptance criteria**

- A hostile HTTPS host cannot convince the extension to send it recipients,
  subject, body, or tracked URLs merely by returning a successful connection
  response and same-origin tracking URLs.
- A legitimate configured published Glyph origin can connect and prepare
  tracking.
- Preview and lookalike domains are rejected before permission expansion,
  bridge registration, or compose-data transmission.
- Changing an origin requires the intended explicit trusted enrollment and
  clears origin-scoped notification/sync state as appropriate.
- Tests cover hostname lookalikes, user-info, ports, paths, redirects, malformed
  URLs, spoofed connection responses, and stale stored origins.

**Release gate:** review the origin trust model and browser permission diff
before packaging. Update the installed extension version and provide an explicit
user-facing upgrade/reconnect path; publishing the web app alone does not update
an installed extension.

### 3. Add abuse controls without falsifying engagement

**Risk addressed:** SEC-03.

**Implementation**

- Set a documented budget for tracking requests and expensive native Sent
  reconciliation, considering multiple API processes and shared Gmail quotas.
- Prefer shared/durable enforcement at an appropriate boundary; process-local
  counters alone are not a reliable global limit.
- Bound concurrent database/provider work and add operational metrics for
  rejected, delayed, or degraded requests without logging tokens or recipient
  identifiers.
- Keep the pixel response useful to email clients and tracked-link redirects
  functional when possible. State clearly what a throttled request means.

**Acceptance criteria**

- Repeated requests with one valid test token cannot cause unbounded database
  event writes or unbounded provider calls.
- Distinct eligible requests that are accepted remain distinct persisted events.
- Rejected or dropped requests are not represented as recorded loads.
- Clicks and replies never create opens; scanner classification does not become
  recipient identity.
- Controls behave consistently across concurrent requests and, where applicable,
  multiple service instances.
- Tests cover thresholds, retry/backoff behavior, recovery, and honest event
  counts without making requests to production or customer tokens.

**Release gate:** load test the bounded behavior in an isolated environment and
verify the real published edge's limits separately.

### 4. Bound history queries and summary computation

**Risk addressed:** SEC-05; limits the impact of event amplification.

**Implementation**

- Move pagination, status/search filters, time bounds, and result caps into
  database queries.
- Use database aggregation for overview counts and chart windows rather than
  loading complete histories into application memory.
- Preserve owner predicates in every count, join, and page query.
- Introduce indexes only after reviewing query plans and migration impact.
- Update the API/UI contract to make pagination and partial-history semantics
  explicit.

**Acceptance criteria**

- List/activity endpoints have stable bounded page sizes and deterministic
  cursors or ordering.
- Summary totals remain correct without reading all historical event rows into
  application memory.
- Cross-owner tests prove pagination, counts, filters, and cursors never expose
  another owner's records.
- Query-plan or test evidence confirms database-side limits and relevant indexes.
- UI clearly distinguishes a page/window from an all-time total.

**Release gate:** run PostgreSQL contract tests, realistic-volume query checks,
and UI pagination tests. Any schema migration must be additive, reviewed, and
separately authorized for production.

### 5. Bind authorization and sync caches to the active mailbox

**Risk addressed:** SEC-04, conditional on connector account change.

**Implementation**

- Define a stable, non-secret connector identity or revision that can distinguish
  mailbox changes.
- Scope profile, authorization, Sent-candidate, and reply-metadata caches to that
  identity; invalidate them when the connector changes.
- Recheck the currently connected mailbox identity before sensitive mailbox
  operations when cache identity cannot be trusted.
- Fail closed on identity mismatch or connector uncertainty; do not disclose
  mailbox addresses or continue sync using stale identity.

**Acceptance criteria**

- A deterministic test switches the mocked connector from mailbox A to mailbox B
  while caches are warm.
- User A cannot read, sync, or act on mailbox B after the identity change; user B
  is not granted access based on A's cached decision.
- Cached Sent/reply candidates cannot cross mailbox identities.
- Provider failure or unknown identity is reported as unavailable/partial, not
  as authorized success or a confident no-reply result.
- Existing single-mailbox operation and mailbox-read budgets remain intact.

**Release gate:** controlled reconnect test, auth/owner regression suite, and a
clear reconnect recovery path.

### 6. Harden proxy, origin, and browser boundaries

**Risk addressed:** SEC-06, SEC-07, SEC-08. These are hardening items; the audit
did not reproduce a CSRF or Clerk authentication bypass.

**Implementation**

- Document trusted proxy behavior and public origins; validate full normalized
  origins against explicit trusted values for browser writes.
- Reject ambiguous forwarded host/protocol values and test how the actual Replit
  edge supplies them.
- Consider explicit Clerk authorized-party restrictions only after confirming
  preview and published/custom-domain behavior.
- Bound Clerk proxy buffering, add timeouts, and return controlled errors on
  overflow or upstream abort.
- Inspect effective published response headers. Add compatible CSP,
  frame-ancestor, Referrer-Policy, Permissions-Policy, and HSTS only where
  deployment requirements are understood. Disable unnecessary Express
  fingerprint headers.

**Acceptance criteria**

- Legitimate development/preview and published authentication flows continue to
  work as intended; untrusted origins and ambiguous forwarded headers fail
  closed.
- Tests use browser-realistic requests; forged curl-only headers are not treated
  as proof of a browser exploit.
- Proxy tests cover chunked response success, oversized response, timeout,
  upstream abort, HEAD/204/304, and Clerk asset compatibility.
- Published headers are measured and recorded without assuming local headers
  represent the production edge.

**Release gate:** verify the deployed preview/custom-domain and Clerk behavior
before enforcing restrictive browser policies.

### 7. Reconcile product/security documentation and record evidence

**Risk addressed:** SEC-09 and audit limits.

**Implementation**

- Remove the stale one-recipient-only instruction where it conflicts with the
  currently supported native Gmail To/Cc/Bcc workflow.
- State consistently that a shared message body has aggregate pixel and click
  signals, not per-recipient attribution. Do not promise that replies prove opens.
- Link the security roadmap and audit from the project-facing guidance.
- Keep confirmed code changes, proposed work, and production verification
  separate; do not label a proposal as fixed.
- Record only sanitized release evidence: version, environment, UTC window,
  observed behavior, and regression result. Never record addresses, bodies,
  tokens, cookies, or credentials.

**Acceptance criteria**

- The project entry point, Glyph canon, extension README, and UI labels agree on
  recipient support, Bcc privacy, signal meaning, and extension trust.
- Every roadmap item is marked proposed, in progress, verified, or deferred with
  evidence; an open item is never described as remediated.
- A controlled production verification is performed only with explicit
  authorization and test-owned accounts/content.
- The less-than-1% regression target remains **unknown** until enough comparable
  releases have been observed over a defined window.

## Cross-cutting engineering gates

Every security workstream must:

1. Add a focused failing regression test before the fix.
2. Test the actual boundary: PostgreSQL for persisted behavior, HTTP for route
   contracts, and real extension source for origin and caller checks.
3. Assert both allowed and denied behavior, including rightful-owner success.
4. Use deterministic clocks and isolated identities; never use production
   credentials, customer tracking URLs, or live customer mail.
5. Keep request logs free of body text, addresses, tokens, cookies, and
   credential-bearing URLs.
6. Run relevant unit, integration, HTTP, coverage-inventory, lint, format,
   typecheck, and build gates once per coherent change.
7. Review all generated API artifacts and extension package contents when their
   source contracts change.
8. Verify deployed behavior separately; local tests do not prove Clerk edge,
   Gmail proxy, or published-host behavior.

Coverage percentages measure the selected critical-source inventory, not
security completeness. Clean automated scanners are useful evidence, not a
substitute for the adversarial tests above.

## Deferred / out of scope

- Per-recipient pixels or link attribution in a shared native Gmail send. This
  requires a separate product decision and individualized delivery design.
- Changing email sending, Gmail permissions, authentication provider, or
  production schema as part of roadmap documentation.
- Claiming a penetration test, security certification, zero-risk status, or a
  measured regression rate without the corresponding evidence.
- Automatically purging historical data or changing retention/export promises;
  those require a separate reviewed product and data-lifecycle decision.

## Tracking status

This document is a proposed plan, not a set of completed fixes or a task queue.
Update status and link the focused tests, release checks, and review evidence as
work is completed. Preserve the dated audit as the original assessment rather
than rewriting its findings to imply they are current or already fixed.
