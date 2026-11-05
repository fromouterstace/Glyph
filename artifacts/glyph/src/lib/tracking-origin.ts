/** Deployment configuration, verified using the publishing service. Not activity data. */
export const PUBLISHED_GLYPH_ORIGIN = 'https://glyph-mail.replit.app';

export function extensionConnectionOrigin(currentOrigin: string): string {
  const url = new URL(currentOrigin);
  return url.protocol !== 'https:' ||
    url.hostname.endsWith('.replit.dev') ||
    url.hostname === 'localhost' ||
    url.hostname.endsWith('.localhost') ||
    url.hostname === '127.0.0.1'
    ? PUBLISHED_GLYPH_ORIGIN
    : url.origin;
}

/** Match server policy: never send tracking to a preview or another database. */
export function validTrackingOrigin(
  value: string,
  currentOrigin?: string,
): boolean {
  if (!value.trim()) return true;
  try {
    const url = new URL(value.trim());
    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      url.pathname === '/' &&
      !url.search &&
      !url.hash &&
      !url.hostname.endsWith('.replit.dev') &&
      url.hostname !== 'localhost' &&
      !url.hostname.endsWith('.localhost') &&
      url.hostname !== '127.0.0.1' &&
      (!currentOrigin || url.origin === new URL(currentOrigin).origin)
    );
  } catch {
    return false;
  }
}
