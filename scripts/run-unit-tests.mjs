import { readdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  criticalModules,
  unitFiles,
  assertUnitInventory,
} from './lib/test-policy.mjs';
import { assertCoverageInventory } from './lib/coverage-inventory.mjs';

const cwd = fileURLToPath(new URL('.', import.meta.url));
const files = unitFiles(await readdir(cwd));
assertUnitInventory(files);
if (!files.length)
  throw new Error('No unit tests discovered; refusing a green gate.');
const directory = await mkdtemp(join(tmpdir(), 'glyph-unit-coverage-'));
const report = join(directory, 'coverage.lcov');
const result = spawnSync(
  'pnpm',
  [
    'exec',
    'tsx',
    '--test',
    '--experimental-test-coverage',
    '--test-reporter=spec',
    '--test-reporter-destination=stdout',
    '--test-reporter=lcov',
    `--test-reporter-destination=${report}`,
    '--test-coverage-lines=95',
    '--test-coverage-branches=90',
    '--test-coverage-functions=100',
    ...criticalModules.map(
      (name) => `--test-coverage-include=**/lib/${name}.ts`,
    ),
    ...files,
  ],
  { cwd, stdio: 'inherit', timeout: 120_000 },
);
if (result.error) console.error(result.error.message);
let status = result.status ?? 1;
try {
  if (status === 0) {
    assertCoverageInventory(await readFile(report, 'utf8'), cwd);
    console.log('All required critical sources are present in coverage.');
  }
} catch (error) {
  console.error(error.message);
  status = 1;
} finally {
  await rm(directory, { recursive: true, force: true });
}
process.exitCode = status;
