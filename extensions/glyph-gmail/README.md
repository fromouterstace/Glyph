# Glyph for Gmail — developer build

Maintainers: follow [Glyph's product and safety canon](../../docs/glyph-canon.md)
when changing permissions, the app-origin bridge, tracking, or release behavior.
See the [security remediation roadmap](../../docs/security-remediation-roadmap.md)
for current workspace/release status and the [2026-11-05 security audit](../../docs/security-audit-2026-11-05.md)
for its historical assessment.

1. Extract the downloaded archive.
2. Open `chrome://extensions` or `edge://extensions`, enable Developer mode, select **Load unpacked**, and choose the extracted `glyph-extension` folder.
3. Pin Glyph. The v0.5.2 popup is fixed to `https://glyph-mail.replit.app`; click Connect and approve only that origin. Preview addresses, custom hosts and lookalike domains are not supported.
4. Sign in on the Glyph connection tab with the verified email matching the project's connected Gmail mailbox. Keep that tab open (background is fine). The extension uses that tab's existing session; it never stores your Gmail password or OAuth tokens.
5. Reload Gmail. In a rich-text compose with up to 100 To, Cc and Bcc recipients, click **Add glyph**, then send using Gmail's normal Send or Ctrl/Cmd+Enter. Glyph does not intercept Send or split your message into separate sends. Finish entering recipient chips first and remove duplicate addresses across roles.
6. Editing the body, recipient or subject removes the glyph; add it again after your edits. Remove glyph restores original links. Attachments and existing formatting are not replaced.

Gmail DOM integration is experimental and supports desktop Chrome/Edge. Gmail can change its editor without warning. Some inline replies and alternate compose layouts may not expose the control; use a full compose window. Plain-text mode cannot carry a tracking pixel.

## Supported deployment and permissions

This is a single-mailbox developer build, not multi-tenant Gmail OAuth. Each Glyph deployment uses only its project's connected Gmail mailbox. A signed-in account must have that exact verified email before native preparation or sync can use the connector; the compose From account must also match. Installing this extension never grants an arbitrary user access to the workspace Gmail connector. For another mailbox, use a separate deployment and its own connector. Send-as aliases are not supported.

Use a root-mounted Glyph app and API on the same stable HTTPS origin, with working Clerk sign-in and the connected Gmail mailbox. Set the dashboard tracking origin to that same durable origin (or leave blank to use the connection origin). Do not point production tracking at a temporary preview. No publishing is performed by installing the extension.

Required Gmail host access reads compose recipients, subject, text and links only when preparing tracking and adds the controls/pixel/link replacements. Optional HTTPS access is requested only for the fixed `https://glyph-mail.replit.app` origin; the manifest does not grant arbitrary HTTPS hosts or blanket website access. Scripting runs the isolated same-origin bridge on your open Glyph tab. Storage saves origin/preferences and notification state; alarms and notifications support browser engagement alerts. Neither OAuth tokens nor session cookies are stored in the extension.

Tracking controls and attribution caveats are visible in each supported compose before you click Add glyph. If a draft changes, tracking is removed without cancelling Gmail Send. Inspect the “Glyph ready” status before sending. Gmail keyboard shortcuts and Undo Send remain Gmail's responsibility.

The helper tab must remain open and signed in for new tracking preparation and extension notifications. The server continues to receive existing pixel/link requests even when all tabs are closed. Browser alarms poll approximately every 30 seconds, and throttling/offline periods may delay alerts.

A prepared draft is not a sent email. Glyph verifies a unique marker in Gmail Sent before counting it as sent or recording engagement. It examines the most recent 25 sent emails from the past seven days; sync promptly after sending. Gmail Undo Send is respected because no send is assumed from a button click.

Reply detection uses standard `In-Reply-To` / `References` headers and the original To, Cc and Bcc participants' actual addresses. Replies may come from Gmail, Outlook, Yahoo, iCloud, or custom-domain email. The connected **sender** mailbox remains Gmail. Matching does not depend on Gmail conversation IDs or subject lines, and no open is inferred from a reply. Automatic responses, sender followups and delivery reports are excluded. Missing reference headers or a reply from a different sender address may prevent matching.

One shared Gmail message contains one glyph and one set of tracked links. Its pixel loads and tracked-link requests are aggregate signals: they cannot reliably identify which recipient acted. Replies from any original participant attach to the same tracked message. Recipient roles are saved in PostgreSQL; Bcc addresses remain private to the sender's owned message detail and are not embedded in public tracking URLs or activity events. The sender's Gmail Sent copy must match the prepared recipient roles, including Bcc, before the message is confirmed. Gmail's normal single Send and threading behavior are preserved.

Sync inspects headers of the most recent 100 received messages in the past 30 days. It reports partial scans and errors explicitly. It does not download reply bodies or attachments or mark Gmail messages as read.

Direct sender compose-image loads are ignored while pending. Image proxies can still prefetch/cache pixels, and a sender viewing a sent copy can cause a pixel-load signal. Very early image loads during confirmation may be missed. Link scanners and forwarded mail can distort tracked-link counts. These are not guaranteed read receipts or proof of recipient identity.

Use https://glyph.rocks for the extension connection and sign in there. Then click Connect Gmail and authorize the same mailbox; signing in to Glyph is not Gmail authorization. A preview or arbitrary custom origin is not trusted. The manifest requests Gmail access and separately grants only this fixed production origin. Supporting another origin requires a reviewed extension release that changes the trust policy, manifest permission, version and regression tests together.

## Updating from an earlier extension

Replace the files in the original unpacked extension folder with the v0.5.4 package, click Reload in `chrome://extensions` or `edge://extensions`, then reconnect to https://glyph.rocks and approve host access. On update, the extension unregisters the previous dynamic bridge and removes saved untrusted host permissions and connection state, including the previous glyph-mail.replit.app connection. Existing tracking tokens and emails are not changed. Publishing the web app alone does not update an installed extension.

Tracking controls use a compact toolbar beside Gmail's Send controls in composes
and inline replies, outside the editable message. Explanatory text is collapsed
under Info. Unknown layouts fall back below the compose, never inside the draft;
the toolbar re-anchors when Gmail mounts or replaces Send controls.

Chrome invalidates old content-script runtimes when an extension is replaced,
reloaded, disabled or removed. The extension now reinjects its current messaging,
compose script and stylesheet into already-open Gmail tabs on install/update,
browser startup and explicit reconnect. It does not reload or navigate Gmail.
Updated compose scripts retire their old listeners/observers through a DOM
handoff, restore only generated tracking, notify Gmail of the draft edit, and
leave one new toolbar. Re-add the glyph before sending after a handoff.

Versions before v0.5.1 do not understand that handoff. If their toolbar survives
in a separate invalidated world, the new script disables its tracking control
and asks for one manual Gmail reload after the draft is saved. It never guesses
the old script's original URLs or rewrites the draft to force recovery. Disabled
or removed extensions cannot repair themselves; re-enable/reinstall first.
Closing or restricted tabs that reject injection keep the manual-reload fallback.
