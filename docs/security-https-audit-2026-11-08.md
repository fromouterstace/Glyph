# Security and HTTPS audit — 2026-11-08

## Executive assessment

No critical/high finding was identified by the three fresh automated scans or
the manual checks described below. This is **not** a claim of complete security.
The principal confirmed gap is missing browser security headers on published
HTML. Authentication-provider TLS and some deployment controls also need
separate evidence.

This is an audit of workspace source and observed live responses. It did not
publish changes, alter production settings/data, request customer tracking
tokens, send email, or inspect secret values.

## Fresh automated results

| Scanner | Result |
| --- | --- |
| Dependency audit | Completed; critical/high/moderate/low/info: 0 each |
| Static application security analysis | Completed, not incomplete; 0 findings |
| Privacy/security dataflow analysis | Completed; 0 findings |

Automated scans do not establish browser policy delivery, all authenticated
authorization branches, TLS configuration, or absence of business-logic flaws.

## Findings and priorities

### S1 — Medium: published HTML lacks browser security headers

**Confirmed on both published origins**, for `/`, `/sign-in`, `/emails`, and
`/gmail`:

- No `Content-Security-Policy`.
- No `X-Frame-Options` or CSP `frame-ancestors`.
- No explicit `Referrer-Policy`, `Permissions-Policy`, or
  `X-Content-Type-Options`.
- HSTS is present; missing browser headers do not mean TLS itself is broken.

The API sends these headers, but those API response headers do not govern the
browser document. Missing framing restrictions leave a clickjacking defense
absent. Missing CSP removes an additional XSS/active-content defense; no XSS
exploit or data compromise was demonstrated.

Workspace `.replit` already contains response-header rules. However, the observed
published HTML does not contain them. Neither the presence of source configuration
nor API middleware proves static HTML delivery is protected. The web artifact is
currently served as static content in the combined deployment.

**Remediation:** Use a verified, supported header-delivery configuration or a
header-capable serving path for HTML. Apply response policies at the document
serving boundary; verify actual GET responses after publishing on both origins.
Preserve the browser-extension bridge, Clerk proxy, OAuth callback, asset routing,
and public tracking exceptions. A hosting/serving change requires a reviewed
implementation and release, not another unverified configuration-only claim.

### S2 — Defense-in-depth: current API CSP is deliberately narrow

The API policy is:

`frame-ancestors 'none'; object-src 'none'; base-uri 'self'`

It does not restrict executable script or connection sources, and is not a full
application XSS policy. Even this policy is absent from the published HTML.

**Remediation:** First deliver the document headers in S1. Then develop an
application-compatible `script-src`/`connect-src`/`style-src` policy with the actual
Clerk, Google-font, attachment, and application dependencies. Do not deploy
`default-src 'self'` blindly: it can break sign-in and legitimate resources.
Use report-only rollout and controlled authenticated browser evidence before
enforcement. This finding is missing defense-in-depth, not an established XSS.

### S3 — Conditional authentication availability: hosted accounts TLS fails

Direct TLS connections to `accounts.glyph.rocks` failed with both TLS 1.2 and
TLS 1.3 in this environment. This is separate from both working application
origins. Source uses the managed same-origin Clerk proxy and redirect-based
embedded authentication, which should not depend on a hosted popup callback.

**Remediation:** Verify the complete published Google sign-in callback uses
the intended same-origin routes. If a live flow still navigates to the hosted
accounts origin, investigate that configuration with the managed-auth provider.
Do not disable certificate validation, downgrade TLS, change managed DNS
speculatively, or treat the failed direct-host probe as proof that app sign-in
is broken.

### S4 — Evidence gap: alias HTTP redirect not established

The custom domain's port-80 redirect was observed, but the HTTP request to the
deployment alias failed from the audit environment. This is not evidence that
the alias serves private data over plaintext.

**Remediation:** Confirm the alias's port-80 redirect from a second network or
deployment-edge evidence. Preserve HTTPS/HSTS regardless.

## Verified HTTPS posture

Publishing metadata confirmed:

- Primary: `https://glyph.rocks`.
- Additional: `https://glyph-mail.replit.app`.
- Public Autoscale deployment with a successful build.

| Check | Custom domain | Deployment alias |
| --- | --- | --- |
| TLS 1.2, trusted certificate and hostname | Passed | Passed |
| TLS 1.3, trusted certificate and hostname | Passed | Passed |
| Observed TLS 1.2 cipher | ECDHE-ECDSA-AES128-GCM-SHA256 | ECDHE-ECDSA-AES128-GCM-SHA256 |
| Observed TLS 1.3 cipher | TLS_AES_256_GCM_SHA384 | TLS_AES_128_GCM_SHA256 |
| Certificate expiry observed | 2027-02-04 21:11:12 GMT | 2026-12-08 12:47:05 GMT |
| HSTS | `max-age=63072000; includeSubDomains` | Same |
| HTTP redirect | 301 to `https://glyph.rocks:443/` | Unverified; HTTP request failed |

Certificate dates are observations, not a renewal guarantee. Older TLS versions,
all cipher suites, OCSP, DNS ownership, and edge-origin isolation were not
exhaustively enumerated. No claim is made about those unmeasured controls.

## Authentication, authorization, and source review

- Anonymous production requests to overview, messages, activity, settings,
  connection, Gmail authorization, system summary, and a fabricated attachment
  returned 401, not private records. This includes requests with a foreign Origin.
  Responses used `private, no-store` and did not grant foreign CORS access.
- Private pages are static shells whose client gate displays sign-in; HTTP 200
  for a shell is not evidence of authenticated data exposure. Account-data APIs
  enforce authentication separately.
- Source derives owners from validated Clerk sessions and uses owner-scoped
  message/attachment queries. Existing PostgreSQL-backed owner-isolation tests
  are relevant controlled evidence, not proof of every production session.
- General mutations enforce trusted same-origin requests and verified mailbox
  ownership. Gmail authorization has a separate session/same-origin boundary so
  connecting an initially disconnected mailbox is possible.
- OAuth uses random state, PKCE, owner/session/origin/expiry binding, atomic
  single-use state claims, and generation checks across reconnect/disconnect.
  Grant/profile checks bind the Gmail account to verified Clerk identity.
- Gmail credentials are server-side authenticated ciphertext with owner binding;
  encryption strength also depends on the workspace-managed secret, whose value
  and entropy were deliberately not inspected.
- The extension restricts supported published origins, requests selected-origin
  permission, and bridges through an authenticated tab rather than storing app
  or Gmail credentials. Arbitrary HTTPS hosts are not automatically trusted.
- The Clerk proxy uses a fixed HTTPS upstream, production origin checks, timeout
  handling, and bounded response buffering. Tracking handlers intentionally run
  outside Clerk so recipient image clients are not challenged to sign in.
- Private attachment metadata uses owner scope and finalized object generations;
  app bytes are not intentionally exposed through a public account-data route.
- Sanitization strips unsupported/active email HTML. Safe user-authored HTTP links
  are intentionally retained; those third-party destinations are not proof of
  an app-controlled insecure connection and should not be silently rewritten.
- Tracking tokens are public bearer capabilities by design, with persisted abuse
  budgets. They do not establish reader identity. Invalid-token probes were used
  in this audit, not customer tokens.
- Replit's documented `GAESA` routing cookie is infrastructure-managed, not an
  application authentication cookie. It was not misclassified as a leaked session.

## What remains unverified

- Complete live Google consent/sign-in, cross-user browser sessions, Gmail reply/
  image fetching, and real notification delivery.
- Managed-auth MFA, session-lifetime and compromised-password settings: the audit
  established the app uses managed Clerk, not its dashboard policy configuration.
- Database/storage infrastructure access policies, backups, encryption at rest,
  provider internal controls, and production secret rotation.
- Effective repository merge protections and continuous scan/smoke activation.
- Security against all inputs, authenticated abuse, sophisticated browser attacks,
  or future dependency vulnerabilities.

## Recommended sequence

1. Fix and verify HTML response-header delivery (S1), including both origins.
2. Confirm the real published auth callback does not depend on failing hosted TLS.
3. Introduce a compatible report-only CSP and review violations before enforcement.
4. Resolve alias redirect evidence; review managed-auth and infrastructure policies.
5. Keep scanner, owner-isolation, mutation-origin, attachment, and token-abuse
   regression gates running. Track deployment evidence separately from workspace
   implementation.

Earlier roadmap and audit observations are dated snapshots; this report supersedes
their **observed HTTPS/authentication posture**, not their implementation history.
