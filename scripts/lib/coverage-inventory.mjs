import { resolve } from 'node:path';
import { criticalModules } from './test-policy.mjs';

export const criticalSources = [
  ...criticalModules.map(
    (name) => `../artifacts/api-server/src/lib/${name}.ts`,
  ),
  '../artifacts/glyph/src/lib/tracking-origin.ts',
];

export function assertCoverageInventory(lcov, cwd) {
  const reported = new Set(
    lcov
      .split(/\r?\n/)
      .filter((line) => line.startsWith('SF:'))
      .map((line) => resolve(cwd, line.slice(3))),
  );
  const missing = criticalSources.filter(
    (source) => !reported.has(resolve(cwd, source)),
  );
  if (missing.length)
    throw new Error(
      `Critical coverage sources missing:\n${missing.join('\n')}`,
    );
}
