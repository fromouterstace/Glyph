# Glyph code-quality audit

Date: November 4, 2026, America/Los_Angeles.

## Scope

- Glyph frontend, API server, shared libraries, Gmail extension, build scripts,
  automated tests, TypeScript configuration, and dependencies.
- Generated OpenAPI clients and schemas remain generator-owned: TypeScript checks
  them, but formatting/lint fixes do not hand-edit them.
- Copied UI primitives are linted and type-checked, while their upstream formatting
  is preserved. The platform-managed canvas scaffold receives TypeScript and
  standard Hooks checks; Glyph additionally receives the React compiler's
  recommended correctness rules.
- No database migrations, real email sends, production data edits, authentication
  provider changes, or automatic publishing.

## Findings addressed

### Repeatable checks

There was no lint gate. Added ESLint with recommended JavaScript, TypeScript, and
React Hooks checks, zero permitted warnings, a modified cyclomatic-complexity
limit of 20, and a nesting-depth limit of four. Enabled full TypeScript strict
mode and unused-local/parameter checks. Added formatting commands for maintained
application code and an aggregate `pnpm check` command.
Backend lint also type-checks promise handling, rejects awaiting non-promises,
and requires structured logging rather than console calls.

Existing TypeScript checks already passed before this work; the stronger checks
now pass as well. Formatting changes are mechanical rather than product changes.

### Complexity and responsibilities

The initial complexity/nesting check identified eight findings. These included
Settings (complexity 34), email detail (32), Dashboard (30), web sending (23),
pixel handling (22), notification handling (21), email listing (22), and reply
scan nesting (five levels). Refactored these to meet the stated limits without
raising thresholds or suppressing findings in Glyph.

- Email HTML rendering and escaping are now pure functions, independent of Gmail
  transport and database writes. Link lookup uses a map rather than repeatedly
  searching and escaping the link list.
- Pixel-recording eligibility is separate from request handling.
- Reply persistence is separate from mailbox pagination/batching.
- Connection status, overview statistics, activity preview, message summary, and
  signal timeline have focused presentation components.
- Notification labels/preferences use explicit event-type mappings.

### Form and interface safety

- Composer sessions are scoped to open/message identity, replacing initialization
  effects with omitted dependencies. Polling the same message preserves local
  edits; closing/reopening or changing identity resets the session.
- Message-detail state is keyed by message ID so edit/delete/send dialogs cannot
  remain attached to a previously selected message.
- Settings derive from server data until edited and preserve pending edits during
  refreshes. Successful saves replace local state explicitly.
- Tracking-origin validation in the UI now matches the server's HTTPS-only,
  no-credentials, no-path/query/fragment policy.
- Corrected settings instructions that previously suggested pointing development
  records at an unrelated production tracking origin.
- Dashboard request failures are displayed instead of looking like an empty
  recent-message list.
- Removed fabricated sample messages, events, counts, and a response-only
  `starred: false` flag. Signed-out API reads now return empty account data and
  an explicit read-only session indicator. The API schemas no longer expose
  sample-only fields.
- Each eligible pixel-load or tracked-link request now inserts its own event
  row; repeated loads from the same client within the same minute are no longer
  collapsed. Event counters and charts remain derived from database event rows.
- Mobile navigation resets through its route-scoped lifetime, has an accessible
  toggle label, and exposes its expanded state.
- Browser viewport and carousel state use external-store subscriptions. Carousel
  cleanup removes both listeners. Sidebar skeletons no longer call randomness
  during render.
- Browser notification permission failures are reported, and extension bridge
  errors retain their original cause.
- Settings save controls stay in normal document flow instead of covering a
  tracking toggle on narrow/short viewports.

### Dependencies and build output

- Updated React/React DOM within the existing 19.1 patch line, resolving Clerk
  peer-version mismatches without changing the authentication provider.
- Added compatible, current lint/test tooling and patched vulnerable transitive
  minimatch instances in that tooling.
- Split frontend React and authentication dependencies into cacheable chunks.
  The approximately 567 kB single JavaScript chunk is now approximately 258 kB
  application, 186 kB React, and 123 kB authentication chunks, before gzip.
  This changes packaging, not the authentication flow.
- Removed a redundant server-component directive from a client-only tooltip
  primitive, eliminating its previous Rollup sourcemap diagnostic.

## Verification commands

```sh
pnpm check
PORT=3000 BASE_PATH=/ pnpm -r --if-present run build
pnpm --filter @workspace/scripts test:tracking-http
pnpm audit
git diff --check
```

`pnpm check` includes lint, formatting, full workspace TypeScript checks, 69
logic/extension tests, and 11 DOM-based composer/settings tests. The separate
13-case HTTP suite requires the managed preview/API workflows to be running.

Results: zero lint errors/warnings, zero TypeScript errors, clean formatting,
80 passing logic/component tests, 13 passing HTTP tests, successful production
builds, and zero dependency vulnerabilities reported by `pnpm audit`.

Tests cover message identity changes, unsaved-edit preservation, create/update
draft behavior, rejected saves, explicit send confirmation, tracking defaults,
read-only signed-out settings, origin validation, escaping/URL overlap, pixel
format, native-send verification, provider-neutral reply matching, extension
behavior, anonymous write rejection, empty signed-out reads, and public
tracking responses. HTTP image checks use a nonexistent token, never a user's
real pixel.

## Persistence audit

PostgreSQL is the source of truth for messages and drafts (`glyph_messages`),
tracking-link tokens and destinations (`glyph_links`), recorded sent/open/click/
reply activity and read status (`glyph_events`), and account preferences
(`glyph_settings`). User reads scope records by account owner. Open, click, send,
and reply totals are derived from those stored event rows rather than maintained
in hardcoded counters. Pixel tokens are stored on their message; each accepted
tracked request stores its event in PostgreSQL. Raw IP addresses and full
user-agent strings are not persisted.

The removed sample fixtures were the one source of hardcoded email activity in
the signed-out API. Signed-out reads are now empty; tests assert they cannot
return example emails, opens, clicks, or replies. Default UI labels, empty-state
copy, and first-use setting defaults remain code-defined configuration, not
account activity. The Gmail extension keeps its connection origin, last-poll
time, and notification de-duplication cursor in Chrome local storage; these are
delivery/polling state, not engagement records. Actual engagement events stay
in PostgreSQL and are returned by the authenticated API.

## Limits and remaining caveats

- Component tests use mocked mutations: no test email was sent, and no synthetic
  open/click/reply was added to a user's message.
- The HTTP suite verifies anonymous access boundaries, not a complete signed-in
  multi-account ownership or CSRF browser journey.
- Code-quality checks and valid GIF responses do not prove a successful real Gmail
  image-proxy fetch. Pixel counts are measured accepted endpoint requests, not
  unique human reads; Gmail may cache or proxy images.
- Tracking-origin syntax is validated; a custom origin is not yet verified to
  share the same backend/message store. The existing reply-scan limit of 100
  recent received messages within 30 days is unchanged.
- The scaffold's Recharts 2 dependency emits a deprecation warning. A major
  chart-library upgrade was deliberately not folded into this behavior-preserving
  audit. Dependency vulnerability results are separate from deprecation notices.
- Changes apply to the workspace until the user publishes them.
