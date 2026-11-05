import test from "node:test";
import assert from "node:assert/strict";
import { matchesNativeSend } from "../artifacts/api-server/src/lib/native-verification.ts";
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
test("Gmail's email-shaped quoted display name is one actual recipient", () => {
  const sent = candidate();
  sent.payload.headers[1].value = '"recipient@example.com" <recipient@example.com>';
  assert.equal(matchesNativeSend(sent, message, "owner@example.com"), true);
});
test("an email-shaped sender display name is one actual sender", () => {
  const sent = candidate();
  sent.payload.headers[0].value = '"owner@example.com" <owner@example.com>';
  assert.equal(matchesNativeSend(sent, message, "owner@example.com"), true);
});
test("display-name addresses and comments are not mailbox addresses", () => {
  for (const value of [
    '"different@example.com" <recipient@example.com>',
    '"Last, First" <recipient@example.com>',
    'Recipient (other@example.com) <recipient@example.com>',
    '"Zoë Example" <RECIPIENT@example.com>',
    '"Recipient \\"Nickname\\"" <recipient@example.com>',
  ]) {
    const sent = candidate(); sent.payload.headers[1].value = value;
    assert.equal(matchesNativeSend(sent, message, "owner@example.com"), true, value);
  }
});
test("a matching display name cannot disguise a different actual recipient", () => {
  const sent = candidate();
  sent.payload.headers[1].value = '"recipient@example.com" <different@example.com>';
  assert.equal(matchesNativeSend(sent, message, "owner@example.com"), false);
});
test("a matching display name cannot disguise a different actual sender", () => {
  const sent = candidate();
  sent.payload.headers[0].value = '"owner@example.com" <different@example.com>';
  assert.equal(matchesNativeSend(sent, message, "owner@example.com"), false);
});
test("two actual recipients remain rejected even when their addresses repeat", () => {
  for (const value of [
    '"recipient@example.com" <recipient@example.com>, Other <other@example.com>',
    'recipient@example.com, recipient@example.com',
  ]) {
    const sent = candidate(); sent.payload.headers[1].value = value;
    assert.equal(matchesNativeSend(sent, message, "owner@example.com"), false);
  }
  const sent = candidate();
  sent.payload.headers.push({ name: "To", value: "other@example.com" });
  assert.equal(matchesNativeSend(sent, message, "owner@example.com"), false);
});
test("malformed recipients and group syntax fail closed", () => {
  for (const value of [
    "", "not an email", '"recipient@example.com" <>',
    '"Unclosed name <recipient@example.com>',
    "Team: recipient@example.com;",
  ]) {
    const sent = candidate(); sent.payload.headers[1].value = value;
    assert.equal(matchesNativeSend(sent, message, "owner@example.com"), false, value);
  }
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
