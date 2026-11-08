---
name: Canonical Glyph origin
description: User-selected production origin and compatibility boundaries.
---

Use `https://glyph.rocks` as the canonical production address.

**Why:** The user said, "Let's align on glyph.rocks for determinism."

**How to apply:** Keep new user-facing setup and connection instructions,
extension trust, tracking workflows and release-primary selection aligned with
this origin. Do not promote the deployment alias to an interchangeable primary.

Preserve older token URLs and alias compatibility rather than silently rewriting
sent messages or moving authentication between origins.

**Why:** Changing a canonical address does not migrate existing message tokens,
browser sessions or OAuth state. Breaking those would damage existing workflows.

**How to apply:** Keep compatibility security checks; make any future retirement
or authentication migration a separately reviewed change.
