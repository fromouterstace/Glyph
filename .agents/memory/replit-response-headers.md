---
name: Replit response-header scope
description: Replit response-header behavior when a static web artifact is served by an Autoscale deployment.
---

Treat `.replit` `deployment.responseHeaders` as unverified until actual HTML responses have been checked for an Autoscale deployment that includes a static web artifact. API middleware or framework headers do not necessarily apply to static HTML served by the deployment edge.

**Why:** Current official documentation recommends response-header configuration for Static and Autoscale deployments, but live checks still found the published HTML without those headers while the API had them. The rules exist in workspace configuration; neither configuration presence nor validation proves they are active on the current published static responses.

**How to apply:** After publishing, inspect actual HTML and API responses separately. If the static response lacks the configured headers, use a supported serving/configuration approach before claiming the browser policy is active.

Keep production HTML on a header-capable serving path, while preserving Vite for
the embedded development Preview.

**Why:** The selected remediation deliberately replaces static production serving
so the document policies are applied by the server. Applying the production
framing ban to Preview would block its embedding.

**How to apply:** Do not revert production to headerless static serving or treat
API headers as document protection. Preserve document, asset, extension-download,
and API routing checks, and verify both published hostnames after release.
