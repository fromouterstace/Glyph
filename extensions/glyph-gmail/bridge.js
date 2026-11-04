// Runs ONLY on the app origin explicitly approved in the extension popup.
// Browser cookies remain in the Glyph tab. No credentials leave this origin.
(() => {
  if (globalThis.__glyphBridge) return;
  globalThis.__glyphBridge = true;
  const routes = {
    connection: ["GET", "/api/glyph/connection"],
    settings: ["GET", "/api/glyph/settings"],
    activity: ["GET", "/api/glyph/activity"],
    prepare: ["POST", "/api/glyph/native/prepare"],
    sync: ["POST", "/api/glyph/native/sync"],
  };
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== chrome.runtime.id || message?.channel !== "glyph:bridge") return;
    if (message.action === "ping") { respond({ ok: true }); return; }
    const route = routes[message.action];
    if (!route) { respond({ ok: false, error: "Unsupported Glyph request." }); return; }
    const [method, path] = route;
    fetch(new URL(path, location.origin), {
      method, credentials: "include", cache: "no-store",
      headers: { "Content-Type": "application/json" },
      ...(method === "POST" && message.data ? { body: JSON.stringify(message.data) } : {}),
    }).then(async (response) => {
      const data = await response.json();
      respond(response.ok ? { ok: true, data } : { ok: false, error: data.error || "Glyph request failed.", status: response.status });
    }).catch(() => respond({ ok: false, error: "Cannot reach Glyph. Check the connection tab." }));
    return true;
  });
})();
