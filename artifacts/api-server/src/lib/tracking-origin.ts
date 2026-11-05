/** Keep preparation, tracking and the owning database on one public origin. */
export function resolveTrackingOrigin(
  requestOrigin: string | undefined,
  configuredOrigin = '',
): string {
  const parse = (value: string) => {
    const url = new URL(value.trim());
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash ||
      url.hostname.endsWith('.replit.dev') ||
      url.hostname === 'localhost' ||
      url.hostname.endsWith('.localhost') ||
      url.hostname === '127.0.0.1'
    )
      throw new Error('Not a public production origin');
    return url.origin;
  };
  try {
    const origin = parse(requestOrigin ?? '');
    if (configuredOrigin.trim() && parse(configuredOrigin) !== origin)
      throw new Error('Tracking would use a different database');
    return origin;
  } catch {
    throw new Error(
      'Use the published Glyph app and reconnect the Gmail extension there. Tracking must use the same public HTTPS origin as the connection tab; preview URLs and cross-environment tracking are blocked. Clear any different tracking URL in Settings.',
    );
  }
}
