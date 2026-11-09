# Database deletion protection

## Approved policy

The user chose **block deletion; allow normal updates**, not literal insert-only
storage. Normal authenticated SELECT, INSERT and UPDATE operations must continue.
Runtime DELETE, TRUNCATE, DROP and destructive schema changes must be denied.
Protected-operation exceptions require approval from **both**
`stacydbradford@gmail.com` and `glyph.test.email@gmail.com`.

An approval must eventually be bound to one reviewed operation, its exact target
and payload digest, two distinct verified identities, an expiry and single use.
There must be no generic unlock, arbitrary-SQL HTTP endpoint, client-supplied
approver identity, or `--force` bypass. No such approval workflow is implemented
yet; this document does not authorize an exception or claim one is enforced.

## Retained-state conversion

Normal application paths no longer physically delete database records:

- Removing an unsent web draft sets `archived_at`. Active message, activity,
  overview and contact readers exclude it. A stale rendered draft cannot be
  claimed for sending after archival.
- Link replacement sets `retired_at` on superseded links. Unchanged native links
  retain their tokens; retired tokens return 404 rather than redirecting.
- OAuth invalidation and completion retain the state record, expire it and clear
  its encrypted verifier. Claimed/expired states remain unusable.
- Attachment removal or rejection sets `retired_at` and preserves object bytes.
  Retired attachments cannot be read, finalized or attached through normal APIs.
  The 100 MiB/100-file retention quota includes all retained attachment records,
  including retired files; removal does not recover retained storage capacity.

The additive review `0004` adds three nullable timestamp columns. It was applied
to development through the guarded development workflow. It has **not** been
applied to production here. Old application versions do not honor retirement
markers, so an application rollback is not proof that retirement is enforced.

The mandatory source gate also rejects direct Drizzle `delete(glyph...)` calls
and direct DELETE statements against Glyph tables in checked runtime paths.
HTTP DELETE handlers and in-memory Map/Set cleanup remain allowed. This is a
conservative static regression check, not a complete SQL analyzer or a substitute
for restricted database privileges.

## Restricted-connection activation support

`GLYPH_REQUIRE_RESTRICTED_DATABASE=1` selects the separate secret
`GLYPH_RUNTIME_DATABASE_URL`. In that mode there is no fallback to `DATABASE_URL`.
The API checks the selected connection's catalog privileges before listening or
starting workers and aborts if the role is unsafe or verification fails. Pool
acquisition and the catalog query have bounded timeouts. Destructive isolated
test fixtures refuse to use this runtime mode.

Without the enforcement flag, development continues to use its existing
`DATABASE_URL`; this is still a privileged connection. Merely adding the new
code or a secret does not activate protection.

An authorized production administrator must provision the separate non-owner
login and appropriate grants. Store its connection string through Replit
Secrets, never in code, logs, chat or an approval record. Verify it with:

```sh
GLYPH_REQUIRE_RESTRICTED_DATABASE=1 pnpm check:database-access
```

No separate production login, password, grant or enforcement environment setting
was created by this implementation. No maintenance credential is loaded into a
new privileged web executor. Protected-operation execution remains unavailable;
the in-app workflow below records approvals but does not perform exceptions.

## In-app approval records

The user chose to place the approval interaction **inside Glyph**, not an external
release workflow. `/database-approvals` and its navigation entry are available
only to the two designated accounts above. Server-side checks fetch verified
addresses from Clerk on every request. One Clerk account holding both designated
addresses is rejected; request creation is not an approval.

Requests contain an immutable operation (`delete_rows`, `truncate_table`,
`drop_object` or `change_privileges`), exact target, plan SHA-256, reason,
server-assigned requester/environment and one-hour expiry. The server hashes
all immutable attributes, including the unique request ID and timestamps.
Actions must submit that exact digest; altered metadata or a different server
environment is rejected. There is no SQL-text field, edit endpoint or global
unlock. A changed plan needs a new request and two new approvals.

Each distinct verified account can sign only its own slot. Either can revoke a
live request. A transaction locks the row before acting; consumption revalidates
both stored signers and succeeds only once, before expiry. PostgreSQL checks
backstop valid operations/environments, hashes, identity/timestamp pairs, distinct
signers, lifetime and consumption prerequisites. Revocation and consumption
retain actor IDs and timestamps; records are never deleted by this workflow.
Identity-provider errors fail closed.

**Consumption is only a retained authorization record, not execution.** The UI
requires confirmation for revocation/consumption and explicitly states that it
does not run SQL, change privileges, establish backup recoverability or restrict
owner SQL consoles/Publish. An actual protected-operation executor is not built
or authorized by this feature. The ordinary runtime role must remain restricted
even when an approval record exists.

The API returns private/no-store responses, requires signed-in sessions, blocks
non-designated readers, enforces same-origin mutations, strictly validates
request bodies and bounds list pages to 50. UI queries are keyed by Clerk user,
poll for the other approver's changes and never automatically retry mutations.
Request fields survive polling and failed submissions.

Selecting the restricted pool does not prove administrative credentials are
absent from the container. Verify the published runtime's credential separation
independently, including platform-managed connection variables. An application
approval screen or script cannot prevent a database/project owner from bypassing
it through external administrative access.

## Implemented permission verification

`pnpm check:database-access` makes catalog-only SELECT queries through the
configured database connection. It prints only a sanitized permission report and
exits nonzero for:

- Superuser, BYPASSRLS, role/database administration or elevated role membership.
- Ownership of the database, protected schema or protected tables.
- Schema CREATE permission or executable non-system SECURITY DEFINER routines.
- DELETE or TRUNCATE permission on any `public.glyph_*` table.
- Missing SELECT, INSERT or UPDATE permission, missing tables, incomplete catalog
  evidence or connection failure.

It does not grant or revoke privileges, inspect customer rows, execute approved
operations, install an approval workflow, or change the runtime connection. A
successful report is evidence about the tested connection and these direct
privilege paths—not proof of complete database security or tenant isolation.
The configured development connection is privileged and currently **fails**
this check. It must not be described as a protected runtime connection.

The gate's unit suite is mandatory in test discovery and critical-source
coverage. PostgreSQL integration tests create a unique NOLOGIN writer inside an
isolated test-schema transaction, grant only SELECT/INSERT/UPDATE and schema
USAGE, then verify actual operations: INSERT/SELECT/UPDATE succeed while DELETE,
TRUNCATE and DROP fail with insufficient privilege. Role, grants and fixture
writes are rolled back; nothing is installed in public or production.

This preflight is intentionally separate from the ordinary development quality
gate: development schema authoring currently needs privileged credentials.
Its tests run in normal quality/CI, but the actual runtime permission check is
**not yet a mandatory publishing gate**. Neither passing CI nor publishing the
current code activates the requested deletion lock.

## Prerequisites before activation

1. Review the actual Publish diff for the additive retention columns and verify
   the retained-state journeys on the deployed build. Do not infer production
   rollout from development schema application.
2. Provision a separate non-owner, non-BYPASSRLS runtime login through an
   authorized database administrator. Keep schema-owner/maintenance credentials
   out of the web process. Inspect inherited memberships, PUBLIC grants, schema
   ownership, defaults for newly created tables and callable privileged routines.
3. Verify the restricted connection with the catalog preflight and actual app
   journeys above. Enable the restricted-mode flag only with the verified runtime
   secret available; the API then makes the runtime preflight mandatory.
4. Verify the in-app approval-record workflow on the deployed build before
   relying on it. Protected-operation execution remains a separate, unimplemented
   boundary; do not offer an exception until that executor has independent
   authorization, recovery evidence and a durable audit record.
5. Verify production enforcement independently. Do not infer it from the
   development role, an isolated test role, a schema lint pass or Publish.

Replit's documented Publish process transfers supported schema objects but not
functions, triggers or grants. Do not add production migration scripts,
startup-time DDL, or deploy hooks to work around that boundary. Production
privilege provisioning requires an authorized administrative process; no such
production change was performed here.

Reference:
[How Publish updates your production database](https://docs.replit.com/features/data-and-storage/publish-database-changes).

## Verification recorded

- The PostgreSQL run passed 27 tests, including actual denied DELETE, TRUNCATE
  and DROP operations under the isolated restricted role.
- `pnpm check` passed schema safety, lint, formatting, TypeScript, critical-source
  coverage, mandatory discovery, contracts, UI tests and test-layer line budgets.
- The full integration gate passed 136 service tests (including the 14 approval
  access/action/integrity cases) and nine process shutdown/recovery tests.
  The UI gate passed 103 tests, including approval-form/action/denial coverage.
  These are automated component/API tests, not a live two-account browser trial.
- The separate HTTP gate passed 36 tests. Smoke includes approval document
  delivery and signed-out approval reads/writes. The production web artifact
  passed its document-header, asset, route and extension-download checks.
- The API artifact rebuilt and restarted successfully. Development HTTPS smoke
  returned 200 for liveness/readiness and 401 for signed-out message/contact reads.
- `pnpm check:database-access` returned nonzero with `safe: false` for the current
  privileged development connection, as required. This is a detected blocker,
  not a successful production enforcement check.
- The retention columns and new approval table were applied to development only. Existing
  application records were not removed; test writes used isolated schemas.
  No persistent role grants, production schema/permissions or production
  credentials were changed. The temporary permission-test role was rolled back.
