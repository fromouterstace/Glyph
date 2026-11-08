import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { assertDevelopmentTarget } from './lib/database-safety.mjs';

assertDevelopmentTarget(process.env, process.argv.slice(2));
const root = fileURLToPath(new URL('..', import.meta.url));
const gate = spawnSync(
  process.execPath,
  ['scripts/check-database-safety.mjs'],
  {
    cwd: root,
    stdio: 'inherit',
  },
);
if (gate.status !== 0) process.exit(1);
const result = spawnSync(
  'pnpm',
  ['exec', 'drizzle-kit', 'push', '--config', './drizzle.config.ts'],
  {
    cwd: `${root}/lib/db`,
    stdio: 'inherit',
  },
);
process.exitCode = result.status ?? 1;
