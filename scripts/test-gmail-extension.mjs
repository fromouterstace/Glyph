import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

const source = await readFile(
  new URL('../extensions/glyph-gmail/gmail.js', import.meta.url),
  'utf8',
);
const wait = (ms = 25) => new Promise((resolve) => setTimeout(resolve, ms));
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

test('manifest and popup load guarded messaging before its callers', async () => {
  const manifest = JSON.parse(
    await readFile(
      new URL('../extensions/glyph-gmail/manifest.json', import.meta.url),
      'utf8',
    ),
  );
  assert.deepEqual(manifest.content_scripts[0].js, [
    'messaging.js',
    'gmail.js',
  ]);
  const popup = await readFile(
    new URL('../extensions/glyph-gmail/popup.html', import.meta.url),
    'utf8',
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
function editor(index = 0) {
  return `<div class="M9" id="compose${index}"><input name="subjectbox" value="A proposal">
    <div email="recipient@example.com" id="recipient${index}"></div>
    <div><div role="textbox" contenteditable="true" g_editable="true" id="body${index}"><b>Hi there</b>, see <a href="https://example.com/pitch">the proposal</a><div>https://example.com/docs</div><div class="gmail_quote">Quoted <a href="https://example.com/old">history</a></div></div></div>
    <button id="send${index}">Send</button></div>`;
}
function fixture(t, options = {}) {
  const dom = new JSDOM(
    `<a aria-label="Google Account: Owner (owner@example.com)" href="https://accounts.google.com/SignOutOptions"></a>${editor()}${options.two ? editor(1) : ''}`,
    { url: 'https://mail.google.com/mail/u/0/', runScripts: 'outside-only' },
  );
  t.after(() => {
    dom.window.glyphCompose?.dispose();
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
              markerUrl: 'https://glyph.example/gmail?glyph=unique',
              pixelUrl: message.data.trackOpens
                ? 'https://glyph.example/api/glyph/t/unique.gif'
                : null,
              links: message.data.trackClicks
                ? message.data.urls.map((url, i) => ({
                    url,
                    trackingUrl: `https://glyph.example/api/glyph/l/token${i}`,
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
test('explicit Add glyph preserves rich text, wraps new links, skips quoted links', async (t) => {
  const f = fixture(t);
  await wait();
  await f.add();
  assert.equal(f.body.querySelector('b').textContent, 'Hi there');
  assert.equal(f.body.querySelectorAll('.glyph-native-footer').length, 1);
  assert.match(f.body.querySelector('img').src, /unique\.gif$/);
  assert.match(f.body.querySelector('a').href, /\/api\/glyph\/l\//);
  assert.equal(
    f.body.querySelector('.gmail_quote a').href,
    'https://example.com/old',
  );
  const preparation = f.calls.find((c) => c.action === 'prepare');
  assert.equal(preparation.data.recipientEmail, 'recipient@example.com');
  assert.equal(preparation.data.senderEmail, 'owner@example.com');
  assert.equal(preparation.data.urls.length, 2);
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
test('multiple recipients fail safely and leave the email untouched', async (t) => {
  const f = fixture(t);
  await wait();
  const chip = f.document.createElement('div');
  chip.setAttribute('email', 'second@example.com');
  f.document.getElementById('compose0').append(chip);
  await f.add();
  assert.equal(
    f.calls.some((c) => c.action === 'prepare'),
    false,
  );
  assert.equal(f.body.innerHTML, f.original);
  assert.match(
    f.document.querySelector('.glyph-native-status').textContent,
    /exactly one/,
  );
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
test('a lone CC chip is rejected even if it is the only address', async (t) => {
  const f = fixture(t);
  await wait();
  const wrapper = f.document.createElement('div');
  wrapper.setAttribute('data-name', 'cc');
  f.document.getElementById('recipient0').replaceWith(wrapper);
  wrapper.innerHTML = '<div email="recipient@example.com"></div>';
  await f.add();
  assert.equal(
    f.calls.some((c) => c.action === 'prepare'),
    false,
  );
  assert.match(
    f.document.querySelector('.glyph-native-status').textContent,
    /CC\/BCC/,
  );
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
