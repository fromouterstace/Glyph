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
];

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
