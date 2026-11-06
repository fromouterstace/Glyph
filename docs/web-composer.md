# Rich web composer

The web composer is an optional companion to Gmail-native composition. It supports
multiple To, Cc and Bcc recipients in one shared message, including Cc-only or
Bcc-only messages. Separate email addresses with commas or semicolons.

## Supported behavior

- Bold, italic, underline, email-safe font families and font sizes.
- Bullet/numbered lists, alignment, HTTP/HTTPS/mailto links, undo/redo and clear
  formatting.
- Legacy plain-text drafts load as escaped text. Existing formatted drafts load
  their saved HTML. Ordinary rerenders do not reset local edits.
- Formatting and attachment IDs are saved in the draft before the explicit send
  confirmation. The Sender row continues to use the current authenticated
  account's real name; it is never recipient metadata.
- The modal and editor scroll, including on smaller screens and long messages.
- Message details retain rich formatting and offer owner-only attachment downloads
  after saving or sending.

## Persistence and delivery

PostgreSQL stores sanitized HTML, a plain-text alternative, attachment metadata,
ownership and the finalized storage generation. File bytes live in private App
Storage, never in PostgreSQL, browser local storage or the application filesystem.

Files upload directly to a server-issued storage URL. The browser sends no Clerk
token or cookies to storage. The server checks the actual uploaded size before
accepting the attachment. Only finalized, same-owner IDs may enter a draft.
Downloads require authentication and ownership, use private/no-store caching and
attachment disposition, and never serve the file inline.

The server reads the exact finalized object generation. Reusing a signed upload
URL cannot silently substitute different bytes into a saved attachment. Missing or
changed files prevent sending. A stale-formatting or stale-attachment snapshot
cannot claim a concurrently edited draft.

Sending creates a multipart/alternative plain-text + sanitized HTML message,
wrapped in multipart/mixed when files are attached. HTTP(S) links retain their
labels and are rewritten for tracking; mailto links are not rewritten. Only
Glyph's server adds its tracking pixel. Rich text never creates inferred opens.

## Limits and safety

Recipient groups are stored privately in PostgreSQL and preserved on draft
reopen. Up to 100 unique recipients are allowed across all three fields; duplicate
addresses across roles are rejected rather than silently exposing a blind copy.
The confirmation shows all three roles. Gmail receives one MIME send with To,
Cc and sender-side Bcc headers and handles removal of Bcc from recipient copies.
Bcc addresses must never be moved into To or Cc. Recipient-side stripping has not
been established by our simulated Gmail tests; controlled live evidence is needed
before claiming that was personally observed.

Shared-message pixels and links report aggregate signals, not the identity of the
recipient who engaged. Provider-independent reply matching uses every original
To/Cc/Bcc participant. A send claim also checks all three saved recipient lists,
preventing concurrent recipient edits from sending a stale draft.

- Body text and HTML: at most 50,000 characters each; JSON transport: 512 KiB.
- Up to 10 attachments, 10 MiB per file, 15 MiB combined per message.
- Unreferenced uploads are limited to 100 files / 100 MiB per account. Files
  already referenced by saved messages do not consume this staging budget.
- Newly uploaded, unreferenced files are cleaned up when their composer closes.
  Cleanup is best-effort across network failure; an explicit owner-only DELETE
  endpoint can remove unused uploads. Referenced files are never deleted by
  composer cleanup, including files shared by another saved draft.
- Filenames, media types, counts, ownership and size are checked server-side.
  Download disposition and HTML sanitation are not malware scanning; Gmail's own
  attachment restrictions can still reject a send.
- Images, scripts, event handlers, forms, frames, unsafe URLs and unsupported CSS
  are removed from formatted content. Pasted remote images are not supported.
- Save and send fail explicitly on errors. Sends are never automatically retried.
- Writes still require the verified owner of this project's connected Gmail
  mailbox; this feature does not add per-user Gmail connections.

## Release and regression checks

The additive schema introduces `body_html`, `attachments`, `glyph_attachments`
and an attachment-metadata GIN index. Existing messages retain their body and
receive empty attachment lists. Review/apply this schema through the normal
publishing database migration flow before the updated server accepts traffic.
Readiness now validates the new critical schema without scanning account data.

- `pnpm check`: lint, formatting, TypeScript, unit/contract/UI tests and gate
  negative controls. Rich HTML, MIME and attachment policy are required coverage
  inventory entries, not just optionally loaded modules.
- `pnpm check:integration`: isolated PostgreSQL persistence, owner isolation,
  unsafe/unready attachment rejection, actual-size mismatch cleanup, mock Gmail
  MIME submission, stale-edit protection, lifecycle and process checks.
- `pnpm check:http` and `pnpm check:smoke`: running-service boundaries and health.
- Optional real storage probe:
  `GLYPH_DATABASE_TESTS=1 GLYPH_STORAGE_SMOKE=1 pnpm --filter @workspace/scripts exec tsx storage-smoke.mjs`.
  It uses an isolated PostgreSQL schema, uploads a tiny private fixture, verifies
  its exact bytes and cross-owner denial, and removes its own file/schema. It
  sends no email. It requires the workspace App Storage service and is not a
  generic CI check without that service.

Unit/UI tests exercise real editor commands, toolbar controls, HTML retention,
font/size changes, lifecycle resets, upload failures and trusted upload targets.
Service tests simulate Gmail; they do not prove real recipient rendering,
Gmail image fetching, antivirus behavior or email delivery.
