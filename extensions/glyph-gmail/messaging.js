// Shared by the isolated Gmail content script and the extension popup.
// An extension reload can invalidate scripts in tabs that are already open.
(() => {
  const unavailable = () => {
    const error = new Error(
      'Glyph was updated or its extension connection was lost. Wait until Gmail saves your draft, then reload Gmail. If this persists, reload Glyph in chrome://extensions and reconnect its popup.',
    );
    error.name = 'GlyphExtensionUnavailable';
    return error;
  };
  const available = () => {
    try {
      const runtime = globalThis.chrome?.runtime;
      return !!runtime?.id && typeof runtime.sendMessage === 'function';
    } catch {
      return false;
    }
  };
  const lostConnection = (message) =>
    /extension context invalidated|receiving end does not exist|could not establish connection|message (?:port|channel).*closed|sendMessage/i.test(
      message ?? '',
    );
  const send = async (message) => {
    if (!available()) throw unavailable();
    try {
      const response = await globalThis.chrome.runtime.sendMessage(message);
      if (response === undefined) throw unavailable();
      if (response?.ok === false && lostConnection(response.error))
        throw unavailable();
      return response;
    } catch (error) {
      if (
        error?.name === 'GlyphExtensionUnavailable' ||
        lostConnection(error?.message)
      )
        throw unavailable();
      throw error;
    }
  };
  globalThis.glyphMessaging = { available, send, unavailable };
})();
