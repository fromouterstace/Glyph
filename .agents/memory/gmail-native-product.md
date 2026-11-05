---
name: Gmail-native product scope
description: User's explicit correction about where Glyph belongs
---

The user clarified: "It should be native to gmail in the browser."

**Why:** A standalone web composer connected to Gmail did not satisfy their intended workflow.

**How to apply:** Prioritize adding controls inside Gmail's compose and keeping Gmail's own sending behavior. Treat the web dashboard as the setup/reporting companion, not the required place to compose emails.

## Multiple recipients

The user requires multiple To, Cc and Bcc recipients in the same Gmail thread. Do not restore the historical one-recipient/no-Cc/no-Bcc limitation.

**Why:** The user explicitly asked to remove that restriction. Shared pixels cannot identify individual recipients, but that limitation should be disclosed rather than blocking Gmail group messages.

**How to apply:** Preserve Gmail's one-send/thread workflow, track aggregate message signals, retain recipient roles privately, and match provider-independent replies from all original participants.

For real-send testing after publishing, connect the Gmail extension to the published companion app. Do not just point a development message's tracking URL at production.

**Why:** Tracking requests must reach the environment that owns the corresponding message record. Publishing does not reconnect an installed extension or rewrite URLs embedded in already-sent emails.

**How to apply:** Keep message preparation, the connection tab, tracking URL, and reporting in the same environment. Distinguish old development test messages from new production sends when diagnosing missing events.

Real-send preparation must reject preview origins and tracking hosts different from the connection tab; setup opened in preview must direct users to the verified published app instead of copying its own host.

**Why:** The installation instructions previously copied the preview origin, creating real sent emails whose pixel tokens existed only in the development database. Changing the pixel hostname alone cannot repair those emails.

**How to apply:** Enforce this boundary in both extension and server paths, including web sends and previously installed extensions. Keep production URLs as explicit deployment configuration, not activity data. Do not claim Google proxy loads are fixed until a fresh recipient-side request is actually observed.
