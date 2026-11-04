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

Compose, save, edit, and delete unsent drafts; explicitly confirm and send through Gmail; track image requests and link redirects; view engagement history and notification preferences. This is a web composer connected to Gmail, not a Gmail browser extension. Image caching, proxies, and security scanning make engagement approximate, not guaranteed read receipts.

## User preferences

The product is called Glyph; “glyph” is the name of its tracking pixel.

## Gotchas

- Use a durable published HTTPS origin for reliable external tracking. Blank tracking origin uses the current browser origin, which is temporary in preview.
- Do not seed live mailbox data or send test emails without the user's explicit confirmation of recipient and content.
- Notifications are in-app/browser while the app is running; offline email/push delivery and reply/bounce detection are not implemented.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
