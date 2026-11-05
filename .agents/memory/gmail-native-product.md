---
name: Gmail-native product scope
description: User's explicit correction about where Glyph belongs
---

The user clarified: "It should be native to gmail in the browser."

**Why:** A standalone web composer connected to Gmail did not satisfy their intended workflow.

**How to apply:** Prioritize adding controls inside Gmail's compose and keeping Gmail's own sending behavior. Treat the web dashboard as the setup/reporting companion, not the required place to compose emails.

For real-send testing after publishing, connect the Gmail extension to the published companion app. Do not just point a development message's tracking URL at production.

**Why:** Tracking requests must reach the environment that owns the corresponding message record. Publishing does not reconnect an installed extension or rewrite URLs embedded in already-sent emails.

**How to apply:** Keep message preparation, the connection tab, tracking URL, and reporting in the same environment. Distinguish old development test messages from new production sends when diagnosing missing events.
