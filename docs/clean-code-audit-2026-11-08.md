# Clean-code audit — 2026-11-08

## Conclusion

The maintained application passes its enforced static, type, formatting, test,
HTTP, smoke, and production-build checks after the corrections below. There are
no outstanding lint warnings or TypeScript errors in those checks.

This is not a certification that every runtime path is defect-free, that every
export is necessary, or that every external dependency/service is secure. Dated
audit results are evidence for this workspace revision, not a production release
or a substitute for ongoing tests.

## Review scope

- Frontend, API, shared libraries, extension scripts, and test/build orchestration.
- Strict TypeScript settings, unused locals/imports/parameters, React hook rules,
  lint suppressions, error-handling patterns, and file/function complexity.
- Existing canon, ownership rules, rendering/tracking preferences, and instructions
  that future changes depend on.
- A stricter exploratory complexity pass at 12, compared with the enforced
  modified-complexity limit of 20. Candidates were reviewed as maintenance
  signals, not automatically treated as bugs.
- Existing tests continue to enforce the 50/100/150/200 test-body size limits.

Generated clients and third-party/scaffold UI primitives were not gratuitously
rewritten. No dependency update, authentication migration, database migration,
or production data change was needed.

## Corrections

### Disabled click tracking now remains disabled with stale links

The plain-text renderer could use a supplied link list without checking
`trackClicks`, whereas the rich renderer checked that flag. The pure renderer
now consistently respects the preference even if its caller supplies old links.
An explicit regression test checks the original destination, escaped query
parameters, absence of a tracking redirect, and absence of a disabled pixel.

URL extraction also reuses the existing safe HTTP URL validator rather than
maintaining a duplicate protocol/credential predicate.

Files: `artifacts/api-server/src/lib/email-content.ts`,
`scripts/test-email-content.mjs`.

### Reply matching separates automatic-message rejection

Sender draft/Sent labels, automatic responses, delivery reports, and precedence
checks now have a named private predicate. This separates that decision from
mailbox/participant eligibility, timestamps, and reply-header attribution.
The actual rejection and matching rules remain unchanged.

File: `artifacts/api-server/src/lib/reply-matching.ts`.

### Workspace instructions match the current product

`replit.md` incorrectly described shared-only Gmail access, signed-out private
views, and a single-recipient web composer. It now agrees with the canon and
implementation: personal owner-bound Gmail grants, restricted legacy fallback,
private sign-in walls, and shared To/Cc/Bcc recipient support.

No recipient-identification or verified-human-open claim was introduced.

## Verification

| Boundary | Result |
| --- | --- |
| ESLint with zero warnings | Passed |
| Independent Prettier verification | Passed |
| Strict TypeScript across workspace packages | Passed |
| Units | 204 passed |
| Contracts | 71 passed |
| UI | 74 passed |
| Gate negative controls | 13 passed |
| PostgreSQL | 21 passed |
| Service integration | 98 passed |
| Child-process lifecycle/recovery | 6 passed |
| Running local API HTTP contracts after restart | 32 passed |
| Local read-only readiness/asset/package/auth smoke | Passed |
| Web and API production builds | Passed |
| Lazy-route, built asset graph, and extension archive gates | Passed |

Total: **519 passing test cases** across these runners. Selected critical-source
unit coverage is 98.88% lines, 97.42% branches, and 100% functions; these are not
whole-application coverage percentages.

## Remaining maintenance considerations

- Some compose/session, Gmail DOM placement, scanner, and page-rendering functions
  exceed the exploratory limit of 12 but remain within the enforced limit of 20.
  Split them when a change offers a clear behavioral or maintenance benefit;
  lowering a number alone does not justify a broad rewrite.
- Unused-export/dependency analysis and a fresh dependency/security scan are not
  established by lint or a successful build.
- Controlled tests do not establish the complete live Clerk/Google/Gmail journey,
  human opens, or all Gmail layouts. The preceding
  [coverage audit](test-coverage-audit-2026-11-08.md) records these evidence limits.
- No new release was published for this audit.
