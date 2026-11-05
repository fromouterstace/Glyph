# Glyph

Gmail-connected sales email tracking: a glyph is the tracking pixel; tracked links and an engagement feed report pixel-load, link-click, and reply signals—not verified human reads.

## Required product and safety canon

- Read [`docs/glyph-canon.md`](docs/glyph-canon.md) before changing product behavior, ownership, Gmail/extension permissions, event data, tracking origins, security, or test policy.
- `docs/testing-canon.md` defines the enforced test gates; `docs/test-gap-closure.md` records their scope and current limits. Treat dated audit reports as historical, not as current behavior guarantees.
- Preserve Gmail-native Send, verified-mailbox and owner isolation, stable same-origin production tracking, database-backed activity, and truthful non-human-readable signal labels. Never infer pixel opens from clicks or replies, hardcode sample activity, log personal email content/secrets, send live test email, or edit production data without specific user authorization.

## Run & Operate

- Use the configured `artifacts/api-server: API Server` workflow to run the API server on its managed port.
- `pnpm run typecheck` — full typecheck across all packages
- `PORT=3000 BASE_PATH=/ pnpm build` — full quality gates followed by production artifact builds
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — dev database schema only; never point this command at production without explicit authorization and a reviewed migration plan
- Required env: `DATABASE_URL` — obtain/configure it through the workspace secret flow; never print or commit it

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (API server starts from the generated `dist/index.mjs` bundle)

## Where things live

- `artifacts/glyph` — React web app at `/`.
- `artifacts/api-server/src/routes/glyph.ts` — authenticated draft/send and engagement APIs.
- `artifacts/api-server/src/routes/glyph-tracking.ts` — public token-based pixel and link endpoints.
- `artifacts/api-server/src/lib/gmail.ts` — Gmail connector, mailbox ownership, MIME message generation.
- `lib/db/src/schema/glyph.ts` — Drizzle schema.
- `lib/api-spec/openapi.yaml` — API contract, regenerate with the codegen command above after edits.

## Architecture decisions

- This first version uses the project's connected Gmail mailbox, not separate Gmail connections per app user. A verified Clerk email must match that mailbox before any mutation or mailbox address disclosure. Never allow arbitrary signed-in users to send through the shared connector.
- Signed-in reads and writes are owner-scoped. A validated Clerk user's verified email must match the shared mailbox before any operation that accesses that mailbox or sends through the connector. Never trust a client-supplied owner ID.
- Signed-out views are read-only and contain no fabricated messages or engagement. Static empty-state copy and documented first-use setting defaults are configuration, not activity.
- One recipient per email. Unique opaque pixel/link tokens associate signals with the sent copy, but forwarded messages and privacy proxies prevent proof of reader identity.
- Never automatically retry uncertain Gmail sends: reconcile by RFC Message-ID with Gmail Sent, and require manual review if still uncertain.
- API authentication uses validated Clerk sessions; public token-based tracking endpoints deliberately remain unauthenticated so recipient clients can load images and follow tracked links.
- Use PostgreSQL as the source of truth for messages, tokens, links, events, preferences, and counts. Event counts must come from persisted events; never fabricate or infer opens.
- The extension must not store passwords, OAuth/access tokens, cookies, or API credentials. Request only the selected Glyph HTTPS origin; never expand site access without documented review.

## Product

The primary product is a desktop Gmail browser extension. Its Add glyph control augments Gmail's own rich-text compose; Gmail still handles Send and keyboard shortcuts. The web app is the reporting, installation and connection companion. A legacy web composer remains secondary. Image caching, proxies, and security scanning make engagement approximate, not guaranteed read receipts.

## Gotchas

- Use a durable published HTTPS origin for reliable external tracking. A blank tracking origin follows the connection origin; a preview connection is still temporary.
- Do not seed live mailbox data or send test emails without the user's explicit confirmation of recipient and content.
- Native extension source is in `extensions/glyph-gmail`; `node extensions/build.mjs` produces the downloadable ZIP at web app predev/prebuild time. Generated PNG icons and ZIP need not be committed.
- The extension asks for optional access only to the selected Glyph origin, then uses an open signed-in Glyph tab as a same-origin cookie-auth bridge. No long-lived app/Gmail credentials are copied into the extension. Keep the tab open for preparation and notifications.
- Native messages start as pending drafts and are confirmed only by marker verification in Gmail Sent, never by a Send click. Sync scans the last 25 sent messages in seven days; use promptly. Never send native drafts through the API or automatically retry an uncertain send.
- Browser notifications operate while browser/connection tab are running. Reply detection uses provider-neutral In-Reply-To/References and actual sender addresses, read via the connected sender's Gmail metadata API. Recipient services are unrestricted; non-Gmail sender mailbox connections are separate. It excludes automatic replies, sender followups and delivery reports; never infers opens from replies.
- Reply sync inspects the newest 100 received messages in 30 days and surfaces partial scans/provider failures. It reads headers only, never reply bodies, and never marks provider messages as read. Existing sent records recover their actual RFC Message-ID from Gmail metadata. Bounce reporting remains unsupported.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
