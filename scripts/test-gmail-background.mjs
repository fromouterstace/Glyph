import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import FakeTimers from '@sinonjs/fake-timers';

const source = await readFile(
  new URL('../extensions/glyph-gmail/background.js', import.meta.url),
  'utf8',
);
// Test harness construction is reusable setup, not a single test case.
// eslint-disable-next-line max-lines-per-function
function fixture(options = {}) {
  const clock = FakeTimers.createClock(Date.UTC(2026, 10, 4, 12));
  let listener;
  const stored = { origin: 'https://glyph.example', ...options.stored };
  const calls = [],
    registered = [];
  const chrome = {
    runtime: {
      id: 'own-extension',
      getURL: (s) => `chrome-extension://own-extension/${s}`,
      onMessage: {
        addListener: (l) => {
          listener = l;
        },
      },
      onStartup: { addListener() {} },
    },
    storage: {
      local: {
        get: async () => stored,
        set: async (value) => Object.assign(stored, value),
        clear: async () => {
          for (const k in stored) delete stored[k];
        },
        remove: async (keys) => {
          for (const key of keys) delete stored[key];
        },
      },
    },
    permissions: { contains: async () => options.permission !== false },
    scripting: {
      executeScript: async (v) => calls.push(['inject', v]),
      unregisterContentScripts: async () => {},
      registerContentScripts: async (v) => registered.push(...v),
    },
    tabs: {
      query: async () =>
        options.closed ? [] : [{ id: 1, url: 'https://glyph.example/gmail' }],
      update: async () => {},
      create: async () => {},
      sendMessage: async (_id, msg) => {
        calls.push([msg.action, msg.data]);
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
                        markerUrl: 'https://glyph.example/gmail?glyph=test',
                        pixelUrl: 'https://glyph.example/api/glyph/t/test.gif',
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
        calls.push(['notification', data]);
      },
      onClicked: { addListener() {} },
    },
    action: {
      setBadgeText: async () => {},
      setBadgeBackgroundColor: async () => {},
    },
  };
  vm.runInNewContext(source, { chrome, URL, Set, Date: clock.Date, Error });
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
      const keepAlive = listener(
        { channel: 'glyph:background', action, ...extra },
        sender,
        resolve,
      );
      if (keepAlive === undefined) resolve(undefined);
    });
  return { request, calls, registered, stored, gmail, popup };
}
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
test('connect requires granted permissions and exact HTTPS app origin', async () => {
  const f = fixture({ permission: false });
  const denied = await f.request(
    'connect',
    { origin: 'https://glyph.example' },
    f.popup,
  );
  assert.equal(denied.ok, false);
  const path = await f.request(
    'connect',
    { origin: 'https://glyph.example/app' },
    f.popup,
  );
  assert.equal(path.ok, false);
  assert.equal(f.registered.length, 0);
});
test('app access is registered only for the explicitly selected origin', async () => {
  const f = fixture();
  const response = await f.request(
    'connect',
    { origin: 'https://glyph.example' },
    f.popup,
  );
  assert.equal(response.ok, true);
  assert.equal(f.registered[0].matches.length, 1);
  assert.equal(f.registered[0].matches[0], 'https://glyph.example/*');
  assert.equal(
    Object.keys(f.stored).some((k) => /token|password|secret/i.test(k)),
    false,
  );
});
test('new preview connections are rejected before bridge registration', async () => {
  const f = fixture();
  const response = await f.request(
    'connect',
    { origin: 'https://workspace.replit.dev' },
    f.popup,
  );
  assert.equal(response.ok, false);
  assert.match(response.error, /published/);
  assert.equal(f.registered.length, 0);
});
test('existing preview connections cannot prepare pixels or read context', async () => {
  const f = fixture({ stored: { origin: 'https://workspace.replit.dev' } });
  for (const action of ['context', 'prepare']) {
    const response = await f.request(action, { data: { trackOpens: true } });
    assert.equal(response.ok, false);
    assert.match(response.error, /Preview connections/);
  }
  assert.equal(f.calls.length, 0);
});
test('a production connection rejects cross-environment pixel, marker and link URLs', async () => {
  const valid = {
    markerUrl: 'https://glyph.example/gmail?glyph=test',
    pixelUrl: 'https://glyph.example/api/glyph/t/test.gif',
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
