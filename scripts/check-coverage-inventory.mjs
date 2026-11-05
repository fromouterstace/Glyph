import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { assertCoverageInventory } from './lib/coverage-inventory.mjs';

try {
  if (!process.argv[2]) throw new Error('An LCOV report path is required.');
  assertCoverageInventory(
    await readFile(process.argv[2], 'utf8'),
    fileURLToPath(new URL('.', import.meta.url)),
  );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
