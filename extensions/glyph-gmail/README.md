# Glyph for Gmail — developer build

1. Extract the downloaded archive.
2. Open `chrome://extensions` or `edge://extensions`, enable Developer mode, select **Load unpacked**, and choose the extracted `glyph-extension` folder.
3. Pin Glyph. Enter your Glyph app's HTTPS origin in its popup and click Connect. Approve access to that origin only.
4. Sign in on the Glyph connection tab with the verified email matching the project's connected Gmail mailbox. Keep that tab open (background is fine). The extension uses that tab's existing session; it never stores your Gmail password or OAuth tokens.
5. Reload Gmail. In a rich-text compose with one To recipient and no CC/BCC, click **Add glyph**, then send using Gmail's normal Send or Ctrl/Cmd+Enter. Glyph does not intercept Send.
6. Editing the body, recipient or subject removes the glyph; add it again after your edits. Remove glyph restores original links. Attachments and existing formatting are not replaced.

Gmail DOM integration is experimental and supports desktop Chrome/Edge. Gmail can change its editor without warning. Some inline replies and alternate compose layouts may not expose the control; use a full compose window. Plain-text mode cannot carry a tracking pixel.

## Supported deployment and permissions

This is a single-mailbox developer build, not multi-tenant Gmail OAuth. Each Glyph deployment uses only its project's connected Gmail mailbox. A signed-in account must have that exact verified email before native preparation or sync can use the connector; the compose From account must also match. Installing this extension never grants an arbitrary user access to the workspace Gmail connector. For another mailbox, use a separate deployment and its own connector. Send-as aliases are not supported.

Use a root-mounted Glyph app and API on the same stable HTTPS origin, with working Clerk sign-in and the connected Gmail mailbox. Set the dashboard tracking origin to that same durable origin (or leave blank to use the connection origin). Do not point production tracking at a temporary preview. No publishing is performed by installing the extension.

Required Gmail host access reads compose recipients, subject, text and links only when preparing tracking and adds the controls/pixel/link replacements. Optional HTTPS access is requested for the exact Glyph origin entered in the popup; there is no blanket website grant. Scripting runs the isolated same-origin bridge on your open Glyph tab. Storage saves origin/preferences and notification state; alarms and notifications support browser engagement alerts. Neither OAuth tokens nor session cookies are stored in the extension.

Tracking controls and attribution caveats are visible in each supported compose before you click Add glyph. If a draft changes, tracking is removed without cancelling Gmail Send. Inspect the “Glyph ready” status before sending. Gmail keyboard shortcuts and Undo Send remain Gmail's responsibility.

The helper tab must remain open and signed in for new tracking preparation and extension notifications. The server continues to receive existing pixel/link requests even when all tabs are closed. Browser alarms poll approximately every 30 seconds, and throttling/offline periods may delay alerts.

A prepared draft is not a sent email. Glyph verifies a unique marker in Gmail Sent before counting it as sent or recording engagement. It examines the most recent 25 sent emails from the past seven days; sync promptly after sending. Gmail Undo Send is respected because no send is assumed from a button click.

Direct sender compose-image loads are ignored while pending. Image proxies can still prefetch/cache pixels, and a sender viewing a sent copy can cause an open signal. Very early image loads during confirmation may be missed. Link scanners and forwarded mail can distort click attribution. These are not guaranteed read receipts or proof of recipient identity.

Use a stable published Glyph origin for long-term tracking. A preview origin is temporary. This is an unpacked extension, not a Chrome Web Store listing. The manifest requests Gmail access and asks separately for the one Glyph origin you choose; it does not request access to all websites by default.
