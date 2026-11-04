# Glyph

Gmail-connected sales email tracking: a glyph is the tracking pixel; tracked links and an engagement feed alert the sender to open and click signals.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/glyph` — React web app at `/`.
- `artifacts/api-server/src/routes/glyph.ts` — authenticated draft/send and engagement APIs.
- `artifacts/api-server/src/routes/glyph-tracking.ts` — public token-based pixel and link endpoints.
- `artifacts/api-server/src/lib/gmail.ts` — Gmail connector, mailbox ownership, MIME message generation.
- `lib/db/src/schema/glyph.ts` — Drizzle schema.
- `lib/api-spec/openapi.yaml` — API contract, regenerate with the codegen command above after edits.

## Architecture decisions

- This first version uses the project's connected Gmail mailbox, not separate Gmail connections per app user. A verified Clerk email must match that mailbox before any mutation or mailbox address disclosure. Never allow arbitrary signed-in users to send through the shared connector.
- Unauthenticated views use explicitly labeled fictional sample data, kept separate from live storage. Signed-in users see only their own records.
- One recipient per email. Unique opaque pixel/link tokens associate signals with the sent copy, but forwarded messages and privacy proxies prevent proof of reader identity.
- Never automatically retry uncertain Gmail sends: reconcile by RFC Message-ID with Gmail Sent, and require manual review if still uncertain.
- API authentication uses Clerk cookies; public tracking endpoints deliberately remain unauthenticated.

## Product

The primary product is a desktop Gmail browser extension. Its Add glyph control augments Gmail's own rich-text compose; Gmail still handles Send and keyboard shortcuts. The web app is the reporting, installation and connection companion. A legacy web composer remains secondary. Image caching, proxies, and security scanning make engagement approximate, not guaranteed read receipts.

## User preferences

The product is called Glyph; “glyph” is the name of its tracking pixel.
The user clarified: "It should be native to gmail in the browser." Prioritize Gmail-native workflows over a separate composer.

## Gotchas

- Use a durable published HTTPS origin for reliable external tracking. Blank tracking origin uses the current browser origin, which is temporary in preview.
- Do not seed live mailbox data or send test emails without the user's explicit confirmation of recipient and content.
- Native extension source is in `extensions/glyph-gmail`; `node extensions/build.mjs` produces the downloadable ZIP at web app predev/prebuild time. Generated PNG icons and ZIP need not be committed.
- The extension asks for optional access only to the selected Glyph origin, then uses an open signed-in Glyph tab as a same-origin cookie-auth bridge. No long-lived app/Gmail credentials are copied into the extension. Keep the tab open for preparation and notifications.
- Native messages start as pending drafts and are confirmed only by marker verification in Gmail Sent, never by a Send click. Sync scans the last 25 sent messages in seven days; use promptly. Never send native drafts through the API.
- Browser notifications operate while browser/connection tab are running; offline email/push delivery and reply/bounce detection are not implemented.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
