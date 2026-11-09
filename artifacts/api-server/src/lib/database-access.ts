interface CatalogClient {
  query(text: string, values: string[]): Promise<{ rows: unknown[] }>;
}

const forbidden = [
  'superuser',
  'bypass_rls',
  'create_roles',
  'create_databases',
  'elevated_membership',
  'executable_security_definer',
  'database_owner',
  'schema_owner',
  'schema_create',
  'table_owner',
  'can_delete',
  'can_truncate',
] as const;
const required = ['can_select', 'can_insert', 'can_update'] as const;

// Read catalogs and privilege metadata only, never account rows or credentials.
const catalogSql = `WITH protected AS (
  SELECT c.oid, c.relowner FROM pg_class c
  JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname=$1 AND left(c.relname,6)='glyph_' AND c.relkind IN ('r','p')
), actor AS (SELECT * FROM pg_roles WHERE rolname=current_user)
SELECT count(*)::int AS table_count,
  (SELECT rolsuper FROM actor) AS superuser,
  (SELECT rolbypassrls FROM actor) AS bypass_rls,
  (SELECT rolcreaterole FROM actor) AS create_roles,
  (SELECT rolcreatedb FROM actor) AS create_databases,
  EXISTS(SELECT 1 FROM pg_roles WHERE (rolsuper OR rolbypassrls OR rolcreaterole)
    AND pg_has_role(oid,'MEMBER')) AS elevated_membership,
  EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE p.prosecdef AND n.nspname NOT IN ('pg_catalog','information_schema')
    AND has_function_privilege(p.oid,'EXECUTE')) AS executable_security_definer,
  EXISTS(SELECT 1 FROM pg_database WHERE datname=current_database()
    AND pg_has_role(datdba,'MEMBER')) AS database_owner,
  EXISTS(SELECT 1 FROM pg_namespace WHERE nspname=$1
    AND pg_has_role(nspowner,'MEMBER')) AS schema_owner,
  EXISTS(SELECT 1 FROM pg_namespace WHERE nspname=$1
    AND has_schema_privilege(oid,'CREATE')) AS schema_create,
  coalesce(bool_or(pg_has_role(relowner,'MEMBER')),false) AS table_owner,
  coalesce(bool_or(has_table_privilege(oid,'DELETE')),false) AS can_delete,
  coalesce(bool_or(has_table_privilege(oid,'TRUNCATE')),false) AS can_truncate,
  coalesce(bool_and(has_table_privilege(oid,'SELECT')),false) AS can_select,
  coalesce(bool_and(has_table_privilege(oid,'INSERT')),false) AS can_insert,
  coalesce(bool_and(has_table_privilege(oid,'UPDATE')),false) AS can_update
FROM protected`;

export function evaluateDatabaseAccess(value: unknown) {
  const row = value as Record<string, unknown> | null;
  if (
    !row ||
    !Number.isInteger(row.table_count) ||
    Number(row.table_count) < 0 ||
    [...forbidden, ...required].some((key) => typeof row[key] !== 'boolean')
  )
    return { safe: false, tableCount: 0, issues: ['invalid_catalog_result'] };
  const issues: string[] = forbidden.filter((key) => row[key] === true);
  issues.push(...required.filter((key) => row[key] === false));
  if (row.table_count === 0) issues.push('no_protected_tables');
  return {
    safe: issues.length === 0,
    tableCount: Number(row.table_count),
    issues,
  };
}

export async function inspectDatabaseAccess(
  client: CatalogClient,
  schema = 'public',
) {
  const { rows } = await client.query(catalogSql, [schema]);
  return evaluateDatabaseAccess(rows.length === 1 ? rows[0] : null);
}
