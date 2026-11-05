import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import FakeTimers from '@sinonjs/fake-timers';
import { mailbox } from './service-harness.mjs';

const script = await readFile(
  new URL('../../../extensions/glyph-gmail/gmail.js', import.meta.url),
  'utf8',
);
const messaging = await readFile(
  new URL('../../../extensions/glyph-gmail/messaging.js', import.meta.url),
  'utf8',
);

export async function trackedCompose(h, owner) {
  const dom = new JSDOM(
    `<a aria-label="Google Account: Sender (${mailbox})"></a>
     <div class="M9"><input name="subjectbox" value="Sales proposal">
     <div email="recipient@example.invalid"></div>
     <div><div role="textbox" contenteditable="true" g_editable="true">Proposal <a href="https://example.invalid/proposal">details</a></div></div>
     <button id="native-send">Send</button></div>`,
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
  const prepared = Promise.withResolvers();
  let data;
  dom.window.chrome = {
    runtime: {
      id: 'glyph-fixture-extension',
      async sendMessage(message) {
        if (message.action === 'context')
          return {
            ok: true,
            data: {
              email: mailbox,
              settings: { defaultTrackOpens: true, defaultTrackClicks: true },
            },
          };
        if (message.action !== 'prepare')
          throw new Error('Unexpected extension action');
        try {
          const response = await h.request('/native/prepare', {
            user: owner,
            method: 'POST',
            body: message.data,
          });
          data = await response.json();
          if (!response.ok) throw new Error(data.error);
          prepared.resolve();
          return { ok: true, data };
        } catch (error) {
          prepared.reject(error);
          return { ok: false, error: error.message };
        }
      },
    },
  };
  const close = () => {
    dom.window.glyphCompose?.dispose();
    clock.uninstall();
    dom.window.close();
  };
  try {
    dom.window.eval(messaging);
    dom.window.eval(script);
    await clock.tickAsync(0);
    dom.window.document.querySelector('.glyph-native-toolbar button').click();
    await prepared.promise;
    await clock.tickAsync(0);
    return {
      data,
      html: dom.window.document.querySelector('[g_editable]').innerHTML,
      pixel: dom.window.document.querySelector('img')?.src,
      close,
    };
  } catch (error) {
    close();
    throw error;
  }
}
