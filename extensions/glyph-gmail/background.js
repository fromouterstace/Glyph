globalThis.importScripts('trusted-origin.js');

const CHANNEL = 'glyph:background';
const BRIDGE = 'glyph:bridge';
const appOrigin = (value) => globalThis.GlyphOriginPolicy.appOrigin(value);

async function removeUntrustedPermissions() {
  const { origins = [] } = await chrome.permissions.getAll();
  const trusted = new Set([
    'https://mail.google.com/*',
    ...[globalThis.GlyphOriginPolicy.publishedOrigin].map(
      (origin) => `${origin}/*`,
    ),
  ]);
  const untrusted = origins.filter((origin) => !trusted.has(origin));
  if (untrusted.length) await chrome.permissions.remove({ origins: untrusted });
}

async function unregisterBridge() {
  await chrome.scripting
    .unregisterContentScripts({ ids: ['glyph-app-bridge'] })
    .catch(() => {});
}

async function clearStoredConnection(origin) {
  await unregisterBridge();
  const permission = globalThis.GlyphOriginPolicy.permissionPattern(origin);
  if (permission)
    await chrome.permissions.remove({ origins: [permission] }).catch(() => {});
  await chrome.alarms.clear('glyph-poll');
  await chrome.storage.local.remove([
    'origin',
    'seenEvents',
    'lastPoll',
    'mailbox',
  ]);
  await chrome.action.setBadgeText({ text: '' });
}

async function reconcileStoredConnection() {
  const { origin } = await chrome.storage.local.get('origin');
  await unregisterBridge();
  try {
    await removeUntrustedPermissions();
    if (!origin) {
      await chrome.alarms.clear('glyph-poll');
      return;
    }
    const trustedOrigin = appOrigin(origin);
    if (
      !(await chrome.permissions.contains({
        origins: [`${trustedOrigin}/*`],
      }))
    )
      throw new Error(
        'The trusted Glyph host permission is no longer granted.',
      );
    await chrome.scripting.registerContentScripts([
      {
        id: 'glyph-app-bridge',
        matches: [`${trustedOrigin}/*`],
        js: ['bridge.js'],
        runAt: 'document_idle',
        persistAcrossSessions: true,
      },
    ]);
    await chrome.alarms.create('glyph-poll', { periodInMinutes: 0.5 });
  } catch {
    await clearStoredConnection(origin);
  }
}

async function bridge(action, data) {
  const { origin } = await chrome.storage.local.get('origin');
  if (!origin)
    throw new Error('Click the Glyph extension and connect your app first.');
  appOrigin(origin);
  const tabs = await chrome.tabs.query({ url: `${origin}/*` });
  if (!tabs.length)
    throw new Error(
      'Keep your signed-in Glyph connection tab open. Click the extension to reopen it.',
    );
  const tab = tabs.find((t) => t.url?.startsWith(`${origin}/gmail`)) ?? tabs[0];
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['bridge.js'],
    });
    const response = await chrome.tabs.sendMessage(tab.id, {
      channel: BRIDGE,
      action,
      data,
    });
    if (!response?.ok)
      throw new Error(
        response?.error || 'Sign in on your Glyph connection tab.',
      );
    return response.data;
  } catch (error) {
    throw new Error(
      error.message || 'Reload the Glyph connection tab and try again.',
      { cause: error },
    );
  }
}

async function connect(value) {
  const origin = appOrigin(value);
  if (!(await chrome.permissions.contains({ origins: [`${origin}/*`] })))
    throw new Error('Allow access to your Glyph app to connect.');
  const previous = await chrome.storage.local.get('origin');
  await removeUntrustedPermissions();
  await unregisterBridge();
  await chrome.scripting.registerContentScripts([
    {
      id: 'glyph-app-bridge',
      matches: [`${origin}/*`],
      js: ['bridge.js'],
      runAt: 'document_idle',
      persistAcrossSessions: true,
    },
  ]);
  await chrome.storage.local.set({ origin });
  if (previous.origin !== origin)
    await chrome.storage.local.remove(['seenEvents', 'lastPoll', 'mailbox']);
  const tabs = await chrome.tabs.query({ url: `${origin}/*` });
  if (tabs.length)
    await chrome.tabs.update(tabs[0].id, {
      active: true,
      url: `${origin}/gmail`,
    });
  else await chrome.tabs.create({ url: `${origin}/gmail`, active: true });
  await chrome.alarms.create('glyph-poll', { periodInMinutes: 0.5 });
  return { origin };
}

async function context() {
  const connection = await bridge('connection');
  if (!connection.authorized || !connection.email)
    throw new Error(
      connection.message || 'Sign in with your connected Gmail email.',
    );
  const settings = await bridge('settings');
  return { email: connection.email, settings };
}

async function poll() {
  try {
    const ctx = await context();
    const previous = await chrome.storage.local.get(['seenEvents', 'mailbox']);
    await bridge('sync');
    const events = await bridge('activity');
    const seen = new Set(
      previous.mailbox === ctx.email ? previous.seenEvents : undefined,
    );
    const baseline =
      previous.mailbox !== ctx.email || !Array.isArray(previous.seenEvents);
    for (const event of events) {
      if (
        baseline ||
        seen.has(event.id) ||
        event.automated ||
        !['open', 'click', 'reply'].includes(event.type) ||
        event.read
      )
        continue;
      const wanted =
        event.type === 'open'
          ? ctx.settings.notifyOpens
          : event.type === 'reply'
            ? ctx.settings.notifyReplies !== false
            : ctx.settings.notifyClicks;
      if (!wanted) continue;
      await chrome.notifications.create(`glyph-${event.id}`, {
        type: 'basic',
        iconUrl: chrome.runtime.getURL('icon128.png'),
        title:
          event.type === 'open'
            ? 'Glyph: pixel-load signal'
            : event.type === 'reply'
              ? 'Glyph: reply received'
              : 'Glyph: tracked link requested',
        message: `${event.recipientName || event.recipientEmail} · ${event.subject}`,
        contextMessage: 'Engagement signal, not a guaranteed read receipt.',
      });
    }
    await chrome.storage.local.set({
      seenEvents: events.map((e) => e.id),
      mailbox: ctx.email,
      lastPoll: new Date().toISOString(),
    });
    const unread = events.filter(
      (e) => !e.read && !e.automated && e.type !== 'sent',
    ).length;
    await chrome.action.setBadgeText({ text: unread ? String(unread) : '' });
    await chrome.action.setBadgeBackgroundColor({ color: '#d94020' });
  } catch {
    await chrome.action.setBadgeText({ text: '!' });
    await chrome.action.setBadgeBackgroundColor({ color: '#8a6620' });
  }
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || message?.channel !== CHANNEL) return;
  const gmail = sender.tab?.url?.startsWith('https://mail.google.com/');
  const popup =
    !sender.tab && sender.url === chrome.runtime.getURL('popup.html');
  if (!gmail && !popup) {
    respond({ ok: false, error: 'Unsupported caller.' });
    return;
  }
  const execute = async () => {
    switch (message.action) {
      case 'context':
        return context();
      case 'prepare': {
        if (!gmail) throw new Error('Prepare tracking from Gmail compose.');
        const { origin } = await chrome.storage.local.get('origin');
        const expected = appOrigin(origin);
        const result = await bridge('prepare', message.data);
        const urls = [
          result.markerUrl,
          ...(message.data.trackOpens ? [result.pixelUrl] : []),
          ...(result.links ?? []).map((link) => link.trackingUrl),
        ];
        if (urls.some((value) => !value || new URL(value).origin !== expected))
          throw new Error(
            'Glyph returned a tracking URL for a different environment. Nothing was added. Reconnect to the published app and start a fresh compose.',
          );
        return result;
      }
      case 'status': {
        const saved = await chrome.storage.local.get(['origin', 'lastPoll']);
        try {
          return { ...saved, ...(await context()), connected: true };
        } catch (error) {
          return { ...saved, connected: false, error: error.message };
        }
      }
      case 'connect':
        if (!popup) throw new Error('Use the extension popup to connect.');
        return connect(message.origin);
      case 'disconnect':
        if (!popup) throw new Error('Use the extension popup to disconnect.');
        {
          const { origin } = await chrome.storage.local.get('origin');
          await unregisterBridge();
          const permission =
            globalThis.GlyphOriginPolicy.permissionPattern(origin);
          if (permission)
            await chrome.permissions.remove({ origins: [permission] });
        }
        await chrome.alarms.clear('glyph-poll');
        await chrome.storage.local.clear();
        await chrome.action.setBadgeText({ text: '' });
        return { disconnected: true };
      case 'sync':
        await poll();
        return { ok: true };
      default:
        throw new Error('Unsupported extension action.');
    }
  };
  execute()
    .then((data) => respond({ ok: true, data }))
    .catch((e) => respond({ ok: false, error: e.message }));
  return true;
});
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'glyph-poll') void poll();
});
chrome.runtime.onInstalled.addListener(async () => {
  await reconcileStoredConnection();
});
chrome.runtime.onStartup.addListener(async () => {
  await reconcileStoredConnection();
});
chrome.notifications.onClicked.addListener(async () => {
  const { origin } = await chrome.storage.local.get('origin');
  if (!origin) return;
  try {
    await chrome.tabs.create({ url: `${appOrigin(origin)}/activity` });
  } catch {
    await reconcileStoredConnection();
  }
});
