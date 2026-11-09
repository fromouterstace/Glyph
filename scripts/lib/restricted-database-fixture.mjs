import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';

// Temporary role, grants and fixture writes are rolled back together. No role
// or privilege is installed in an application schema or production database.
export async function withRestrictedWriter(database, work) {
  assert.equal(process.env.GLYPH_DATABASE_TESTS, '1');
  assert.notEqual(process.env.NODE_ENV, 'production');
  const client = await database.connect();
  try {
    const { rows } = await client.query('SELECT current_schema() AS schema');
    const schema = rows[0].schema;
    assert.match(schema, /^glyph_test_[a-f0-9]{32}$/);
    const role = `glyph_fixture_${randomUUID().replaceAll('-', '')}`;
    await client.query('BEGIN');
    await client.query(
      `CREATE ROLE "${role}" NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS`,
    );
    await client.query(`GRANT USAGE ON SCHEMA "${schema}" TO "${role}"`);
    await client.query(
      `GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA "${schema}" TO "${role}"`,
    );
    await client.query(`SET LOCAL ROLE "${role}"`);
    await work(client, schema);
  } finally {
    try {
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  }
}
