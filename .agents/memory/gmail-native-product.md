---
name: Gmail-native product scope
description: User's explicit correction about where Glyph belongs
---

The user clarified: "It should be native to gmail in the browser."

**Why:** A standalone web composer connected to Gmail did not satisfy their intended workflow.

**How to apply:** Prioritize adding controls inside Gmail's compose and keeping Gmail's own sending behavior. Treat the web dashboard as the setup/reporting companion, not the required place to compose emails.

## Individual sending accounts

Each user must be able to connect their own Gmail account, with sending, sync,
reply detection, and extension access tied to that user's connection.

**Why:** The user explicitly approved individual Gmail connections; additional
sending accounts are distinct from multiple To/Cc/Bcc recipients.

**How to apply:** Preserve per-user authorization across mailbox operations,
background sync, and the extension bridge. Never satisfy this requirement by
removing ownership checks on the project-level Gmail connection.

## Multiple recipients

The user requires multiple To, Cc and Bcc recipients in both Gmail and the web composer. Do not restore the historical one-recipient/no-Cc/no-Bcc limitation or require the extension for group messages.

**Why:** The user explicitly asked to remove that restriction and repeated the request when Cc/Bcc were missing from the web composer. Shared pixels cannot identify individual recipients, but that limitation should be disclosed rather than blocking group messages.

**How to apply:** Preserve Gmail's one-send/thread workflow, track aggregate message signals, retain recipient roles privately, and match provider-independent replies from all original participants.

For real-send testing after publishing, connect the Gmail extension to the published companion app. Do not just point a development message's tracking URL at production.

**Why:** Tracking requests must reach the environment that owns the corresponding message record. Publishing does not reconnect an installed extension or rewrite URLs embedded in already-sent emails.

**How to apply:** Keep message preparation, the connection tab, tracking URL, and reporting in the same environment. Distinguish old development test messages from new production sends when diagnosing missing events.

Real-send preparation must reject preview origins and tracking hosts different from the connection tab; setup opened in preview must direct users to the verified published app instead of copying its own host.

**Why:** The installation instructions previously copied the preview origin, creating real sent emails whose pixel tokens existed only in the development database. Changing the pixel hostname alone cannot repair those emails.

**How to apply:** Enforce this boundary in both extension and server paths, including web sends and previously installed extensions. Keep production URLs as explicit deployment configuration, not activity data. Do not claim Google proxy loads are fixed until a fresh recipient-side request is actually observed.

Web composing does not require the browser extension. Explain production-origin
restrictions before offering Send, not through extension-reconnection errors.
Keep the current draft tab open when directing someone to published Glyph.

**Why:** A development web draft was allowed to reach Send and then showed
extension-specific instructions. Redirecting its tracking hostname would still
send requests to a database that does not own that draft's tokens or files.

**How to apply:** Permit saving development drafts, keep real tracked sends on
their owning public origin, and disclose that drafts and attachments do not
transfer automatically between environments.
