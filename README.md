<div align="center">

# glyph

**One pixel. More context. No mind-reading.**

Gmail-native email tracking, an honest activity feed, and correspondence that stays connected to your contacts.

[Start with Glyph](https://glyph.rocks/gmail) · [Engineering canon](docs/glyph-canon.md) · [Testing guide](docs/testing-canon.md) · [Operations](docs/operations-runbook.md)

</div>

---

## Your inbox. With a little more follow-through.

Write where you already write. Send the way you already send.

Glyph adds tracking to Gmail's browser compose without taking over its Send button,
keyboard shortcuts, or Undo Send. The companion app brings messages, contacts,
pixel loads, link requests, and matched replies into one owner-scoped workspace.

The footprint is small. The distinction between **a signal** and **a certainty**
is not.

> A glyph is a tracking pixel—not a witness. Image proxies, caches, scanners,
> forwarding, and blocked images all affect what can be observed.

### What comes with it

| Capability                    | What it actually does                                                                                                               |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| **Gmail-native composition**  | Add tracking explicitly from the desktop browser extension. Gmail still sends the message.                                          |
| **Your own Gmail connection** | Each Glyph user can authorize one Gmail mailbox matching a verified email on their Glyph account.                                   |
| **Messages and activity**     | Persist sent confirmations, eligible pixel loads, link requests, and matched replies in PostgreSQL.                                 |
| **Contacts with context**     | Import correspondence from the Gmail `Glyph` label, create contacts, and open their correspondence and signal history.              |
| **A secondary rich composer** | Format text, attach private files, and review To/Cc/Bcc recipients before an explicit web send.                                     |
| **Opt-in alerts**             | Browser notifications while the connection is active; server email alerts for eligible open/click signals while the API is running. |

## The honest fine print

**Signals are not read receipts.** A recorded pixel load does not prove a person
opened the email. A link request may come from a scanner. A cached image may not
make another request when the email is reopened.

**A shared message has shared signals.** Up to 100 unique To/Cc/Bcc recipients are
supported, but the shared pixel and links cannot identify which person acted.
Forwarding makes attribution less certain still.

**Replies are different evidence.** Glyph matches standard reply headers and the
actual sender against original participants. A reply never manufactures an open.

**Uncertain sends stay uncertain.** Glyph reconciles against Gmail Sent rather
than automatically sending a potentially accepted message again.

## From inbox to insight

1. Open the canonical published app at **[glyph.rocks](https://glyph.rocks)** and
   sign in. Private app pages and account-data APIs require authentication.
2. On **Gmail**, connect the mailbox matching a verified email on your account.
   Signing into Glyph and granting Gmail access are separate steps.
3. Download the extension from that page. Follow its Chrome/Edge unpacked-extension
   instructions, approve access to the exact Glyph origin, and connect it.
4. Keep the signed-in Glyph connection tab open. In a Gmail compose or reply,
   choose **Add glyph**, then use Gmail's own **Send**.
5. Check Emails and Activity for persisted signals. Put correspondence under your
   Gmail **`Glyph`** label to import it and populate Contacts.

Imports are polled and processed in bounded batches, not delivered instantly by
Gmail push. Imported old mail has **no retroactive tracking history**.

When updating an unpacked extension, install the new package and reload Gmail
after preserving drafts. Publishing the website does not update an installed
extension.

### Preview is a workshop, not the mailroom

Preview supports inspecting the app and editing/saving web drafts. Real tracked
sends and personal Gmail authorization use the published environment.

Drafts, attachments, connection state, and tracking tokens belong to the
environment that created them. They do not transfer automatically when you
publish. Never point an already-sent preview token at production to “repair” it.

## For the people building it

### The stack

| Layer       | Tools                                                                                |
| ----------- | ------------------------------------------------------------------------------------ |
| Web         | React, Vite, TypeScript, Tailwind, TanStack Query                                    |
| API         | Express 5, Zod, OpenAPI-generated contracts                                          |
| Persistence | PostgreSQL and Drizzle                                                               |
| Identity    | Clerk sessions and server-validated ownership                                        |
| Mail        | Per-user Google OAuth and Gmail APIs; Gmail-native browser extension                 |
| Files       | Private App Storage with finalized generation-pinned attachments                     |
| Quality     | ESLint, Prettier, TypeScript, Node test runner, Vitest and isolated PostgreSQL tests |

```text
artifacts/
  glyph/             Web companion and production HTML service
  api-server/        Account APIs, Gmail integration, public tracking routes
extensions/
  glyph-gmail/       Desktop Gmail extension source
lib/
  api-spec/          OpenAPI source
  api-client-react/  Generated client and hooks
  api-zod/           Generated API validation
  db/               Drizzle schema and versioned schema reviews
scripts/             Quality gates, integration fixtures, smoke checks
docs/                Canon, operating rules and scoped audit evidence
```

### Start here

Use **Node.js 24** and **pnpm**. In a configured workspace:

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm check
```

Start the existing managed workflows:

- **`artifacts/glyph: web`** — the Vite companion app.
- **`artifacts/api-server: API Server`** — builds and starts the API.

Use the managed ports and base paths; do not create replacement services just to
get a second server running. The mockup sandbox is not required for normal use.

### Configuration, without the credential confetti

Keep credentials in the workspace's secure configuration. Never commit or print
connection strings, OAuth grants, session cookies, or encryption secrets.

| Configuration                                          | Purpose                                                                                                            |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| Managed `DATABASE_URL`                                 | The workspace's PostgreSQL connection; do not manually replace the platform-managed setting.                       |
| Clerk server and web keys                              | Authentication; follow the project's managed Clerk setup.                                                          |
| `GOOGLE_GMAIL_CLIENT_ID`, `GOOGLE_GMAIL_CLIENT_SECRET` | The application's Google OAuth client—not a user's Gmail password.                                                 |
| `SESSION_SECRET`                                       | Stable server encryption material. Rotating it makes saved Gmail credentials unreadable and requires reconnection. |
| `GLYPH_GMAIL_OAUTH_ORIGIN`                             | The approved authorization origin; production uses `https://glyph.rocks`.                                          |
| App Storage configuration                              | Private attachment storage; use the existing provisioned bucket configuration.                                     |

Google's registered production callback is
`https://glyph.rocks/api/glyph/gmail/oauth/callback`. Testing-mode consent audiences
can block other accounts even when app sign-in works.
See [personal Gmail setup](docs/gmail-per-user-oauth.md) for scopes and launch requirements.

A separate `GLYPH_RUNTIME_DATABASE_URL` is supported. Setting
`GLYPH_REQUIRE_RESTRICTED_DATABASE=1` requires its presence, **not proof of its
permissions**. This support does not provision a restricted role or activate the
production deletion lock.

## Earn the green check

| Command                                                                  | What it establishes                                                                                                             |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm check`                                                             | Schema-review safety, lint, formatting, types, mandatory discovery, tests, selected critical-source coverage and gate controls. |
| `pnpm check:integration`                                                 | Isolated PostgreSQL, service-boundary and process-recovery tests. Requires a development/test database.                         |
| `pnpm check:http`                                                        | Authentication and tracking HTTP contracts against the running app.                                                             |
| `pnpm check:smoke`                                                       | Read-only route, asset, extension-download, anonymous-API and readiness checks.                                                 |
| `pnpm check:all`                                                         | All of the above; requires the running app and test database.                                                                   |
| `PORT=3000 BASE_PATH=/ pnpm build`                                       | The fast quality gate followed by production artifact builds—not the full live release acceptance check.                        |
| `pnpm check:database-access`                                             | Read-only inspection of the selected connection's privileges; unsafe roles fail. It does not alter permissions.                 |
| `pnpm check:published https://glyph.rocks https://glyph-mail.replit.app` | Post-publish HTTP/security-header acceptance checks on the canonical origin and compatibility alias.                            |

Tests follow the **50 / 100 / 150 / 200** maximum lines per test function:
unit / contract / integration / end-to-end. Name the rule, arrange the smallest
realistic fixture, act, and assert the invariant. No skipped safety tests, no
fabricated production data, no real test mail without specific approval.

Coverage is evidence about the selected sources, not a probability that the app
will never regress. A “less than 1%” regression rate requires observed release
outcomes; a test count cannot certify it.

## Data deserves more than good intentions

- Private reads and writes are scoped to the authenticated owner. Public pixel
  and redirect endpoints are deliberate, narrow exceptions—not account-data APIs.
- Removed unsent drafts and obsolete tracking links retain their database rows.
  Retired resources must disappear from active views and stop working.
- Removed valid attachments retain their bytes and metadata. The owner retention
  budget is **100 files / 100 MiB**, including saved and retired attachments.
  Each message permits up to **10 files**, **10 MiB per file**, **15 MiB combined**.
  Invalid rejected upload bytes are cleaned up; their retired metadata remains.
- Normal application updates remain allowed. Physical database deletion,
  truncation, dropping objects and destructive changes require the approved
  protection policy and both designated approvers for an exception.
- **Production enforcement and the two-person approval workflow remain
  unfinished.** Do not mistake retained-state code or a passing permission test
  for an active database lock.
- Version schema reviews and use expand-and-contract. Managed production schema
  changes go through Replit Publish, not startup DDL or custom migration runners.
  A lint pass does not prove a backup can be restored.

The policy and rollout boundary live in
[database deletion protection](docs/database-deletion-protection.md) and
[database safety](docs/database-safety.md).

## Before calling it shipped

Use `https://glyph.rocks` for deterministic setup. Preserve
`glyph-mail.replit.app` only as a compatibility alias, including its existing
token routes and security checks.

Publishing success is not release acceptance. Verify both hosts' actual HTML
headers, readiness and assets, then obtain controlled sign-in, Gmail authorization,
extension, send and recipient-side evidence. Anonymous smoke does not prove those
authenticated journeys.

Remaining evidence gaps include production backup restoration, production
least-privilege credentials, database-level tenant isolation and remote
branch-protection enforcement. Audit reports are snapshots, not permanent seals
of approval.

## The documents worth keeping open

| Document                                                   | Read it for                                                                |
| ---------------------------------------------------------- | -------------------------------------------------------------------------- |
| [Product and engineering canon](docs/glyph-canon.md)       | Durable behavior, security boundaries and review rules.                    |
| [Testing canon](docs/testing-canon.md)                     | Test layers, discovery, coverage, smoke and release evidence.              |
| [Database safety](docs/database-safety.md)                 | Schema reviews, destructive-change restrictions and recovery requirements. |
| [Operations runbook](docs/operations-runbook.md)           | Health, startup, shutdown and operational checks.                          |
| [Personal Gmail connections](docs/gmail-per-user-oauth.md) | Owner-bound OAuth, consent configuration and reconnect behavior.           |
| [Label imports and contacts](docs/gmail-label-import.md)   | Import scope, contact creation, polling and history limitations.           |
| [Rich web composer](docs/web-composer.md)                  | Formatting, recipients, files, delivery limits and regression contracts.   |
| [Security roadmap](docs/security-remediation-roadmap.md)   | Remediation status and outstanding work.                                   |

**README for orientation. Canon for decisions. Tests and live evidence for claims.**
