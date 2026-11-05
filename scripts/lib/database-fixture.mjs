import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { pool } from '@workspace/db';

let sequence = 0;
export const fixtureId = () =>
  `00000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}`;

// This pool belongs only to the test process. Never connect to the running app.
export async function isolatedDatabase() {
  if (
    process.env.GLYPH_DATABASE_TESTS !== '1' ||
    process.env.NODE_ENV === 'production'
  )
    throw new Error(
      'Database fixtures require GLYPH_DATABASE_TESTS=1 outside production.',
    );
  const schema = `glyph_test_${randomUUID().replaceAll('-', '')}`;
  pool.options.options = `-c search_path=${schema} -c statement_timeout=5000`;
  let created = false;
  const close = async () => {
    try {
      if (created) await pool.query(`DROP SCHEMA "${schema}" CASCADE`);
    } finally {
      await pool.end();
    }
  };
  try {
    await pool.query(`CREATE SCHEMA "${schema}"`);
    created = true;
    const result = await pool.query('SELECT current_schema() AS schema');
    if (result.rows[0].schema !== schema)
      throw new Error('Database isolation failed before DDL execution.');
    const ddl = execFileSync(
      'pnpm',
      [
        'exec',
        'drizzle-kit',
        'export',
        '--dialect',
        'postgresql',
        '--schema',
        './src/schema/glyph.ts',
      ],
      {
        cwd: fileURLToPath(new URL('../../lib/db/', import.meta.url)),
        encoding: 'utf8',
        timeout: 30_000,
      },
    );
    // Export uses explicit public references for foreign keys. Retarget only
    // this generated DDL, never the application's schema or connection string.
    await pool.query(ddl.replaceAll('"public".', `"${schema}".`));
    return { query: pool.query.bind(pool), close };
  } catch (error) {
    await close();
    throw error;
  }
}

export async function messageFixture(sql, overrides = {}) {
  const message = {
    id: fixtureId(),
    token: sequence.toString(16).padStart(48, '0'),
    status: 'sent',
    opens: true,
    clicks: true,
    source: 'web',
    ownerId: 'fixture-owner',
    ...overrides,
  };
  await sql(
    `INSERT INTO glyph_messages
      (id,owner_id,recipient_email,recipient_name,subject,body,pixel_token,rfc_message_id,status,track_opens,track_clicks,delivery_source)
      VALUES ($1,$8,'recipient@example.invalid','Recipient','Fixture subject','Fixture body',$2,$3,$4,$5,$6,$7)`,
    [
      message.id,
      message.token,
      `<${message.id}@example.invalid>`,
      message.status,
      message.opens,
      message.clicks,
      message.source,
      message.ownerId,
    ],
  );
  return message;
}
