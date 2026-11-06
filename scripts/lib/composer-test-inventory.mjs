import assert from 'node:assert/strict';
import { resolve } from 'node:path';

// These suites protect distinct business boundaries; a broad glob alone can
// silently pass after one of them is deleted or excluded from discovery.
export const composerSuites = {
  ui: [
    'artifacts/glyph/tests/forms.test.tsx',
    'artifacts/glyph/tests/rich-editor.test.tsx',
    'artifacts/glyph/tests/attachments.test.tsx',
    'artifacts/glyph/tests/composer-delivery.test.tsx',
  ],
  integration: [
    'scripts/tests/rich-composer.integration.test.mjs',
    'scripts/tests/web-recipients.integration.test.mjs',
    'scripts/tests/composer-origin.integration.test.mjs',
    'scripts/tests/message-lifecycle.integration.test.mjs',
    'scripts/tests/owner-isolation.integration.test.mjs',
    'scripts/tests/connector-failures.integration.test.mjs',
  ],
};

export function assertComposerInventory(layer, discovered, root) {
  assert.ok(composerSuites[layer], `Unknown composer test layer: ${layer}`);
  assert.ok(Array.isArray(discovered), 'Invalid Vitest discovery report');
  const files = new Set(discovered.map(({ file }) => resolve(root, file)));
  const missing = composerSuites[layer].filter(
    (file) => !files.has(resolve(root, file)),
  );
  assert.equal(
    missing.length,
    0,
    `Required composer ${layer} suites missing from discovery:\n${missing.join('\n')}`,
  );
}
