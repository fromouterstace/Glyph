import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";

const source = await readFile(new URL("../extensions/glyph-gmail/gmail.js", import.meta.url), "utf8");
const wait = (ms = 25) => new Promise((resolve) => setTimeout(resolve, ms));
function editor(index = 0) {
  return `<div class="M9" id="compose${index}"><input name="subjectbox" value="A proposal">
    <div email="recipient@example.com" id="recipient${index}"></div>
    <div><div role="textbox" contenteditable="true" g_editable="true" id="body${index}"><b>Hi there</b>, see <a href="https://example.com/pitch">the proposal</a><div>https://example.com/docs</div><div class="gmail_quote">Quoted <a href="https://example.com/old">history</a></div></div></div>
    <button id="send${index}">Send</button></div>`;
}
function fixture(t, options = {}) {
  const dom = new JSDOM(`<a aria-label="Google Account: Owner (owner@example.com)" href="https://accounts.google.com/SignOutOptions"></a>${editor()}${options.two ? editor(1) : ""}`, { url: "https://mail.google.com/mail/u/0/", runScripts: "outside-only" });
  t.after(() => dom.window.close());
  const calls = [];
  const original = dom.window.document.getElementById("body0").innerHTML;
  dom.window.chrome = { runtime: { sendMessage: async (message) => {
    calls.push(message);
    if (message.action === "context") return { ok: true, data: { email: options.email || "owner@example.com", settings: { defaultTrackOpens: true, defaultTrackClicks: true } } };
    if (message.action === "prepare") {
      if (options.beforeResponse) await options.beforeResponse(dom.window);
      if (options.fail) return { ok: false, error: "Connection unavailable" };
      return { ok: true, data: { messageId: "native-1", markerUrl: "https://glyph.example/gmail?glyph=unique", pixelUrl: message.data.trackOpens ? "https://glyph.example/api/glyph/t/unique.gif" : null,
        links: message.data.trackClicks ? message.data.urls.map((url, i) => ({ url, trackingUrl: `https://glyph.example/api/glyph/l/token${i}` })) : [] } };
    }
    throw new Error("Unexpected extension action");
  } } };
  dom.window.eval(source);
  const document = dom.window.document;
  return { window: dom.window, document, calls, original, body: document.getElementById("body0"),
    button: () => document.querySelector("#compose0 .glyph-native-toolbar button"),
    add: async () => { document.querySelector("#compose0 .glyph-native-toolbar button").click(); await wait(); } };
}
test("adds one control per compose without touching the Send button", async (t) => {
  const f = fixture(t);
  await wait(300);
  assert.equal(f.document.querySelectorAll(".glyph-native-toolbar").length, 1);
  let sent = 0;
  f.document.getElementById("send0").addEventListener("click", () => sent++);
  f.document.getElementById("send0").click();
  assert.equal(sent, 1);
  assert.equal(f.calls.filter((c) => c.action === "prepare").length, 0);
  assert.equal(f.body.innerHTML, f.original);
});
test("explicit Add glyph preserves rich text, wraps new links, skips quoted links", async (t) => {
  const f = fixture(t); await wait(); await f.add();
  assert.equal(f.body.querySelector("b").textContent, "Hi there");
  assert.equal(f.body.querySelectorAll(".glyph-native-footer").length, 1);
  assert.match(f.body.querySelector("img").src, /unique\.gif$/);
  assert.match(f.body.querySelector("a").href, /\/api\/glyph\/l\//);
  assert.equal(f.body.querySelector(".gmail_quote a").href, "https://example.com/old");
  const preparation = f.calls.find((c) => c.action === "prepare");
  assert.equal(preparation.data.recipientEmail, "recipient@example.com");
  assert.equal(preparation.data.senderEmail, "owner@example.com");
  assert.equal(preparation.data.urls.length, 2);
  let sent = 0; f.document.getElementById("send0").addEventListener("click", () => sent++);
  f.document.getElementById("send0").click(); assert.equal(sent, 1);
  assert.equal(f.calls.some((c) => c.action === "send"), false);
});
test("Remove glyph restores every original link and generated plain URL", async (t) => {
  const f = fixture(t); await wait(); await f.add(); await f.add();
  assert.equal(f.body.innerHTML, f.original);
  assert.equal(f.button().textContent, "Add glyph");
});
test("editing removes old tracking without deleting the new text", async (t) => {
  const f = fixture(t); await wait(); await f.add();
  f.body.append(f.document.createTextNode(" New information."));
  f.body.dispatchEvent(new f.window.Event("input", { bubbles: true }));
  assert.equal(f.body.querySelector(".glyph-native-footer"), null);
  assert.match(f.body.textContent, /New information\.$/);
  assert.equal(f.body.querySelector("a").href, "https://example.com/pitch");
});
test("recipient mutation invalidates the attached recipient-specific glyph", async (t) => {
  const f = fixture(t); await wait(); await f.add();
  const recipient = f.document.getElementById("recipient0");
  recipient.setAttribute("email", "different@example.com");
  // Gmail changes recipient chip child nodes as it replaces the chip.
  recipient.textContent = "Different recipient";
  await wait(320);
  assert.equal(f.body.querySelector(".glyph-native-footer"), null);
});
test("multiple recipients fail safely and leave the email untouched", async (t) => {
  const f = fixture(t); await wait();
  const chip = f.document.createElement("div"); chip.setAttribute("email", "second@example.com");
  f.document.getElementById("compose0").append(chip); await f.add();
  assert.equal(f.calls.some((c) => c.action === "prepare"), false);
  assert.equal(f.body.innerHTML, f.original);
  assert.match(f.document.querySelector(".glyph-native-status").textContent, /exactly one/);
});
test("a mismatched Gmail account cannot prepare tracking", async (t) => {
  const f = fixture(t, { email: "other@example.com" }); await wait(); await f.add();
  assert.equal(f.calls.some((c) => c.action === "prepare"), false);
  assert.equal(f.body.innerHTML, f.original);
});
test("backend errors do not alter or send the draft", async (t) => {
  const f = fixture(t, { fail: true }); await wait(); await f.add();
  assert.equal(f.body.innerHTML, f.original);
  assert.match(f.document.querySelector(".glyph-native-status").textContent, /Connection unavailable/);
});
test("edits during preparation cannot receive stale tracking material", async (t) => {
  const f = fixture(t, { beforeResponse: async (window) => {
    window.document.getElementById("body0").append(" Changed during request.");
  } });
  await wait(); await f.add();
  assert.equal(f.body.querySelector(".glyph-native-footer"), null);
  assert.match(f.body.textContent, /Changed during request/);
  assert.match(f.document.querySelector(".glyph-native-status").textContent, /draft changed/);
});
test("click-only tracking has a verification marker and no pixel", async (t) => {
  const f = fixture(t); await wait();
  const opens = f.document.querySelector(".glyph-native-toolbar input");
  opens.checked = false; opens.dispatchEvent(new f.window.Event("change"));
  await f.add();
  assert.equal(f.body.querySelector("img"), null);
  assert.ok(f.body.querySelector('.glyph-native-footer a[href*="?glyph="]'));
});
test("independent compose windows never share tracking state", async (t) => {
  const f = fixture(t, { two: true }); await wait(); await f.add();
  assert.equal(f.document.querySelectorAll(".glyph-native-toolbar").length, 2);
  assert.ok(f.body.querySelector(".glyph-native-footer"));
  assert.equal(f.document.getElementById("body1").querySelector(".glyph-native-footer"), null);
});
