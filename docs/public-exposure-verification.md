# Public credential and authentication-boundary verification

## Live evidence

The strengthened published smoke passed on both hosts on 2026-11-09 UTC:

- `https://glyph.rocks`: completed at `04:55:22.341Z`.
- `https://glyph-mail.replit.app`: completed at `04:55:28.552Z`.

| Boundary                                                                                                                   | Observed result on both hosts |
| -------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| Anonymous private API reads                                                                                                | 401 JSON errors               |
| Invalid bearer token on messages, settings, contacts and System summary                                                    | 401 JSON errors               |
| Caller-supplied owner, Clerk and test-identity headers on those APIs                                                       | 401 JSON errors               |
| Invalid bearer combined with those headers                                                                                 | 401 JSON errors               |
| `/.env`, `/.git/config`, `/package.json`, GET and HEAD                                                                     | 404                           |
| Recognizable credentials in checked HTML/API responses, discovered same-origin JS/CSS graph and unpacked extension entries | None detected                 |
| Document security headers, HSTS, readiness, assets and package integrity                                                   | Passed                        |

Fresh dependency, static-code and privacy scans reported no findings in the
workspace. No non-template `.env` files were tracked by Git at the time checked.
These observations do not prove secrets never entered repository history.

## Additional hardening implemented

A stronger local fixture exposed a policy gap: a real `package.json` placed in the
public directory was served, even though its absence made the live URL return 404.
The production server now serves only explicit root resources and supported
`/assets/` types. Arbitrary files elsewhere cannot be served simply because they
exist. Extensionless private files cannot replace the empty application shell.

Contracts place actual synthetic `.env`, Git configuration, package metadata and
server files in the public directory and verify denial. Allowed resources, route
fallbacks, artifact prefixes and HEAD responses remain covered.

The build and published smoke reject recognizable private-key, Clerk server-key,
Google client-secret/access-token, GitHub-token and credential-bearing database-URL
formats. Synthetic poisoned HTML, lazy chunks and extension files prove rejection
without including matching values in error messages. Public Clerk publishable
keys and variable names are not treated as server credentials.

## Verification and activation boundary

- `pnpm check` passed: schema safety, lint, Prettier, TypeScript, required discovery,
  critical-source coverage, 281 unit/CLI tests, 81 contracts, 90 UI tests and
  13 negative gate controls.
- The production Glyph artifact build passed, including chunk, asset/credential,
  extension integrity and production HTTP gates.
- The 50/100/150/200-line test-layer limits remain enforced.
- The stronger live checks above passed against the existing published release.
  **The new production-server allowlist is a workspace change and has not been
  published by this work.** Publish it and repeat the same acceptance command:

  ```sh
  pnpm check:published https://glyph.rocks https://glyph-mail.replit.app
  ```

No production data or credentials were changed. No secret environment values were
read for comparison. Pattern checks cannot detect every arbitrary, encoded or
unknown-format credential. They do not establish backdoor absence, full Git-history
secret hygiene, or authenticated cross-account authorization. Confirmed credential
exposure would require revocation/rotation, not just removing a public file.
