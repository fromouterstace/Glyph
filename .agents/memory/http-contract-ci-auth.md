---
name: HTTP contract runner auth
description: Clerk configuration required when running API HTTP checks outside the configured Replit services
---

Running the API server with both Clerk keys absent can start the process but returns HTTP 500 for unauthenticated HTTP contract requests, even on health-check requests that pass through Clerk middleware.

**Why:** A bare GitHub-style API server does not reproduce the configured Replit auth environment, and the resulting 500s are not meaningful evidence about the route contracts.

**How to apply:** Run HTTP contracts against the configured Replit API or provide valid Clerk test configuration through the appropriate secrets workflow. Do not disable Clerk middleware, add a test identity header, or weaken auth to make the HTTP suite pass.
