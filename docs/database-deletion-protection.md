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

## Prerequisites before activation

1. Replace physical deletion in normal operation with explicit retained-state
   transitions:
   - Draft removal in `routes/glyph.ts`.
   - Link replacement in `lib/message-lifecycle.ts` and `routes/glyph-native.ts`.
   - OAuth state cleanup/consumption in `lib/gmail-oauth.ts`.
   - Attachment metadata and object cleanup in `lib/attachments.ts`.
     Retired links and attachments must become inaccessible, archived drafts must
     leave active views, and expired/consumed OAuth states must stay unusable.
     Do not silently ignore a denied DELETE or break sending/reconnection.
2. Provision a separate non-owner, non-BYPASSRLS runtime login through an
   authorized database administrator. Keep schema-owner/maintenance credentials
   out of the web process. Inspect inherited memberships, PUBLIC grants, schema
   ownership, defaults for newly created tables and callable privileged routines.
3. Verify the restricted connection with the catalog preflight and the actual
   app journeys above. Only then make the deployed runtime preflight mandatory.
4. Implement and test the two-identity operation-specific approval workflow
   before offering any protected-operation exception. Keep execution separate
   from the ordinary runtime credential and preserve an audit record.
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

- The targeted run passed 25 PostgreSQL tests and four permission-policy unit/
  CLI tests, including actual denied DELETE, TRUNCATE and DROP operations.
- `pnpm check` passed schema safety, lint, formatting, TypeScript, critical-source
  coverage, mandatory discovery, contracts, UI tests and test-layer line budgets.
- `pnpm check:database-access` returned nonzero with `safe: false` for the current
  privileged development connection, as required. This is a detected blocker,
  not a successful production enforcement check.
- No application records, persistent role grants or production schema/
  permissions were changed. The temporary test role and grants were rolled back.
