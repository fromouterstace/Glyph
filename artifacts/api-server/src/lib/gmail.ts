import { ReplitConnectors } from "@replit/connectors-sdk";
import { clerkClient } from "@clerk/express";
import { randomBytes } from "node:crypto";
import { logger } from "./logger";

const connectors = new ReplitConnectors();
let profileCache: { email: string; until: number } | undefined;
const userCache = new Map<string, { authorized: boolean; until: number }>();

export async function gmailRequest(path: string, init: NonNullable<Parameters<typeof connectors.proxy>[2]> = {}) {
  return connectors.proxy("google-mail", `/gmail/v1/users/me${path}`, init);
}

export async function mailboxEmail(): Promise<string> {
  if (profileCache && profileCache.until > Date.now()) return profileCache.email;
  const response = await gmailRequest("/profile");
  if (!response.ok) throw new Error(`Gmail connection unavailable (${response.status}). Reconnect Gmail in Integrations.`);
  const data = await response.json() as { emailAddress?: string };
  if (!data.emailAddress) throw new Error("Gmail did not return an account email.");
  const email = data.emailAddress.toLowerCase();
  profileCache = { email, until: Date.now() + 60_000 };
  return email;
}

export async function ownsMailbox(userId: string): Promise<boolean> {
  const cached = userCache.get(userId);
  if (cached && cached.until > Date.now()) return cached.authorized;
  const [email, user] = await Promise.all([mailboxEmail(), clerkClient.users.getUser(userId)]);
  const authorized = user.emailAddresses.some((address) =>
    address.verification?.status === "verified" && address.emailAddress.toLowerCase() === email);
  if (userCache.size > 1000) userCache.clear();
  userCache.set(userId, { authorized, until: Date.now() + 30_000 });
  return authorized;
}

export const newToken = () => randomBytes(24).toString("hex");
export const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

export function extractUrls(text: string): string[] {
  const found = text.match(/https?:\/\/[^\s<>"']+/gi) ?? [];
  return [...new Set(found.map((s) => s.replace(/[.,;!?)\]]+$/, "")).filter((s) => {
    try { const u = new URL(s); return ["https:", "http:"].includes(u.protocol) && !u.username && !u.password; }
    catch { return false; }
  }))].slice(0, 100);
}

export function mimeMessage(input: {
  from: string; to: string; subject: string; body: string; html: string; rfcMessageId: string;
}): string {
  const boundary = `glyph_${newToken()}`;
  const encodedSubject = `=?UTF-8?B?${Buffer.from(input.subject).toString("base64")}?=`;
  const lines = [
    `From: ${input.from}`, `To: ${input.to}`, `Subject: ${encodedSubject}`,
    `Message-ID: <${input.rfcMessageId}>`, `Date: ${new Date().toUTCString()}`,
    "MIME-Version: 1.0", `Content-Type: multipart/alternative; boundary="${boundary}"`, "",
    `--${boundary}`, 'Content-Type: text/plain; charset="UTF-8"', "Content-Transfer-Encoding: base64", "",
    Buffer.from(input.body).toString("base64").match(/.{1,76}/g)?.join("\r\n") ?? "",
    `--${boundary}`, 'Content-Type: text/html; charset="UTF-8"', "Content-Transfer-Encoding: base64", "",
    Buffer.from(input.html).toString("base64").match(/.{1,76}/g)?.join("\r\n") ?? "",
    `--${boundary}--`, "",
  ];
  return Buffer.from(lines.join("\r\n")).toString("base64url");
}

export async function findSentMessage(rfcMessageId: string): Promise<string | null> {
  const response = await gmailRequest(`/messages?q=${encodeURIComponent(`in:sent rfc822msgid:${rfcMessageId}`)}&maxResults=1`);
  if (!response.ok) throw new Error("Unable to reconcile Gmail send status. Do not retry automatically.");
  const result = await response.json() as { messages?: { id: string }[] };
  return result.messages?.[0]?.id ?? null;
}

export async function safeMailboxOwnership(userId: string): Promise<boolean> {
  try { return await ownsMailbox(userId); }
  catch (err) { logger.warn({ err }, "Could not verify Gmail ownership"); return false; }
}
