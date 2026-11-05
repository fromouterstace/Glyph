(() => {
  const publishedOrigin = 'https://glyph-mail.replit.app';

  function appOrigin(value) {
    if (typeof value !== 'string')
      throw new Error('Connect only to the official published Glyph app.');

    let url;
    try {
      url = new URL(value.trim());
    } catch {
      throw new Error('Enter the official Glyph HTTPS origin only.');
    }

    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash ||
      url.origin !== publishedOrigin
    )
      throw new Error(
        `Only the official published Glyph app (${publishedOrigin}) is trusted.`,
      );

    return url.origin;
  }

  function permissionPattern(value) {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && url.origin !== 'null'
        ? `${url.origin}/*`
        : null;
    } catch {
      return null;
    }
  }

  globalThis.GlyphOriginPolicy = Object.freeze({
    publishedOrigin,
    appOrigin,
    permissionPattern,
  });
})();
