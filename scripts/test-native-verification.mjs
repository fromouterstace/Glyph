import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";

const source = await readFile(new URL("../artifacts/api-server/src/lib/native-verification.ts", import.meta.url), "utf8");
const { matchesNativeSend } = await import(`data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(source)).toString("base64")}`);
const message = { pixelToken: "unique-token", recipientEmail: "recipient@example.com", createdAt: new Date(1000) };
function candidate(overrides = {}) {
  return { id: "sent-1", internalDate: "2000", payload: {
    mimeType: "multipart/alternative",
    headers: [{ name: "From", value: "Owner <owner@example.com>" }, { name: "To", value: "Recipient <recipient@example.com>" }],
    parts: [{ mimeType: "text/html", body: { data: Buffer.from('<a href="https://glyph.example/gmail?glyph=unique-token">Sent with Glyph</a>').toString("base64url") } }],
  }, ...overrides };
}
test("confirms a matching single-recipient HTML message in Sent", () => {
  assert.equal(matchesNativeSend(candidate(), message, "owner@example.com"), true);
});
test("never attributes a marker sent to another recipient or multiple recipients", () => {
  for (const value of ["different@example.com", "recipient@example.com, other@example.com"]) {
    const sent = candidate(); sent.payload.headers[1].value = value;
    assert.equal(matchesNativeSend(sent, message, "owner@example.com"), false);
  }
});
test("CC, BCC, wrong sender and pre-existing messages cannot confirm a draft", () => {
  for (const name of ["Cc", "Bcc"]) {
    const sent = candidate(); sent.payload.headers.push({ name, value: "extra@example.com" });
    assert.equal(matchesNativeSend(sent, message, "owner@example.com"), false);
  }
  assert.equal(matchesNativeSend(candidate(), message, "different@example.com"), false);
  assert.equal(matchesNativeSend(candidate({ internalDate: "500" }), message, "owner@example.com"), false);
  assert.equal(matchesNativeSend(candidate({ internalDate: undefined }), message, "owner@example.com"), false);
});
test("plain text, token mentions and attachments are not rich-text confirmation", () => {
  for (const mimeType of ["text/plain", "application/octet-stream"]) {
    const sent = candidate(); sent.payload.parts[0].mimeType = mimeType;
    assert.equal(matchesNativeSend(sent, message, "owner@example.com"), false);
  }
  const sent = candidate();
  sent.payload.parts[0].body.data = Buffer.from("unique-token").toString("base64url");
  assert.equal(matchesNativeSend(sent, message, "owner@example.com"), false);
});
