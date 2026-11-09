import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema';

const { Pool } = pg;

const requireRestricted = process.env.GLYPH_REQUIRE_RESTRICTED_DATABASE === '1';
const databaseUrl = requireRestricted
  ? process.env.GLYPH_RUNTIME_DATABASE_URL
  : process.env.DATABASE_URL;

if (requireRestricted && process.env.GLYPH_DATABASE_TESTS === '1') {
  throw new Error(
    'Isolated database fixtures cannot use the restricted runtime connection.',
  );
}

if (requireRestricted && !process.env.GLYPH_RUNTIME_DATABASE_URL) {
  throw new Error(
    'GLYPH_RUNTIME_DATABASE_URL is required when restricted database access is enforced.',
  );
}

if (!databaseUrl) {
  throw new Error(
    'A database connection must be configured. Did you forget to provision a database?',
  );
}

export const pool = new Pool({
  connectionString: databaseUrl,
  connectionTimeoutMillis: requireRestricted ? 5_000 : 0,
});
export const db = drizzle(pool, { schema });

export * from './schema';
