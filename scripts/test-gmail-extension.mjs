import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import FakeTimers from '@sinonjs/fake-timers';
import { PUBLISHED_GLYPH_ORIGIN } from '../artifacts/glyph/src/lib/tracking-origin.ts';

const source = await readFile(
  new URL('../extensions/glyph-gmail/gmail.js', import.meta.url),
  'utf8',
);
const clocks = new Set();
// Advance virtual browser time and flush promise/observer jobs, never sleep.
const wait = async (ms = 25) => {
  for (const clock of clocks) await clock.tickAsync(ms);
};
const messagingSource = await readFile(
  new URL('../extensions/glyph-gmail/messaging.js', import.meta.url),
  'utf8',
);

test('missing Chrome runtime at startup has safe recovery without editing or sending', async (t) => {
  for (const options of [{ noRuntime: true }, { noChrome: true }]) {
    const f = fixture(t, options);
    await wait();
    assert.equal(f.button().disabled, true);
    assert.equal(
      f.document.querySelector('.glyph-native-recovery').hidden,
      false,
    );
    assert.match(
      f.document.querySelector('.glyph-native-status').textContent,
      /reload Gmail/i,
    );
    assert.equal(f.body.innerHTML, f.original);
    assert.equal(f.calls.length, 0);
    let sent = 0;
    f.document.getElementById('send0').addEventListener('click', () => sent++);
    f.document.getElementById('send0').click();
    assert.equal(sent, 1);
  }
});

test('losing sendMessage after Gmail opens never leaks the raw TypeError', async (t) => {
  const f = fixture(t);
  await wait();
  delete f.window.chrome.runtime.sendMessage;
  await f.add();
  const status = f.document.querySelector('.glyph-native-status').textContent;
  assert.match(status, /wait until Gmail saves your draft/i);
  assert.doesNotMatch(status, /Cannot read properties/);
  assert.equal(
    f.document.querySelector('.glyph-native-recovery').hidden,
    false,
  );
  assert.equal(f.body.innerHTML, f.original);
});

test('context invalidation during preparation preserves the draft and shows recovery', async (t) => {
  const f = fixture(t, {
    beforeResponse: async () => {
      throw new Error('Extension context invalidated.');
    },
  });
  await f.add();
  assert.match(
    f.document.querySelector('.glyph-native-status').textContent,
    /reload Gmail/i,
  );
  assert.equal(f.body.innerHTML, f.original);
  assert.equal(f.body.querySelector('.glyph-native-footer'), null);
  assert.equal(f.button().disabled, true);
});

test('background transport errors become actionable recovery messages', async (t) => {
  const f = fixture(t, {
    runtimeEnvelopeError:
      "Cannot read properties of undefined (reading 'sendMessage')",
  });
  await wait();
  assert.match(
    f.document.querySelector('.glyph-native-status').textContent,
    /reload Gmail/i,
  );
  assert.doesNotMatch(
    f.document.querySelector('.glyph-native-status').textContent,
    /Cannot read properties/,
  );
});

test('closed ports and missing receivers recover without changing draft content', async (t) => {
  for (const message of [
    'Could not establish connection. Receiving end does not exist.',
    'The message port closed before a response was received.',
    'The message channel closed before a response was received.',
  ]) {
    const f = fixture(t, {
      beforeResponse: async () => {
        throw new Error(message);
      },
    });
    await f.add();
    assert.match(
      f.document.querySelector('.glyph-native-status').textContent,
      /reload Gmail/i,
    );
    assert.equal(f.body.innerHTML, f.original);
    assert.equal(f.button().disabled, true);
  }
});

test('a disposed in-flight script cannot attach stale tracking after reinjection', async (t) => {
  const f = fixture(t, {
    beforeResponse: async (window) => window.eval(source),
  });
  await f.add();
  assert.equal(f.document.querySelectorAll('.glyph-native-toolbar').length, 1);
  assert.equal(f.body.querySelector('.glyph-native-footer'), null);
  assert.equal(f.body.innerHTML, f.original);
});

test('manifest and popup enforce the exact trusted Glyph origin', async () => {
  const manifest = JSON.parse(
    await readFile(
      new URL('../extensions/glyph-gmail/manifest.json', import.meta.url),
      'utf8',
    ),
  );
  assert.equal(manifest.version, '0.5.2');
  assert.deepEqual(manifest.optional_host_permissions, [
    `${PUBLISHED_GLYPH_ORIGIN}/*`,
  ]);
  assert.deepEqual(manifest.host_permissions, ['https://mail.google.com/*']);
  assert.deepEqual(manifest.content_scripts[0].js, [
    'messaging.js',
    'gmail.js',
  ]);
  const popup = await readFile(
    new URL('../extensions/glyph-gmail/popup.html', import.meta.url),
    'utf8',
  );
  assert.ok(popup.includes('id="origin" type="url" readonly'));
  assert.ok(
    popup.indexOf('src="trusted-origin.js"') <
      popup.indexOf('src="messaging.js"'),
  );
  assert.ok(popup.indexOf('src="messaging.js"') >= 0);
  assert.ok(
    popup.indexOf('src="messaging.js"') < popup.indexOf('src="popup.js"'),
  );
});

test('lost runtime removes only generated tracking before native Send proceeds', async (t) => {
  const f = fixture(t);
  await f.add();
  assert.ok(f.body.querySelector('.glyph-native-footer'));
  delete f.window.chrome.runtime.id;
  let sent = 0;
  f.document.getElementById('send0').addEventListener('click', () => sent++);
  f.document.getElementById('send0').click();
  assert.equal(sent, 1);
  assert.equal(f.body.querySelector('.glyph-native-footer'), null);
  assert.equal(f.body.querySelector('a').href, 'https://example.com/pitch');
  assert.match(f.body.textContent, /Hi there/);
  assert.equal(f.button().disabled, true);
});

test('script reinjection cleans up the old toolbar and handlers', async (t) => {
  const f = fixture(t);
  await f.add();
  const oldButton = f.button();
  f.window.eval(source);
  await wait();
  assert.equal(f.document.querySelectorAll('.glyph-native-toolbar').length, 1);
  assert.equal(f.body.querySelector('.glyph-native-footer'), null);
  const before = f.calls.length;
  oldButton.click();
  await wait();
  assert.equal(f.calls.length, before);
  await f.add();
  assert.equal(f.body.querySelectorAll('.glyph-native-footer').length, 1);
});

test('DOM handoff retires a previous world without its global reference and preserves edits', async (t) => {
  const f = fixture(t);
  await f.add();
  const oldButton = f.button();
  const edit = f.document.createElement('p');
  edit.textContent = 'Unsaved user edit';
  f.body.append(edit);
  let saves = 0;
  let sends = 0;
  f.body.addEventListener('input', () => saves++);
  f.document.getElementById('send0').addEventListener('click', () => sends++);
  delete f.window.glyphCompose;
  f.window.eval(messagingSource);
  f.window.eval(source);
  await wait();
  assert.equal(f.document.querySelectorAll('.glyph-native-toolbar').length, 1);
  assert.equal(f.body.innerHTML, f.original + '<p>Unsaved user edit</p>');
  assert.equal(saves, 1);
  assert.equal(sends, 0);
  const before = f.calls.length;
  oldButton.click();
  await wait();
  assert.equal(f.calls.length, before);
  await f.add();
  assert.equal(f.body.querySelectorAll('.glyph-native-footer').length, 1);
});

test('a pre-handoff orphaned toolbar fails safely without rewriting its draft', async (t) => {
  const f = fixture(t);
  await wait();
  f.window.glyphCompose.dispose();
  delete f.window.glyphCompose;
  const toolbar = f.document.createElement('div');
  toolbar.className = 'glyph-native-toolbar';
  toolbar.innerHTML =
    '<button type="button">Add glyph</button><span class="glyph-native-status">Extension context invalidated.</span>';
  f.body.parentElement.insertBefore(toolbar, f.body);
  const before = f.calls.length;
  f.window.eval(source);
  await wait();
  assert.equal(toolbar.querySelector('button').disabled, true);
  assert.match(toolbar.textContent, /reload Gmail once/i);
  assert.equal(f.body.innerHTML, f.original);
  assert.equal(f.calls.length, before);
  assert.equal(f.document.querySelectorAll('.glyph-native-toolbar').length, 1);
});
function editor(index = 0) {
  return `<div class="M9" id="compose${index}"><input name="subjectbox" value="A proposal">
    <div email="recipient@example.com" id="recipient${index}"></div>
    <div><div role="textbox" contenteditable="true" g_editable="true" id="body${index}"><b>Hi there</b>, see <a href="https://example.com/pitch">the proposal</a><div>https://example.com/docs</div><div class="gmail_quote">Quoted <a href="https://example.com/old">history</a></div></div></div>
    <button id="send${index}">Send</button></div>`;
}
// Test harness construction is reusable setup, not a single test case.
function fixture(t, options = {}) {
  const dom = new JSDOM(
    `<a aria-label="Google Account: Owner (owner@example.com)" href="https://accounts.google.com/SignOutOptions"></a>${editor()}${options.two ? editor(1) : ''}`,
    { url: 'https://mail.google.com/mail/u/0/', runScripts: 'outside-only' },
  );
  const clock = FakeTimers.withGlobal(dom.window).install({
    now: Date.UTC(2026, 10, 4, 12),
    toFake: [
      'Date',
      'setTimeout',
      'clearTimeout',
      'setInterval',
      'clearInterval',
    ],
  });
  clocks.add(clock);
  t.after(() => {
    dom.window.glyphCompose?.dispose();
    clocks.delete(clock);
    clock.uninstall();
    dom.window.close();
  });
  const calls = [];
  const original = dom.window.document.getElementById('body0').innerHTML;
  dom.window.chrome = {
    runtime: {
      id: 'glyph-test-extension',
      sendMessage: async (message) => {
        calls.push(message);
        if (options.runtimeEnvelopeError)
          return { ok: false, error: options.runtimeEnvelopeError };
        if (message.action === 'context')
          return {
            ok: true,
            data: {
              email: options.email || 'owner@example.com',
              settings: { defaultTrackOpens: true, defaultTrackClicks: true },
            },
          };
        if (message.action === 'prepare') {
          if (options.beforeResponse) await options.beforeResponse(dom.window);
          if (options.fail)
            return { ok: false, error: 'Connection unavailable' };
          return {
            ok: true,
            data: {
              messageId: 'native-1',
              markerUrl: `${PUBLISHED_GLYPH_ORIGIN}/gmail?glyph=unique`,
              pixelUrl: message.data.trackOpens
                ? `${PUBLISHED_GLYPH_ORIGIN}/api/glyph/t/unique.gif`
                : null,
              links: message.data.trackClicks
                ? message.data.urls.map((url, i) => ({
                    url,
                    trackingUrl: `${PUBLISHED_GLYPH_ORIGIN}/api/glyph/l/token${i}`,
                  }))
                : [],
            },
          };
        }
        throw new Error('Unexpected extension action');
      },
    },
  };
  if (options.noRuntime) delete dom.window.chrome.runtime;
  if (options.noChrome) delete dom.window.chrome;
  dom.window.eval(messagingSource);
  dom.window.eval(source);
  const document = dom.window.document;
  return {
    window: dom.window,
    document,
    calls,
    original,
    body: document.getElementById('body0'),
    button: () =>
      document.querySelector('#compose0 .glyph-native-toolbar button'),
    add: async () => {
      document.querySelector('#compose0 .glyph-native-toolbar button').click();
      await wait();
    },
  };
}
test('adds one control per compose without touching the Send button', async (t) => {
  const f = fixture(t);
  await wait(300);
  assert.equal(f.document.querySelectorAll('.glyph-native-toolbar').length, 1);
  let sent = 0;
  f.document.getElementById('send0').addEventListener('click', () => sent++);
  f.document.getElementById('send0').click();
  assert.equal(sent, 1);
  assert.equal(f.calls.filter((c) => c.action === 'prepare').length, 0);
  assert.equal(f.body.innerHTML, f.original);
});
test('adding a glyph preserves rich text and attaches its tracking pixel', async (t) => {
  const f = fixture(t);
  await wait();
  await f.add();
  assert.equal(f.body.querySelector('b').textContent, 'Hi there');
  assert.match(f.body.querySelector('img').src, /unique\.gif$/);
  assert.equal(f.body.querySelectorAll('.glyph-native-footer').length, 1);
});
test('link tracking rewrites new links and excludes quoted links', async (t) => {
  const f = fixture(t);
  await wait();
  await f.add();
  assert.match(f.body.querySelector('a').href, /\/api\/glyph\/l\//);
  assert.equal(
    f.body.querySelector('.gmail_quote a').href,
    'https://example.com/old',
  );
  assert.equal(
    [...f.body.querySelectorAll('a')].filter((link) =>
      link.href.startsWith(`${PUBLISHED_GLYPH_ORIGIN}/api/glyph/l/`),
    ).length,
    2,
  );
});
test('compose preparation sends only the intended recipient and links to the server', async (t) => {
  const f = fixture(t);
  await wait();
  await f.add();
  const preparation = f.calls.find((c) => c.action === 'prepare');
  assert.equal(preparation.data.recipientEmail, 'recipient@example.com');
  assert.equal(preparation.data.senderEmail, 'owner@example.com');
  assert.equal(preparation.data.urls.length, 2);
});
test('adding a glyph never intercepts or triggers Gmail Send', async (t) => {
  const f = fixture(t);
  await wait();
  await f.add();
  let sent = 0;
  f.document.getElementById('send0').addEventListener('click', () => sent++);
  f.document.getElementById('send0').click();
  assert.equal(sent, 1);
  assert.equal(
    f.calls.some((c) => c.action === 'send'),
    false,
  );
});
test('Remove glyph restores every original link and generated plain URL', async (t) => {
  const f = fixture(t);
  await wait();
  await f.add();
  await f.add();
  assert.equal(f.body.innerHTML, f.original);
  assert.equal(f.button().textContent, 'Add glyph');
});
test('editing removes old tracking without deleting the new text', async (t) => {
  const f = fixture(t);
  await wait();
  await f.add();
  f.body.append(f.document.createTextNode(' New information.'));
  f.body.dispatchEvent(new f.window.Event('input', { bubbles: true }));
  assert.equal(f.body.querySelector('.glyph-native-footer'), null);
  assert.match(f.body.textContent, /New information\.$/);
  assert.equal(f.body.querySelector('a').href, 'https://example.com/pitch');
});
test('recipient mutation invalidates the attached recipient-specific glyph', async (t) => {
  const f = fixture(t);
  await wait();
  await f.add();
  const recipient = f.document.getElementById('recipient0');
  recipient.setAttribute('email', 'different@example.com');
  // Gmail changes recipient chip child nodes as it replaces the chip.
  recipient.textContent = 'Different recipient';
  await wait(320);
  assert.equal(f.body.querySelector('.glyph-native-footer'), null);
});
test('multiple To recipients prepare one shared message without sending', async (t) => {
  const f = fixture(t);
  await wait();
  const chip = f.document.createElement('div');
  chip.setAttribute('email', 'second@example.com');
  f.document.getElementById('compose0').append(chip);
  await f.add();
  const preparation = f.calls.find((c) => c.action === 'prepare');
  assert.deepEqual(
    [...preparation.data.toEmails],
    ['recipient@example.com', 'second@example.com'],
  );
  assert.deepEqual([...preparation.data.ccEmails], []);
  assert.deepEqual([...preparation.data.bccEmails], []);
  assert.equal(f.body.querySelectorAll('.glyph-native-footer').length, 1);
});

test('Cc and Bcc chips keep their roles, and moving a chip invalidates the glyph', async (t) => {
  const f = fixture(t);
  await wait();
  const root = f.document.getElementById('compose0');
  const cc = f.document.createElement('div'),
    bcc = f.document.createElement('div');
  cc.setAttribute('data-name', 'cc');
  bcc.setAttribute('aria-label', 'Bcc recipients');
  cc.innerHTML = '<span email="cc@example.com"></span>';
  bcc.innerHTML = '<span data-hovercard-id="hidden@example.com"></span>';
  root.append(cc, bcc);
  await f.add();
  const preparation = f.calls.find((c) => c.action === 'prepare');
  assert.deepEqual([...preparation.data.ccEmails], ['cc@example.com']);
  assert.deepEqual([...preparation.data.bccEmails], ['hidden@example.com']);
  assert.equal(f.body.querySelectorAll('.glyph-native-footer').length, 1);
  cc.append(bcc.firstElementChild);
  await wait(320);
  assert.equal(f.body.querySelector('.glyph-native-footer'), null);
});
test('a mismatched Gmail account cannot prepare tracking', async (t) => {
  const f = fixture(t, { email: 'other@example.com' });
  await wait();
  await f.add();
  assert.equal(
    f.calls.some((c) => c.action === 'prepare'),
    false,
  );
  assert.equal(f.body.innerHTML, f.original);
});
test('backend errors do not alter or send the draft', async (t) => {
  const f = fixture(t, { fail: true });
  await wait();
  await f.add();
  assert.equal(f.body.innerHTML, f.original);
  assert.match(
    f.document.querySelector('.glyph-native-status').textContent,
    /Connection unavailable/,
  );
});
test('edits during preparation cannot receive stale tracking material', async (t) => {
  const f = fixture(t, {
    beforeResponse: async (window) => {
      window.document
        .getElementById('body0')
        .append(' Changed during request.');
    },
  });
  await wait();
  await f.add();
  assert.equal(f.body.querySelector('.glyph-native-footer'), null);
  assert.match(f.body.textContent, /Changed during request/);
  assert.match(
    f.document.querySelector('.glyph-native-status').textContent,
    /draft changed/,
  );
});
test('click-only tracking has a verification marker and no pixel', async (t) => {
  const f = fixture(t);
  await wait();
  const opens = f.document.querySelector('.glyph-native-toolbar input');
  opens.checked = false;
  opens.dispatchEvent(new f.window.Event('change'));
  await f.add();
  assert.equal(f.body.querySelector('img'), null);
  assert.ok(f.body.querySelector('.glyph-native-footer a[href*="?glyph="]'));
});
test('independent compose windows never share tracking state', async (t) => {
  const f = fixture(t, { two: true });
  await wait();
  await f.add();
  assert.equal(f.document.querySelectorAll('.glyph-native-toolbar').length, 2);
  assert.ok(f.body.querySelector('.glyph-native-footer'));
  assert.equal(
    f.document.getElementById('body1').querySelector('.glyph-native-footer'),
    null,
  );
});
test('a last-moment recipient change removes tracking before Gmail Send runs', async (t) => {
  const f = fixture(t);
  await wait();
  await f.add();
  f.document
    .getElementById('recipient0')
    .setAttribute('email', 'new@example.com');
  let sent = false;
  f.document.getElementById('send0').addEventListener('click', () => {
    sent = true;
    assert.equal(f.body.querySelector('.glyph-native-footer'), null);
    assert.equal(f.body.querySelector('a').href, 'https://example.com/pitch');
  });
  f.document.getElementById('send0').click();
  assert.equal(sent, true);
});
test("subject change invalidates tracking synchronously for Gmail's send shortcut", async (t) => {
  const f = fixture(t);
  await wait();
  await f.add();
  f.document.querySelector('input[name="subjectbox"]').value =
    'Changed subject';
  const event = new f.window.KeyboardEvent('keydown', {
    key: 'Enter',
    ctrlKey: true,
    bubbles: true,
    cancelable: true,
  });
  f.body.dispatchEvent(event);
  assert.equal(event.defaultPrevented, false);
  assert.equal(f.body.querySelector('.glyph-native-footer'), null);
});
test('a Cc-only message prepares without inventing a To recipient', async (t) => {
  const f = fixture(t);
  await wait();
  const wrapper = f.document.createElement('div');
  wrapper.setAttribute('data-name', 'cc');
  f.document.getElementById('recipient0').replaceWith(wrapper);
  wrapper.innerHTML = '<div email="recipient@example.com"></div>';
  await f.add();
  const preparation = f.calls.find((c) => c.action === 'prepare');
  assert.deepEqual([...preparation.data.toEmails], []);
  assert.deepEqual([...preparation.data.ccEmails], ['recipient@example.com']);
  assert.equal(f.body.querySelectorAll('.glyph-native-footer').length, 1);
});

test('duplicate recipients across roles fail safely without changing the body', async (t) => {
  const f = fixture(t);
  await wait();
  const to = f.document.createElement('div');
  to.setAttribute('data-name', 'to');
  const originalRecipient = f.document.getElementById('recipient0');
  originalRecipient.replaceWith(to);
  to.append(originalRecipient);
  const cc = f.document.createElement('div');
  cc.setAttribute('data-name', 'cc');
  cc.innerHTML = '<span email="recipient@example.com"></span>';
  f.document.getElementById('compose0').append(cc);
  await f.add();
  assert.equal(
    f.calls.some((call) => call.action === 'prepare'),
    false,
  );
  assert.equal(f.body.innerHTML, f.original);
  assert.match(
    f.document.querySelector('.glyph-native-status').textContent,
    /duplicate addresses/,
  );
});

test('collapsed recipient summaries do not turn Bcc into an extra To', async (t) => {
  const f = fixture(t);
  await wait();
  const summary = f.document.createElement('span');
  summary.setAttribute('email', 'hidden@example.com');
  const field = f.document.createElement('input');
  field.name = 'bcc';
  field.type = 'hidden';
  field.value = 'hidden@example.com';
  f.document.getElementById('compose0').append(summary, field);
  await f.add();
  const preparation = f.calls.find((call) => call.action === 'prepare');
  assert.deepEqual([...preparation.data.toEmails], ['recipient@example.com']);
  assert.deepEqual([...preparation.data.bccEmails], ['hidden@example.com']);
});
test('invalidating a generated link preserves edited text and custom URLs', async (t) => {
  const f = fixture(t);
  await wait();
  await f.add();
  const links = [...f.body.querySelectorAll('a[href*="/api/glyph/l/"]')];
  links[0].href = 'https://example.org/new';
  links[1].textContent = "User's revised label";
  f.body.dispatchEvent(new f.window.Event('input', { bubbles: true }));
  assert.equal(f.body.querySelector('a').href, 'https://example.org/new');
  assert.ok(f.body.textContent.includes("User's revised label"));
});
