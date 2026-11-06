import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { assertComposerInventory } from './lib/composer-test-inventory.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
try {
  for (const [layer, workspace, config] of [
    ['ui', '@workspace/glyph', 'vitest.config.ts'],
    ['integration', '@workspace/scripts', 'vitest.integration.config.mts'],
  ]) {
    const result = spawnSync(
      'pnpm',
      [
        '--filter',
        workspace,
        'exec',
        'vitest',
        'list',
        '--config',
        config,
        '--filesOnly',
        '--json',
      ],
      {
        cwd: root,
        env: { ...process.env, NODE_ENV: 'test' },
        encoding: 'utf8',
        timeout: 30_000,
      },
    );
    if (result.error || result.status !== 0)
      throw new Error(
        `${layer} composer discovery failed: ${result.error?.message ?? result.stderr}`,
      );
    assertComposerInventory(layer, JSON.parse(result.stdout), root);
  }
  console.log('Required web-composer suites are discovered in both layers.');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
