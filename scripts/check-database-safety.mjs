import { readdir, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  digest,
  assertReview,
  assertSchemaInventory,
  assertSafePlan,
  assertNoSchemaExecution,
  assertImmutable,
  assertExpandOnly,
  assertShape,
} from './lib/database-safety.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const directory = 'lib/db/schema-reviews';
const files = (await readdir(`${root}/${directory}`)).sort();
const reviews = files.filter((name) => /^\d{4}\.json$/.test(name));
if (!reviews.length) throw new Error('Missing versioned schema baseline.');
if (files.includes('0001.sql'))
  throw new Error(
    'An existing-schema baseline must not contain executable SQL.',
  );
let last;
let lastShape = {};
for (const [index, name] of reviews.entries()) {
  const record = JSON.parse(
    await readFile(`${root}/${directory}/${name}`, 'utf8'),
  );
  assertReview(record, index);
  const shape = JSON.parse(
    await readFile(
      `${root}/${directory}/${name.replace('.json', '.shape.json')}`,
      'utf8',
    ),
  );
  assertExpandOnly(lastShape, shape);
  lastShape = shape;
  if (name !== `${String(record.version).padStart(4, '0')}.json`)
    throw new Error('Schema review filename/version mismatch.');
  if (record.version > 1) {
    const sql = await readFile(
      `${root}/${directory}/${name.replace('.json', '.sql')}`,
      'utf8',
    );
    assertSafePlan(sql);
    if (digest(sql) !== record.planSha256)
      throw new Error('SQL plan digest mismatch.');
  }
  last = record;
}
if (
  files.some(
    (name) =>
      !reviews.includes(name) &&
      !reviews.includes(name.replace(/(?:\.shape\.json|\.sql)$/, '.json')),
  )
)
  throw new Error('Untracked or unsupported schema review file.');

async function schemaFiles(relative) {
  const result = {};
  for (const entry of await readdir(`${root}/${relative}`, {
    withFileTypes: true,
  })) {
    const path = `${relative}/${entry.name}`;
    if (entry.isDirectory()) Object.assign(result, await schemaFiles(path));
    else result[path] = digest(await readFile(`${root}/${path}`));
  }
  return result;
}
assertSchemaInventory(last.schema, await schemaFiles('lib/db/src/schema'));
const currentShape = execFileSync(
  'pnpm',
  [
    '--filter',
    '@workspace/scripts',
    'exec',
    'tsx',
    '../lib/db/schema-review.mjs',
  ],
  { cwd: root, encoding: 'utf8', timeout: 30_000 },
);
assertShape(lastShape, JSON.parse(currentShape));

// CI compares existing review records AND plans with the PR/push base commit.
const base = process.env.GLYPH_SCHEMA_BASE;
if (base && !/^0+$/.test(base)) {
  if (!/^[a-f0-9]{40}$/.test(base))
    throw new Error('Invalid schema base commit.');
  const oldFiles = execFileSync(
    'git',
    ['ls-tree', '-r', '--name-only', base, directory],
    { cwd: root, encoding: 'utf8' },
  )
    .trim()
    .split('\n')
    .filter(Boolean);
  for (const path of oldFiles) {
    const old = execFileSync('git', ['show', `${base}:${path}`], { cwd: root });
    assertImmutable(old, await readFile(`${root}/${path}`));
  }
}

async function checkExecutionPaths(relative) {
  for (const entry of await readdir(`${root}/${relative}`, {
    withFileTypes: true,
  })) {
    if (['node_modules', 'dist', '.git', 'tests'].includes(entry.name))
      continue;
    const path = `${relative}/${entry.name}`;
    if (entry.isDirectory()) await checkExecutionPaths(path);
    else if (/\.(?:ts|mjs|js|toml)$/.test(path) && !/\.test\./.test(path))
      assertNoSchemaExecution(await readFile(`${root}/${path}`, 'utf8'));
  }
}
for (const directory of ['artifacts/api-server/src', 'artifacts/glyph/server'])
  await checkExecutionPaths(directory);
for (const artifact of ['glyph', 'api-server']) {
  assertNoSchemaExecution(
    await readFile(
      `${root}/artifacts/${artifact}/.replit-artifact/artifact.toml`,
      'utf8',
    ),
  );
  const { scripts } = JSON.parse(
    await readFile(`${root}/artifacts/${artifact}/package.json`, 'utf8'),
  );
  assertNoSchemaExecution(Object.values(scripts).join('\n'));
}
assertNoSchemaExecution(await readFile(`${root}/.replit`, 'utf8'));
console.log(
  `Database safety: ${reviews.length} version(s), schema inventory and SQL plans verified. No database connection made.`,
);
