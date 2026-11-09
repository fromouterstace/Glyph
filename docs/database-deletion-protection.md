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

## Retained-state conversion in the workspace

The additive review adds nullable archive/retirement timestamps. Development
has received this expansion; production has not been changed by this work.

- Removing an unsent web draft archives its row. Active message, activity and
  contact readers omit it; stale edits and send claims cannot modify/send it.
- Superseded tracking links retain their rows but become inaccessible. Unchanged
  active links keep their tokens; an existing link ID cannot change destination
  or token during a send claim.
- OAuth cancellation and consumption expire retained state records and clear
  their encrypted verifier. Existing replay/session/expiry checks still apply.
- Removed valid attachments retain metadata and bytes, but cannot be downloaded
  or attached again through normal routes. Rejected malformed uploads retain
  retired metadata; their invalid bytes are cleaned up, not preserved as valid
  attachments. This prevents oversized rejected uploads accumulating.
- The 100-file/100-MiB attachment budget counts all retained owner metadata,
  including retired and saved attachments. Removing a valid attachment no longer
  frees this budget. No automatic purge or unreviewed quota bypass exists.

**Why:** retaining database rows must not silently reactivate archived resources,
lose legitimate attachment bytes, or create an unlimited rejected-upload store.

## Runtime connection support, not provisioning

The pool supports `GLYPH_RUNTIME_DATABASE_URL` as a separate connection override.
`GLYPH_REQUIRE_RESTRICTED_DATABASE=1` refuses startup if that override is missing.
Presence of a URL does not prove its privileges: the permission preflight must
still inspect the actual connection. Database fixtures reject a configured
runtime override so an integration test cannot accidentally select it.

Neither setting provisions a PostgreSQL role or removes other credentials from
the process. In particular, a privileged managed `DATABASE_URL` remaining in the
web environment would still be a credential-exposure boundary to resolve.
No restricted runtime credential has been installed and the requirement flag
has not been enabled for production.

## Prerequisites before activation

1. Provision a separate non-owner, non-BYPASSRLS runtime login through an
   authorized database administrator. Keep schema-owner/maintenance credentials
   out of the web process. Inspect inherited memberships, PUBLIC grants, schema
   ownership, defaults for newly created tables and callable privileged routines.
2. Verify the restricted connection with the catalog preflight and the actual
   app journeys above. Only then make the deployed runtime preflight mandatory.
3. Implement and test the two-identity operation-specific approval workflow
   before offering any protected-operation exception. Keep execution separate
   from the ordinary runtime credential and preserve an audit record.
4. Verify production enforcement independently. Do not infer it from the
   development role, an isolated test role, a schema lint pass or Publish.

Replit's documented Publish process transfers supported schema objects but not
functions, triggers or grants. Do not add production migration scripts,
startup-time DDL, or deploy hooks to work around that boundary. Production
privilege provisioning requires an authorized administrative process; no such
production change was performed here.

Reference:
[How Publish updates your production database](https://docs.replit.com/features/data-and-storage/publish-database-changes).

## Verification recorded

- The targeted run passed 25 PostgreSQL tests and four permission-policy unit/
  CLI tests, including actual denied DELETE, TRUNCATE and DROP operations.
- `pnpm check` passed schema safety, lint, formatting, TypeScript, critical-source
  coverage, mandatory discovery, contracts, UI tests and test-layer line budgets.
- `pnpm check:database-access` returned nonzero with `safe: false` for the current
  privileged development connection, as required. This is a detected blocker,
  not a successful production enforcement check.
- The development expansion adds only three nullable timestamp columns.
  No customer rows were physically deleted, no persistent role grants were
  changed, and no production schema/permissions were changed. The temporary test
  role and grants were rolled back.
