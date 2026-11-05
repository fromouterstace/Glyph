---
name: Email tracking accuracy
description: Product accuracy constraint for interpreting open and click signals
---

Treat pixel loads and tracked-link requests as approximate engagement signals, not guaranteed read receipts or proof of recipient identity.

**Why:** Gmail caches images, privacy proxies can fetch without reading, security scanners can visit links, and forwarding shares the original tokens.

**How to apply:** Preserve these caveats in the interface and any future reporting, confidence scores, or sender notifications. Do not promise exact read counts or identify the individual who opened a forwarded copy.

The user explicitly clarified: "It should be a digit showing the number of pixel loads." Do not substitute an inferred-open label or inferred count based on replies.

**Why:** The user wants the actual tracking-pixel loading/recording problem investigated, not a different engagement definition.

**How to apply:** Keep pixel-load counts numeric and independent of clicks and replies. Investigate missing loads directly; do not replace the count with a read inference.

Validate Gmail's actual image-proxy path, not only local preview or a direct browser image load.

**Why:** A user-captured Gmail proxy request returned 404 for the correct pixel while an anonymous direct request returned 200. Direct reachability alone did not prove Gmail compatibility or identify the proxy failure's cause.

**How to apply:** Correlate the proxy request with the original URL in the message's image element. Require evidence from a fresh real proxy load before declaring Gmail open tracking fixed; do not manufacture historical loads.
