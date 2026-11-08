export const criticalModules = [
  'native-verification',
  'reply-matching',
  'tracking-origin',
  'tracking-pixel',
  'gmail-rate-limit',
  'reply-header-scan',
  'request-log',
  'message-presentation',
  'database-readiness',
  'composer-policy',
  'email-html',
  'mime-message',
  'email-content',
  'html-links',
  'web-recipients',
  'system-admin',
];

// Discovery is a separate invariant from coverage percentages: absent tests
// must not silently reduce the suite that produces a green report.
export const requiredUnitSuites = [
  'test-document-security.mjs',
  'test-built-assets.mjs',
  'test-composer-delivery.mjs',
  'test-composer-test-inventory.mjs',
  'test-coverage-inventory.mjs',
  'test-database-readiness.mjs',
  'test-email-content.mjs',
  'test-extension-archive.mjs',
  'test-gmail-rate-limit.mjs',
  'test-health-probe.mjs',
  'test-message-presentation.mjs',
  'test-native-verification.mjs',
  'test-quality-policy.mjs',
  'test-release-regression.mjs',
  'test-reply-matching.mjs',
  'test-request-log.mjs',
  'test-rich-composer.mjs',
  'test-route-chunks.mjs',
  'test-smoke-assets.mjs',
  'test-smoke-checks.mjs',
  'test-system-admin.mjs',
  'test-tracking-origin.mjs',
  'test-tracking-pixel.mjs',
  'test-web-recipients.mjs',
];

export function assertUnitInventory(files) {
  const missing = requiredUnitSuites.filter((name) => !files.includes(name));
  if (missing.length)
    throw new Error(`Required unit suites missing: ${missing.join(', ')}`);
}

export function unitFiles(names) {
  return names
    .filter(
      (name) =>
        (/^test-.*\.mjs$/.test(name) || /\.test\.mjs$/.test(name)) &&
        !name.includes('.integration.') &&
        !name.includes('.contract.') &&
        !name.includes('.e2e.') &&
        name !== 'test-tracking-http.mjs' &&
        !['test-gmail-background.mjs', 'test-gmail-extension.mjs'].includes(
          name,
        ),
    )
    .sort();
}
