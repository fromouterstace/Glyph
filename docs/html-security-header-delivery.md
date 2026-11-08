# Production HTML security-header delivery

## Decision

Serve production Glyph documents and public assets through the small Express web
service, rather than the artifact's static serving mode. The artifact's `/` path,
port, public URLs, build, and API service's separate `/api` path stay unchanged.
Production startup runs `artifacts/glyph/server/start.mjs`; deployment metadata was
updated with the validated artifact configuration tool.

**Why:** On both published hostnames, the old static HTML lacked the configured
headers even though the API sent them. Another API middleware or an HTML meta tag
would not provide HTTP framing protection for the document.

The web artifact now needs a production Node process. Startup validates the built
index and has a managed `/` startup probe; shutdown drains connections with a
bounded deadline. The service does not handle sessions, database access, Gmail,
or API authentication. These stay with the existing API service.

## Delivered policies

Every response from the production web service includes:

- `Content-Security-Policy: frame-ancestors 'none'; object-src 'none'; base-uri 'self'`
- `X-Frame-Options: DENY`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: camera=(), microphone=(), geolocation=()`

HTML is `no-store`; hashed JS/CSS assets retain long-lived immutable caching.
Downloads are not replaced by the SPA shell. Missing assets, source maps, hidden
files, encoded traversal attempts, and API requests are not served as SPA HTML.
Errors do not disclose filesystem paths. Unsupported methods are rejected.

This is the existing configured CSP, **not** a new `script-src`/`default-src`
policy or a guarantee against XSS. Fonts, rich composing, attachments, auth scripts,
and top-level OAuth navigation retain their existing behavior.

TLS termination, HSTS, and HTTP-to-HTTPS routing remain at the deployment edge.
This change does not disable certificate validation or modify managed Clerk DNS.

## Preview and API routing

- Preview continues using Vite; the production framing ban does not break Replit's
  embedded Preview.
- Application routes, sign-in/sign-up callback paths, and deep links receive the
  built index.
- `/api`, including the Clerk proxy, Gmail OAuth callback, and public tracking,
  still routes to the separate API artifact. The web server deliberately returns
  404 if it receives one of those paths, rather than hiding a gateway error.
- Same-origin extension connection and the extension download URL remain unchanged.
- Owner isolation, sessions, tracking tokens, recipient rules, and databases were
  not changed.

## Regression protection

- `scripts/web-serving.contract.test.mjs` issues actual GET/HEAD requests to the
  production app with both public Host values. It checks policies on every private/
  public document path, sign-in callbacks, caching, download integrity, base paths,
  rejected files/methods, and production configuration.
- `scripts/test-document-security.mjs` deliberately removes each policy and proves
  a headerless production response cannot pass.
- `scripts/check-web-server.mjs` starts the actual production application against
  the real built output. The artifact build fails if document policies, routes,
  JS/CSS dependencies, or the extension archive fail.
- Gate negative controls demonstrate that failure of that HTTP gate prevents a
  successful frontend build. Required-runner inventory protects contract discovery.
- HTTPS smoke now requires actual document security headers on every page. It does
  not accept source configuration, API headers, or HTML meta tags as substitutes.
- The 50/100/150/200 test-body limits remain enforced.

## Release verification

**Workspace implementation is not a production fix until published.** Before
publishing, HTTPS smoke against the existing live build is expected to fail the
new document-header requirement. Do not weaken the gate to make that build green.

After the user publishes:

1. Run `node scripts/smoke-check.mjs https://glyph.rocks`.
2. Run `node scripts/smoke-check.mjs https://glyph-mail.replit.app`.
3. Check actual GET and HEAD headers for `/`, `/emails`, `/gmail`, `/sign-in`,
   and `/sign-up` on both origins.
4. Verify direct sign-in and Google callback, an authenticated page, extension
   connection/download, and normal navigation in a controlled browser. Recipient
   tracking must remain public; use invalid/synthetic tokens unless live mail
   testing is specifically authorized.

Do not describe the published header gap as closed until these live responses
have been checked.

## Workspace verification

Lint, independent formatting verification, strict TypeScript, 206 unit tests,
76 contracts, 74 UI tests, and 13 gate controls passed (369 cases). Web and API
production builds passed, including the new HTTP document gate. The actual
production entrypoint also passed startup, headers, built assets/downloads, a
combined read-only smoke against the existing local API, and clean SIGTERM exit.
The dependency audit reported no vulnerabilities.

The pre-publish live smoke still fails with `missing CSP frame-ancestors 'none'`.
That is the expected unresolved deployment observation, not a passing live result.
