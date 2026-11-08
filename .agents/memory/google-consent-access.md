---
name: Google consent access
description: External Google OAuth audience restriction observed during Gmail setup
---

On 2026-11-07, Google's consent screen for glyph.rocks explicitly reported that
the app was being tested, only developer-approved testers could access it,
and authorization was blocked with 403 access_denied.

**Why:** Earlier missing-connection reports did not establish where authorization
stopped. The Google error screenshot established an external consent-audience
restriction, not a failing extension click handler.

**How to apply:** Check the Google Cloud project associated with the Gmail OAuth
client and its test-user audience before changing app authentication. Adding an
approved tester is a Google configuration action; a code publish cannot do it.
Do not assume this restriction remains current after the Google configuration
changes, or claim broad public access has been approved.
