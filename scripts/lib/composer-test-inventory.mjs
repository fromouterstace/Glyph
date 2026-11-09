import assert from 'node:assert/strict';
import { resolve } from 'node:path';

// These suites protect distinct business boundaries; a broad glob alone can
// silently pass after one of them is deleted or excluded from discovery.
export const composerSuites = {
  ui: [
    'artifacts/glyph/tests/label-import.test.tsx',
    'artifacts/glyph/tests/contact-profile.test.tsx',
    'artifacts/glyph/tests/contact-navigation.test.tsx',
    'artifacts/glyph/tests/auth-form.test.tsx',
    'artifacts/glyph/tests/auth-gate.test.tsx',
    'artifacts/glyph/tests/protected-page.test.tsx',
    'artifacts/glyph/tests/extension-download.test.tsx',
    'artifacts/glyph/tests/gmail-authorization.test.tsx',
    'artifacts/glyph/tests/gmail-sync.test.tsx',
    'artifacts/glyph/tests/message-summary.test.tsx',
    'artifacts/glyph/tests/email-list-panel.test.tsx',
    'artifacts/glyph/tests/forms.test.tsx',
    'artifacts/glyph/tests/rich-editor.test.tsx',
    'artifacts/glyph/tests/attachments.test.tsx',
    'artifacts/glyph/tests/composer-delivery.test.tsx',
  ],
  integration: [
    'scripts/tests/contact-detail.integration.test.mjs',
    'scripts/tests/gmail-label-import.integration.test.mjs',
    'scripts/tests/gmail-oauth.integration.test.mjs',
    'scripts/tests/mailbox-identity.integration.test.mjs',
    'scripts/tests/clerk-proxy.integration.test.mjs',
    'scripts/tests/system-admin.integration.test.mjs',
    'scripts/tests/tracking-journey.integration.test.mjs',
    'scripts/tests/rich-composer.integration.test.mjs',
    'scripts/tests/web-recipients.integration.test.mjs',
    'scripts/tests/composer-origin.integration.test.mjs',
    'scripts/tests/message-lifecycle.integration.test.mjs',
    'scripts/tests/owner-isolation.integration.test.mjs',
    'scripts/tests/connector-failures.integration.test.mjs',
  ],
};

export const requiredRunners = {
  'test:contracts': [
    'test-gmail-extension.mjs',
    'test-gmail-background.mjs',
    'tracking-origin.contract.test.mjs',
    'monitoring.contract.test.mjs',
    'casing.contract.test.mjs',
    'web-serving.contract.test.mjs',
    'contact-navigation.contract.test.mjs',
  ],
  'test:integration': [
    'database.integration.test.mjs',
    'test:services',
    'test:process',
  ],
  'test:process': ['server-process.integration.test.mjs'],
  'test:services': ['vitest.integration.config.mts'],
  'test:tracking-http': ['test-tracking-http.mjs'],
  'test:gmail-extension': [
    'test-gmail-extension.mjs',
    'test-gmail-background.mjs',
  ],
};

export function assertRunnerInventory(scripts) {
  for (const [runner, required] of Object.entries(requiredRunners)) {
    const tokens = (scripts[runner] ?? '').split(/\s+/);
    for (const suite of required)
      assert.ok(
        tokens.includes(suite),
        `${runner} omits required test boundary: ${suite}`,
      );
  }
  assert.ok(
    scripts['test:gmail-extension']?.startsWith('tsx --test '),
    'Standalone extension contracts require the TypeScript-aware runner',
  );
}

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
