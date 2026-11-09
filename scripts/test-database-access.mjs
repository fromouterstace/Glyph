import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  evaluateDatabaseAccess,
  inspectDatabaseAccess,
} from '../artifacts/api-server/src/lib/database-access.ts';

const safe = {
  table_count: 12,
  superuser: false,
  bypass_rls: false,
  create_roles: false,
  create_databases: false,
  elevated_membership: false,
  executable_security_definer: false,
  database_owner: false,
  schema_owner: false,
  schema_create: false,
  table_owner: false,
  can_delete: false,
  can_truncate: false,
  can_select: true,
  can_insert: true,
  can_update: true,
};

test('a restricted writer passes while every excessive privilege fails closed', () => {
  assert.deepEqual(evaluateDatabaseAccess(safe), {
    safe: true,
    tableCount: 12,
    issues: [],
  });
  for (const [key, value] of Object.entries(safe)) {
    if (typeof value !== 'boolean') continue;
    const result = evaluateDatabaseAccess({ ...safe, [key]: !value });
    assert.equal(result.safe, false, key);
    assert.ok(result.issues.includes(key), key);
  }
});

test('empty, malformed and incomplete catalogs never establish protection', () => {
  for (const value of [
    null,
    undefined,
    {},
    [],
    1,
    'safe',
    { ...safe, table_count: -1 },
  ])
    assert.equal(evaluateDatabaseAccess(value).safe, false);
  assert.deepEqual(evaluateDatabaseAccess({ ...safe, table_count: 0 }).issues, [
    'no_protected_tables',
  ]);
  assert.equal(
    evaluateDatabaseAccess({ ...safe, can_delete: 'false' }).safe,
    false,
  );
});

test('catalog inspection binds its schema and does not read or mutate customer rows', async () => {
  const client = {
    query: async (sql, values) => {
      assert.deepEqual(values, ['public']);
      assert.match(sql, /pg_roles/);
      assert.match(sql, /has_table_privilege/);
      assert.doesNotMatch(
        sql,
        /\b(?:DELETE|TRUNCATE|DROP|ALTER|GRANT|REVOKE)\s/i,
      );
      assert.doesNotMatch(sql, /FROM glyph_/);
      return { rows: [safe] };
    },
  };
  assert.equal((await inspectDatabaseAccess(client)).safe, true);
  for (const rows of [[], [safe, safe]])
    assert.equal(
      (
        await inspectDatabaseAccess(
          { query: async () => ({ rows }) },
          'fixture',
        )
      ).safe,
      false,
    );
  await assert.rejects(
    inspectDatabaseAccess({
      query: async () => {
        throw new Error('unavailable');
      },
    }),
    /unavailable/,
  );
});

test('the permission preflight CLI fails closed without printing connection details', () => {
  const result = spawnSync(
    'pnpm',
    ['exec', 'tsx', 'check-database-access.mjs'],
    {
      cwd: fileURLToPath(new URL('.', import.meta.url)),
      env: {
        ...process.env,
        DATABASE_URL: '',
        GLYPH_RUNTIME_DATABASE_URL: '',
        GLYPH_REQUIRE_RESTRICTED_DATABASE: '0',
      },
      encoding: 'utf8',
      timeout: 15_000,
    },
  );
  assert.equal(result.status, 1);
  const output = result.stdout + result.stderr;
  assert.match(output, /database_access_check_failed/);
  assert.doesNotMatch(output, /DATABASE_URL must|postgresql:\/\//);
});

test('restricted mode cannot fall back to the owner URL or run destructive fixtures', () => {
  for (const overrides of [
    {
      GLYPH_RUNTIME_DATABASE_URL: '',
      GLYPH_DATABASE_TESTS: '0',
    },
    {
      GLYPH_RUNTIME_DATABASE_URL: 'postgresql://fixture.invalid/runtime',
      GLYPH_DATABASE_TESTS: '1',
    },
  ]) {
    const result = spawnSync(
      'pnpm',
      [
        'exec',
        'tsx',
        '-e',
        "import('../lib/db/src/index.ts').catch(() => { process.exitCode = 1; })",
      ],
      {
        cwd: fileURLToPath(new URL('.', import.meta.url)),
        env: {
          ...process.env,
          DATABASE_URL: 'postgresql://fixture.invalid/owner',
          GLYPH_REQUIRE_RESTRICTED_DATABASE: '1',
          ...overrides,
        },
        encoding: 'utf8',
        timeout: 15_000,
      },
    );
    assert.equal(result.status, 1);
    assert.doesNotMatch(result.stdout + result.stderr, /postgresql:\/\//);
  }
});

test('only explicitly enforced runtime mode selects the separate connection', () => {
  for (const flag of ['0', '1']) {
    const result = spawnSync(
      'pnpm',
      [
        'exec',
        'tsx',
        '-e',
        `import('../lib/db/src/index.ts').then(async ({ pool }) => {
          const expected = process.env.GLYPH_REQUIRE_RESTRICTED_DATABASE === '1'
            ? process.env.GLYPH_RUNTIME_DATABASE_URL : process.env.DATABASE_URL;
          if (pool.options.connectionString !== expected) process.exitCode = 1;
          await pool.end();
        }).catch(() => { process.exitCode = 1; })`,
      ],
      {
        cwd: fileURLToPath(new URL('.', import.meta.url)),
        env: {
          ...process.env,
          DATABASE_URL: 'postgresql://fixture.invalid/owner',
          GLYPH_RUNTIME_DATABASE_URL: 'postgresql://fixture.invalid/runtime',
          GLYPH_REQUIRE_RESTRICTED_DATABASE: flag,
          GLYPH_DATABASE_TESTS: '0',
        },
        encoding: 'utf8',
        timeout: 15_000,
      },
    );
    assert.equal(result.status, 0);
  }
});
