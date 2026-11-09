# Gmail Glyph-label imports and contacts

Messages carrying the exact Gmail label name `Glyph` (case-insensitive match)
are automatically imported for the authenticated owner of the connected mailbox.
The app never reads another user's connection or creates the label for them.
Create that label in Gmail and apply it to the correspondence to import.

## Persistence and scope

- Messages use PostgreSQL message storage with `delivery_source = import`.
  Contacts and resumable import cursors live in their own owner-scoped tables.
- Imports create contacts for visible From/To/Cc/Bcc addresses, excluding the
  connected mailbox itself. Gmail generally does not expose received Bcc lists;
  Glyph cannot recover recipients Gmail does not provide.
- First and last names are best-effort splits of actual display names. Missing
  names stay blank; they are not fabricated from email addresses. Compound and
  surname-first names may not split correctly. The email suffix is the complete
  domain after `@`, not just the top-level suffix.
- Each owner/email pair is unique. Re-imports can fill blank names but do not
  replace existing names. Each Gmail message/RFC Message-ID is deduplicated per
  owner; an existing tracked message is not overwritten by an imported copy.
- Imported correspondence has no tracking pixel or wrapped links. Importing
  cannot establish past sends, reads, clicks or replies, and imported messages
  do not inflate Glyph's sent metrics. Imported badges replace tracking claims.
- Gmail drafts are excluded. Message text is bounded to 50,000 characters and
  imported HTML is converted to text. Attachment bytes, inline images, and
  attachment metadata are not imported by this feature.
- Removing the label, deleting a Gmail message, disconnecting, a missing label
  or a provider failure never deletes already imported messages or contacts.

## Contact profiles

Contact rows open protected `/contacts/:id` profiles. Profiles match owned stored
messages through their primary correspondent or To/Cc/Bcc addresses, without
crossing account boundaries. Correspondence and signal histories have separate,
stable SQL pagination. Full message bodies remain available through the existing
Emails detail route.

Profiles show actual recorded pixel loads, link requests, destination URLs,
source/automation classifications and timestamps. These are message-level
signals, not proof of individual engagement, and imported correspondence has no
retroactive tracking history. Shared-thread replies may be from another original
participant.

Days since last communication uses the latest stored sent/received email
timestamp or recorded sent/reply event on a related message. It never uses contact
creation, draft creation, pixel loads or clicks. No known communication means a
null timestamp/age, not zero days. This is stored correspondence only; it does not
silently ingest a contact's entire unlabeled Gmail history.

Contact navigation, cache identity, ownership, payload privacy and published
asset checks are covered by the contact-profile section of
[the testing canon](testing-canon.md#contact-navigation-and-profile-regression-protection).
Passing public smoke does not prove an already-open tab loaded a new build.

## Automatic scheduling and recovery

The signed-in app starts an import and retries every 60 seconds, with no
overlapping client runs and no recurring error toasts. The Contacts page exposes
status, last successful batch time, retry, search and pagination.

A server worker processes up to ten connected personal mailboxes per minute in
rotating owner order. Each import processes at most 25 messages and persists its
next-page token; subsequent batches continue the scan. Completed scans restart
from the latest labeled mail. The shared Gmail read budgets and authorization
checks still apply. Invalid pagination tokens are cleared for the next retry.

This is polling, not instant Gmail push delivery. Large backfills and provider
cooldowns delay imports. Workers run only while a server instance is running;
they do not establish an always-on external scheduler or wake a sleeping
deployment. Opening the app supplies another scheduling path. Legacy connector
accounts import through authenticated app requests, not global worker discovery.

## Security and release gates

Contacts reads, import-state reads and import writes require authentication.
Writes additionally use the existing same-origin and verified-mailbox gates.
Owner IDs are derived from authentication, never accepted from the caller.
Contact searches and counts are filtered and paginated in SQL.

Readiness and smoke cover the new tables, contact uniqueness, route delivery and
anonymous rejection. Required suite discovery includes the parser, real
PostgreSQL service tests and import UI contracts; critical-source coverage
includes the parser. The test-layer 50/100/150/200-line limits still apply.

At least one personal Gmail import contract must exercise the real owner-bound
OAuth transport and PostgreSQL storage, mocking only Google's network responses.
Adapter-only fixtures cannot verify outbound endpoint permissions. Label
discovery permits the exact read-only `GET /labels` request; label writes and
unrecognized paths stay blocked. A provider-contract regression must also check
that one user's imported contacts remain unavailable to another user.

Schema review `0003` is additive only. Development creates the two new tables;
production must receive the expansion through the reviewed Replit Publish flow.
No runtime DDL, production schema script, data overwrite or destructive reset is
permitted. Rollback retains imported records and additive tables.
