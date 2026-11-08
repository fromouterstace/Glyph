import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import {
  assertSafePlan,
  assertReview,
  assertSchemaInventory,
  assertDevelopmentTarget,
  assertNoSchemaExecution,
  assertImmutable,
  assertExpandOnly,
  assertShape,
} from './lib/database-safety.mjs';

test('additive review SQL is accepted without connecting to a database', () => {
  assert.doesNotThrow(() =>
    assertSafePlan(
      'CREATE TABLE example (id text PRIMARY KEY); CREATE INDEX example_id ON example (id);',
    ),
  );
});

test('destructive and opaque SQL fails closed including mixed case and multi-statements', () => {
  for (const sql of [
    '',
    'DROP TABLE glyph_messages;',
    'tRuNcAtE glyph_events;',
    'ALTER TABLE glyph_messages DROP COLUMN body;',
    'ALTER TABLE glyph_messages RENAME TO messages;',
    'ALTER TABLE glyph_messages ALTER COLUMN body TYPE varchar(10);',
    'DELETE FROM glyph_events;',
    "UPDATE glyph_messages SET body = '';",
    'DO $$ BEGIN END $$;',
    '/* harmless */ DROP TABLE users;',
    'CREATE TABLE x (id text); DROP TABLE glyph_events;',
    'CREATE TABLE x AS SELECT * FROM glyph_messages;',
    'SELECT 1;',
    '\\i other.sql',
    '-- concealed\nCREATE TABLE x (id text);',
  ])
    assert.throws(() => assertSafePlan(sql), undefined, sql);
});

test('schema review sequence and evidence are mandatory; no contract bypass', () => {
  const valid = {
    version: 2,
    phase: 'expand',
    reason: 'Add new structure',
    compatibility: 'Old code continues reading old structure',
    recovery: 'Isolated rehearsal evidence reference',
    schema: { file: 'digest' },
  };
  assert.doesNotThrow(() => assertReview(valid, 1));
  for (const invalid of [
    { version: 3 },
    { phase: 'contract' },
    { phase: 'baseline' },
    { reason: '' },
    { compatibility: '' },
    { recovery: '' },
    { schema: {} },
  ])
    assert.throws(() => assertReview({ ...valid, ...invalid }, 1));
});

test('schema omissions, removals and changed hashes cannot produce a green inventory', () => {
  const current = { a: '1', b: '2' };
  assert.doesNotThrow(() => assertSchemaInventory({ b: '2', a: '1' }, current));
  for (const wrong of [{ a: '1' }, { ...current, c: '3' }, { a: '9', b: '2' }])
    assert.throws(() => assertSchemaInventory(wrong, current));
  assert.doesNotThrow(() =>
    assertImmutable(Buffer.from('old'), Buffer.from('old')),
  );
  assert.throws(() =>
    assertImmutable(Buffer.from('old'), Buffer.from('edited')),
  );
});

test('actual schema shape cannot conceal removed tables, columns or narrowing', () => {
  const before = { messages: { id: 'text!', body: 'text?' } };
  for (const after of [
    {},
    { messages: { id: 'text!' } },
    { messages: { id: 'text!', body: 'varchar(10)?' } },
    { messages: { id: 'text!', body: 'text!' } },
  ])
    assert.throws(() => assertExpandOnly(before, after));
  assert.doesNotThrow(() =>
    assertExpandOnly(before, {
      ...before,
      other: { id: 'text!' },
    }),
  );
  assert.throws(() => assertShape(before, {}));
  assert.doesNotThrow(() =>
    assertShape(before, {
      messages: { body: 'text?', id: 'text!' },
    }),
  );
});

test('development push rejects production, missing target and force flags before spawning', () => {
  assert.doesNotThrow(() =>
    assertDevelopmentTarget({ GLYPH_DATABASE_TARGET: 'development' }, []),
  );
  for (const [env, args] of [
    [{}, []],
    [{ GLYPH_DATABASE_TARGET: 'production' }, []],
    [{ NODE_ENV: 'production', GLYPH_DATABASE_TARGET: 'development' }, []],
    [{ GLYPH_DATABASE_TARGET: 'development' }, ['--force']],
  ])
    assert.throws(() => assertDevelopmentTarget(env, args));
  const result = spawnSync(
    process.execPath,
    ['scripts/database-dev-push.mjs'],
    {
      cwd: new URL('..', import.meta.url),
      env: { ...process.env, NODE_ENV: 'production' },
      encoding: 'utf8',
    },
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Production uses Publish only/);
});

test('runtime and deployment DDL and migration commands are blocked', () => {
  for (const source of [
    'drizzle-kit push',
    'drizzle-kit migrate',
    'prisma migrate deploy',
    'prisma db push',
    'pnpm run push-force',
    'db.execute(sql`CREATE TABLE IF NOT EXISTS messages (id text)`)',
    'ALTER TABLE glyph_messages ADD body text',
  ])
    assert.throws(() => assertNoSchemaExecution(source));
  assert.doesNotThrow(() => assertNoSchemaExecution('SELECT 1'));
});

test('database safety gate remains mandatory in quality, build, CI and post-merge', async () => {
  const read = async (path) =>
    readFile(new URL(`../${path}`, import.meta.url), 'utf8');
  const root = JSON.parse(await read('package.json'));
  assert.ok(root.scripts.check.startsWith('pnpm check:database &&'));
  assert.ok(root.scripts.build.startsWith('pnpm check &&'));
  const db = JSON.parse(await read('lib/db/package.json'));
  assert.equal(db.scripts.push, 'node ../../scripts/database-dev-push.mjs');
  assert.equal(db.scripts['push-force'], undefined);
  const merge = await read('scripts/post-merge.sh');
  assert.match(merge, /pnpm check:database/);
  assert.doesNotMatch(merge, /pnpm .* push/);
  const workflow = await read('.github/workflows/quality.yml');
  assert.match(workflow, /GLYPH_SCHEMA_BASE:/);
  assert.match(workflow, /fetch-depth: 0/);
});
