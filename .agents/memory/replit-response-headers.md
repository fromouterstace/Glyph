---
name: Replit response-header scope
description: Replit response-header behavior when a static web artifact is served by an Autoscale deployment.
---

Treat `.replit` `deployment.responseHeaders` as unverified for an Autoscale deployment that includes a static web artifact. Replit's documentation describes that setting for Static Deployments; API middleware or framework headers do not necessarily apply to static HTML served by the deployment edge.

**Why:** The app's deployment uses Autoscale with a static web artifact, and the docs distinguish static deployment header configuration from Autoscale application/framework headers. A successful config validation does not prove the live static response contains those headers.

**How to apply:** After publishing, inspect actual HTML and API responses separately. If the static response lacks the configured headers, use a supported serving/configuration approach before claiming the browser policy is active.
