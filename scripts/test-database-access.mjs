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

test('connection selection and fixture isolation fail closed without connecting', () => {
  const fallback = 'postgresql://fixture:fixture@127.0.0.1:1/fallback';
  const runtime = 'postgresql://fixture:fixture@127.0.0.1:1/runtime';
  for (const [overrides, expected, status] of [
    [{ GLYPH_RUNTIME_DATABASE_URL: runtime }, runtime, 0],
    [{}, fallback, 0],
    [{ GLYPH_REQUIRE_RESTRICTED_DATABASE: '1' }, fallback, 1],
    [
      { GLYPH_DATABASE_TESTS: '1', GLYPH_RUNTIME_DATABASE_URL: runtime },
      runtime,
      1,
    ],
  ]) {
    const env = {
      ...process.env,
      NODE_ENV: 'test',
      DATABASE_URL: fallback,
      GLYPH_REQUIRE_RESTRICTED_DATABASE: '0',
      GLYPH_DATABASE_TESTS: '0',
    };
    delete env.GLYPH_RUNTIME_DATABASE_URL;
    Object.assign(env, overrides);
    const result = spawnSync(
      'pnpm',
      [
        'exec',
        'tsx',
        '-e',
        `import('@workspace/db').then(async m => {
          console.log(m.pool.options.connectionString === ${JSON.stringify(expected)});
          await m.pool.end();
        }).catch(() => { console.error('CONFIG_REJECTED'); process.exitCode = 1; });`,
      ],
      {
        cwd: fileURLToPath(new URL('.', import.meta.url)),
        env,
        encoding: 'utf8',
        timeout: 15_000,
      },
    );
    assert.equal(result.status, status, result.stderr);
    assert.match(
      result.stdout + result.stderr,
      status ? /CONFIG_REJECTED/ : /true/,
    );
    assert.doesNotMatch(result.stdout + result.stderr, /postgresql:\/\//);
  }
});
