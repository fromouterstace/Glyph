import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import FakeTimers from '@sinonjs/fake-timers';
import { PUBLISHED_GLYPH_ORIGIN } from '../artifacts/glyph/src/lib/tracking-origin.ts';

const source = await readFile(
  new URL('../extensions/glyph-gmail/background.js', import.meta.url),
  'utf8',
);
const originPolicySource = await readFile(
  new URL('../extensions/glyph-gmail/trusted-origin.js', import.meta.url),
  'utf8',
);
function makeChrome(options, stored, state, listeners) {
  const grantedOrigins = options.grantedOrigins ?? [
    `${PUBLISHED_GLYPH_ORIGIN}/*`,
    'https://mail.google.com/*',
  ];
  return {
    runtime: {
      id: 'own-extension',
      getURL: (s) => `chrome-extension://own-extension/${s}`,
      onMessage: { addListener: (l) => (listeners.message = l) },
      onInstalled: { addListener: (l) => (listeners.installed = l) },
      onStartup: { addListener: (l) => (listeners.started = l) },
    },
    storage: {
      local: {
        get: async () => stored,
        set: async (value) => Object.assign(stored, value),
        remove: async (keys) => {
          for (const key of keys) delete stored[key];
        },
      },
    },
    permissions: {
      contains: async (value) => {
        state.permissionChecks.push(value);
        return options.permission !== false;
      },
      getAll: async () => ({ origins: [...grantedOrigins] }),
      remove: async ({ origins }) => {
        state.removedPermissions.push(...origins);
        return true;
      },
    },
    scripting: {
      executeScript: async (v) => {
        if (options.failedInjectionTab === v.target.tabId)
          throw new Error('Synthetic closing tab');
        state.calls.push(['inject', v]);
      },
      removeCSS: async () => {},
      insertCSS: async (v) => state.styles.push(v),
      unregisterContentScripts: async ({ ids }) =>
        state.unregistered.push(...ids),
      registerContentScripts: async (v) => state.registered.push(...v),
    },
    tabs: {
      query: async ({ url }) => {
        if (url === 'https://mail.google.com/*') return options.gmailTabs ?? [];
        const tabUrl = options.tabUrl ?? `${stored.origin}/gmail`;
        return options.closed || !tabUrl.startsWith(url.replace('*', ''))
          ? []
          : [{ id: 1, url: tabUrl }];
      },
      update: async () => {},
      create: async (tab) => state.openedTabs.push(tab),
      sendMessage: async (_id, msg) => {
        if (options.unavailable) throw new Error('Synthetic API unavailable');
        await options.beforeBridge?.(msg.action);
        state.calls.push([msg.action, msg.data]);
        return {
          ok: true,
          data:
            msg.action === 'connection'
              ? { authorized: true, email: 'owner@example.com' }
              : msg.action === 'activity'
                ? (options.events ?? [])
                : msg.action === 'settings'
                  ? (options.settings ?? {})
                  : msg.action === 'prepare'
                    ? (options.prepared ?? {
                        markerUrl: `${PUBLISHED_GLYPH_ORIGIN}/gmail?glyph=test`,
                        pixelUrl: `${PUBLISHED_GLYPH_ORIGIN}/api/glyph/t/test.gif`,
                        links: [],
                      })
                    : {},
        };
      },
    },
    alarms: {
      create: async () => {},
      clear: async () => {},
      onAlarm: { addListener() {} },
    },
    notifications: {
      create: async (_id, data) => {
        state.calls.push(['notification', data]);
      },
      onClicked: {
        addListener: (l) => (listeners.notificationClick = l),
      },
    },
    action: {
      setBadgeText: async () => {
        if (options.badgeUnavailable)
          throw new Error('Synthetic badge failure');
      },
      setBadgeBackgroundColor: async () => {},
    },
  };
}
// Test harness construction is reusable setup, not a single test case.
function fixture(options = {}) {
  const clock = FakeTimers.createClock(Date.UTC(2026, 10, 4, 12));
  const stored = { origin: PUBLISHED_GLYPH_ORIGIN, ...options.stored };
  const state = {
    styles: [],
    registered: [],
    unregistered: [],
    removedPermissions: [],
    permissionChecks: [],
    openedTabs: [],
    calls: [],
  };
  const listeners = {};
  const chrome = makeChrome(options, stored, state, listeners);
  const sandbox = vm.createContext({
    chrome,
    URL,
    Set,
    Date: clock.Date,
    Error,
  });
  sandbox.importScripts = (name) => {
    if (name !== 'trusted-origin.js') throw new Error('Unexpected import.');
    vm.runInContext(originPolicySource, sandbox);
  };
  vm.runInContext(source, sandbox);
  const gmail = {
    id: chrome.runtime.id,
    tab: { url: 'https://mail.google.com/mail/u/0/' },
  };
  const popup = {
    id: chrome.runtime.id,
    url: chrome.runtime.getURL('popup.html'),
  };
  const request = (action, extra = {}, sender = gmail) =>
    new Promise((resolve) => {
      const keepAlive = listeners.message(
        { channel: 'glyph:background', action, ...extra },
        sender,
        resolve,
      );
      if (keepAlive === undefined) resolve(undefined);
    });
  return {
    request,
    ...state,
    stored,
    gmail,
    popup,
    installed: (...args) => listeners.installed(...args),
    started: (...args) => listeners.started(...args),
    notificationClick: (...args) => listeners.notificationClick(...args),
    policy: sandbox.GlyphOriginPolicy,
  };
}
test('extension trust policy matches the application tracking origin', () => {
  const f = fixture();
  assert.equal(f.policy.publishedOrigin, PUBLISHED_GLYPH_ORIGIN);
  assert.equal(
    f.policy.appOrigin(PUBLISHED_GLYPH_ORIGIN),
    PUBLISHED_GLYPH_ORIGIN,
  );
});
test('Gmail setup opens only the extension-owned connection page without enrolling a host', async () => {
  const f = fixture({ origin: undefined });
  const result = await f.request('setup', {
    origin: 'https://attacker.invalid',
  });
  assert.equal(result.ok, true);
  assert.equal(f.openedTabs.length, 1);
  assert.equal(
    f.openedTabs[0].url,
    'chrome-extension://own-extension/popup.html',
  );
  assert.equal(f.registered.length, 0);
  assert.equal(f.permissionChecks.length, 0);
  const outside = await f.request(
    'setup',
    {},
    { id: 'own-extension', tab: { url: 'https://attacker.invalid' } },
  );
  assert.equal(outside.ok, false);
  assert.equal(f.openedTabs.length, 1);
});
test('extension-owned setup tab uses the same explicit permission checks as the popup', async () => {
  const f = fixture({ permission: false });
  const url = 'chrome-extension://own-extension/popup.html';
  const response = await f.request(
    'connect',
    { origin: PUBLISHED_GLYPH_ORIGIN },
    { id: 'own-extension', url, tab: { url } },
  );
  assert.equal(response.ok, false);
  assert.match(response.error, /Allow access/);
  assert.equal(f.registered.length, 0);
});
test('only own Gmail content script or own popup can call the background', async () => {
  const f = fixture();
  const unknown = await f.request(
    'prepare',
    {},
    { id: 'another-extension', tab: { url: 'https://mail.google.com/' } },
  );
  assert.equal(unknown, undefined);
  const outside = await f.request(
    'prepare',
    {},
    { id: 'own-extension', tab: { url: 'https://evil.example/' } },
  );
  assert.equal(outside.ok, false);
  assert.equal(f.calls.length, 0);
});
test('tracking requests use the app tab bridge and never Gmail send API', async () => {
  const f = fixture();
  const response = await f.request('prepare', { data: { subject: 'Draft' } });
  assert.equal(response.ok, true);
  assert.equal(f.calls.find((c) => c[0] === 'prepare')[1].subject, 'Draft');
  assert.equal(
    f.calls.some((c) => c[0] === 'send'),
    false,
  );
});
test('missing connection tab fails explicitly instead of reporting success', async () => {
  const f = fixture({ closed: true });
  const response = await f.request('prepare', { data: {} });
  assert.equal(response.ok, false);
  assert.match(response.error, /connection tab open/);
});
test('a connection tab redirected to an untrusted host receives no bridge data', async () => {
  const f = fixture({ tabUrl: 'https://attacker.example/gmail' });
  const response = await f.request('prepare', {
    data: { recipientEmail: 'private@example.com', body: 'private body' },
  });
  assert.equal(response.ok, false);
  assert.match(response.error, /connection tab open/);
  assert.equal(f.calls.length, 0);
});
test('connect requires granted permissions and exact HTTPS app origin', async () => {
  const f = fixture({ permission: false });
  const denied = await f.request(
    'connect',
    { origin: PUBLISHED_GLYPH_ORIGIN },
    f.popup,
  );
  assert.equal(denied.ok, false);
  const path = await f.request(
    'connect',
    { origin: `${PUBLISHED_GLYPH_ORIGIN}/app` },
    f.popup,
  );
  assert.equal(path.ok, false);
  assert.equal(f.registered.length, 0);
});
test('app access is registered only for the explicitly selected origin', async () => {
  const f = fixture();
  const response = await f.request(
    'connect',
    { origin: PUBLISHED_GLYPH_ORIGIN },
    f.popup,
  );
  assert.equal(response.ok, true);
  assert.equal(f.registered[0].matches.length, 1);
  assert.equal(f.registered[0].matches[0], `${PUBLISHED_GLYPH_ORIGIN}/*`);
  assert.equal(
    Object.keys(f.stored).some((k) => /token|password|secret/i.test(k)),
    false,
  );
});
test('lookalike, custom, malformed, and unsafe origins fail before enrollment', async () => {
  const untrusted = [
    'https://glyph-mail.replit.app',
    'https://glyph.rocks.attacker.example',
    'https://user@glyph.rocks',
    'https://glyph.rocks@attacker.example',
    'http://glyph.rocks',
    'https://glyph.rocks:8443',
    'https://glyph-mail.replit.app.attacker.example',
    'https://attacker.example',
    'https://user@glyph-mail.replit.app',
    'https://glyph-mail.replit.app@attacker.example',
    'http://glyph-mail.replit.app',
    'https://glyph-mail.replit.app:8443',
    `${PUBLISHED_GLYPH_ORIGIN}/gmail`,
    `${PUBLISHED_GLYPH_ORIGIN}?redirect=https://attacker.example`,
    `${PUBLISHED_GLYPH_ORIGIN}#attacker`,
    'not a URL',
  ];
  const f = fixture();
  for (const origin of untrusted) {
    const response = await f.request('connect', { origin }, f.popup);
    assert.equal(response.ok, false, origin);
  }
  assert.equal(f.permissionChecks.length, 0);
  assert.equal(f.registered.length, 0);
  assert.equal(f.openedTabs.length, 0);
});
test('update removes stale host permission and state before any bridge message', async () => {
  const oldOrigin = 'https://glyph-mail.replit.app.attacker.example';
  const f = fixture({
    stored: {
      origin: oldOrigin,
      seenEvents: ['old-event'],
      lastPoll: 'old-poll',
      mailbox: 'old@example.com',
    },
    grantedOrigins: [`${oldOrigin}/*`, 'https://mail.google.com/*'],
  });
  await f.installed({ reason: 'update' });
  assert.equal(f.stored.origin, undefined);
  assert.equal(f.stored.seenEvents, undefined);
  assert.ok(f.removedPermissions.includes(`${oldOrigin}/*`));
  assert.ok(f.unregistered.includes('glyph-app-bridge'));
  const response = await f.request('prepare', {
    data: { recipientEmail: 'private@example.com', body: 'private body' },
  });
  assert.equal(response.ok, false);
  assert.equal(f.calls.length, 0);
});
test('update clears the old deployment alias and requires explicit canonical enrollment', async () => {
  const oldOrigin = 'https://glyph-mail.replit.app';
  const f = fixture({
    closed: true,
    stored: { origin: oldOrigin, mailbox: 'old@example.com' },
    grantedOrigins: [`${oldOrigin}/*`, 'https://mail.google.com/*'],
  });
  await f.installed({ reason: 'update' });
  assert.equal(f.stored.origin, undefined);
  assert.equal(f.stored.mailbox, undefined);
  assert.ok(f.removedPermissions.includes(`${oldOrigin}/*`));
  assert.equal(f.openedTabs.length, 0);
  const result = await f.request(
    'connect',
    { origin: PUBLISHED_GLYPH_ORIGIN },
    f.popup,
  );
  assert.equal(result.ok, true);
  assert.equal(f.registered.at(-1).matches[0], 'https://glyph.rocks/*');
  assert.equal(f.openedTabs.at(-1).url, 'https://glyph.rocks/gmail');
});
test('new preview connections are rejected before bridge registration', async () => {
  const f = fixture();
  const response = await f.request(
    'connect',
    { origin: 'https://workspace.replit.dev' },
    f.popup,
  );
  assert.equal(response.ok, false);
  assert.match(response.error, /official published Glyph app/);
  assert.equal(f.registered.length, 0);
});
test('existing preview connections cannot prepare pixels or read context', async () => {
  const f = fixture({ stored: { origin: 'https://workspace.replit.dev' } });
  for (const action of ['context', 'prepare']) {
    const response = await f.request(action, { data: { trackOpens: true } });
    assert.equal(response.ok, false);
    assert.match(response.error, /official published Glyph app/);
  }
  assert.equal(f.calls.length, 0);
});
test('a production connection rejects cross-environment pixel, marker and link URLs', async () => {
  const valid = {
    markerUrl: `${PUBLISHED_GLYPH_ORIGIN}/gmail?glyph=test`,
    pixelUrl: `${PUBLISHED_GLYPH_ORIGIN}/api/glyph/t/test.gif`,
    links: [],
  };
  for (const prepared of [
    { ...valid, pixelUrl: 'https://preview.replit.dev/api/glyph/t/test.gif' },
    { ...valid, markerUrl: 'https://other.example/gmail?glyph=test' },
    { ...valid, pixelUrl: null },
    {
      ...valid,
      links: [{ trackingUrl: 'https://other.example/api/glyph/l/test' }],
    },
  ]) {
    const f = fixture({ prepared });
    const response = await f.request('prepare', { data: { trackOpens: true } });
    assert.equal(response.ok, false);
    assert.match(response.error, /different environment/);
  }
});
test('reply notifications are labeled as replies, not clicks, and respect reply preference', async () => {
  for (const notifyReplies of [true, false]) {
    const f = fixture({
      stored: { seenEvents: [], mailbox: 'owner@example.com' },
      settings: { notifyReplies, notifyClicks: true },
      events: [
        {
          id: 'reply1',
          type: 'reply',
          recipientEmail: 'recipient@outlook.com',
          subject: 'Proposal',
          read: false,
        },
      ],
    });
    await f.request('sync');
    const notification = f.calls.find((c) => c[0] === 'notification');
    assert.equal(!!notification, notifyReplies);
    if (notifyReplies)
      assert.equal(notification[1].title, 'Glyph: reply received');
  }
});

test('overlapping notification polls share one sync and do not deliver duplicate alerts', async () => {
  const entered = Promise.withResolvers();
  const release = Promise.withResolvers();
  const f = fixture({
    stored: { seenEvents: [], mailbox: 'owner@example.com' },
    settings: { notifyReplies: true },
    events: [{ id: 'new-reply', type: 'reply', subject: 'Synthetic reply' }],
    beforeBridge: async (action) => {
      if (action === 'sync') {
        entered.resolve();
        await release.promise;
      }
    },
  });
  const first = f.request('sync');
  await entered.promise;
  const second = f.request('sync');
  release.resolve();
  await Promise.all([first, second]);
  assert.equal(f.calls.filter(([action]) => action === 'sync').length, 1);
  assert.equal(
    f.calls.filter(([action]) => action === 'notification').length,
    1,
  );
});

test('badge API failure does not turn a recoverable poll failure into an unhandled rejection', async () => {
  const f = fixture({ unavailable: true, badgeUnavailable: true });
  const response = await f.request('sync');
  assert.equal(response.ok, true);
  assert.equal(
    f.calls.filter(([action]) => action === 'notification').length,
    0,
  );
});

test('disconnecting during a poll cannot restore the old mailbox cursor or emit a stale alert', async () => {
  const entered = Promise.withResolvers();
  const release = Promise.withResolvers();
  const f = fixture({
    stored: { seenEvents: [], mailbox: 'owner@example.com' },
    settings: { notifyReplies: true },
    events: [{ id: 'old-reply', type: 'reply' }],
    beforeBridge: async (action) => {
      if (action === 'activity') {
        entered.resolve();
        await release.promise;
      }
    },
  });
  const polling = f.request('sync');
  await entered.promise;
  const disconnected = await f.request('disconnect', {}, f.popup);
  release.resolve();
  await polling;
  assert.equal(disconnected.ok, true);
  assert.equal(f.stored.origin, undefined);
  assert.equal(f.stored.mailbox, undefined);
  assert.equal(f.stored.seenEvents, undefined);
  assert.equal(
    f.calls.filter(([action]) => action === 'notification').length,
    0,
  );
});
test('future unknown event types never become false click notifications', async () => {
  const f = fixture({
    stored: { seenEvents: [], mailbox: 'owner@example.com' },
    settings: { notifyClicks: true },
    events: [{ id: 'future1', type: 'unknown', read: false }],
  });
  await f.request('sync');
  assert.equal(
    f.calls.some((c) => c[0] === 'notification'),
    false,
  );
});

test('restarting the background preserves seen replies and notifies only newly arrived signals', async () => {
  const reply = (id) => ({
    id,
    type: 'reply',
    subject: 'Fixture',
    read: false,
  });
  const first = fixture({
    stored: { seenEvents: [], mailbox: 'owner@example.com' },
    settings: { notifyReplies: true },
    events: [reply('before-restart')],
  });
  await first.request('sync');
  assert.equal(
    first.calls.filter(([action]) => action === 'notification').length,
    1,
  );
  const restarted = fixture({
    stored: first.stored,
    settings: { notifyReplies: true },
    events: [reply('after-restart'), reply('before-restart')],
  });
  await restarted.started();
  await restarted.request('sync');
  assert.equal(
    restarted.calls.filter(([action]) => action === 'notification').length,
    1,
  );
  assert.deepEqual(Array.from(restarted.stored.seenEvents), [
    'after-restart',
    'before-restart',
  ]);
});

test('a temporary API failure preserves the notification cursor until recovery', async () => {
  const options = {
    unavailable: true,
    stored: { seenEvents: ['old'], mailbox: 'owner@example.com' },
    settings: { notifyReplies: true },
    events: [{ id: 'new-reply', type: 'reply', read: false }],
  };
  const f = fixture(options);
  await f.request('sync');
  assert.deepEqual(f.stored.seenEvents, ['old']);
  assert.equal(
    f.calls.filter(([action]) => action === 'notification').length,
    0,
  );
  options.unavailable = false;
  await f.request('sync');
  assert.equal(
    f.calls.filter(([action]) => action === 'notification').length,
    1,
  );
  assert.deepEqual(Array.from(f.stored.seenEvents), ['new-reply']);
});

test('first notification startup establishes a baseline rather than replaying old replies', async () => {
  const f = fixture({
    settings: { notifyReplies: true },
    events: [{ id: 'historical-reply', type: 'reply', read: false }],
  });
  await f.started();
  await f.request('sync');
  assert.equal(
    f.calls.filter(([action]) => action === 'notification').length,
    0,
  );
  assert.deepEqual(Array.from(f.stored.seenEvents), ['historical-reply']);
});

test('updates and browser startup refresh only open top-level Gmail tabs in script order', async () => {
  for (const event of ['installed', 'started']) {
    const f = fixture({
      gmailTabs: [
        { id: 7, url: 'https://mail.google.com/mail/u/0/' },
        { id: 8, url: 'https://mail.google.com/mail/u/1/' },
        { id: 9, url: 'https://mail.google.com.attacker.example/' },
        { id: 10, url: 'https://example.com/' },
        { url: 'https://mail.google.com/' },
      ],
    });
    await f[event]({ reason: 'update' });
    const injections = f.calls.filter(([action]) => action === 'inject');
    assert.equal(injections.length, 2);
    for (const [, injection] of injections) {
      assert.deepEqual(Array.from(injection.files), [
        'messaging.js',
        'gmail.js',
      ]);
      assert.deepEqual(Array.from(injection.target.frameIds), [0]);
    }
    assert.deepEqual(
      injections.map(([, injection]) => injection.target.tabId),
      [7, 8],
    );
    assert.equal(f.styles.length, 2);
    assert.equal(
      f.calls.some(([action]) => action === 'prepare'),
      false,
    );
    assert.equal(f.openedTabs.length, 0);
  }
});

test('a closing Gmail tab does not prevent other tabs recovering after an update', async () => {
  const f = fixture({
    failedInjectionTab: 7,
    gmailTabs: [
      { id: 7, url: 'https://mail.google.com/mail/u/0/' },
      { id: 8, url: 'https://mail.google.com/mail/u/1/' },
    ],
  });
  await f.installed({ reason: 'update' });
  assert.deepEqual(
    f.calls
      .filter(([action]) => action === 'inject')
      .map(([, injection]) => injection.target.tabId),
    [8],
  );
});

test('explicit reconnect also repairs Gmail tabs without discarding notification history', async () => {
  const f = fixture({
    stored: { seenEvents: ['existing'], mailbox: 'owner@example.com' },
    gmailTabs: [{ id: 7, url: 'https://mail.google.com/mail/u/0/' }],
  });
  const response = await f.request(
    'connect',
    { origin: PUBLISHED_GLYPH_ORIGIN },
    f.popup,
  );
  assert.equal(response.ok, true);
  assert.equal(f.calls.filter(([action]) => action === 'inject').length, 1);
  assert.deepEqual(f.stored.seenEvents, ['existing']);
});
