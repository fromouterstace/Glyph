import { createHash, randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db, glyphMessages, glyphEvents } from "@workspace/db";
import { gmailRequest, mailboxEmail } from "./gmail";
import { headerValue, matchReply, messageIds, type ReplyCandidate } from "./reply-matching";

export type ReplySyncResult = { repliesDetected: number; replyCheckPartial: boolean; replyCheckError: string | null };
const results = new Map<string, { at: number; value: ReplySyncResult }>();
const flights = new Map<string, Promise<ReplySyncResult>>();
const metadataCache = new Map<string, { at: number; value: ReplyCandidate }>();
const wantedHeaders = ["Message-ID", "In-Reply-To", "References", "From", "To", "Cc", "Auto-Submitted", "Precedence", "X-Autoreply", "X-Autorespond", "Content-Type"];

async function metadata(id: string): Promise<ReplyCandidate> {
  const cached = metadataCache.get(id);
  if (cached && Date.now() - cached.at < 300_000) return cached.value;
  const query = new URLSearchParams({ format: "metadata" });
  for (const name of wantedHeaders) query.append("metadataHeaders", name);
  const response = await gmailRequest(`/messages/${encodeURIComponent(id)}?${query}`);
  if (!response.ok) throw new Error(`Gmail reply-header check failed (${response.status}). Retry sync.`);
  const value = await response.json() as ReplyCandidate;
  if (metadataCache.size > 1000) metadataCache.clear();
  metadataCache.set(id, { at: Date.now(), value });
  return value;
}
export async function syncReplies(ownerId: string): Promise<ReplySyncResult> {
  const cached = results.get(ownerId);
  if (cached && Date.now() - cached.at < 25_000) return { ...cached.value, repliesDetected: 0 };
  const existing = flights.get(ownerId);
  if (existing) return existing;
  const job = scanReplies(ownerId);
  flights.set(ownerId, job);
  try {
    const value = await job;
    if (results.size > 1000) results.clear();
    results.set(ownerId, { at: Date.now(), value });
    return value;
  } finally { flights.delete(ownerId); }
}
async function scanReplies(ownerId: string): Promise<ReplySyncResult> {
  const result: ReplySyncResult = { repliesDetected: 0, replyCheckPartial: false, replyCheckError: null };
  try {
    const originals = await db.select().from(glyphMessages).where(and(
      eq(glyphMessages.ownerId, ownerId), eq(glyphMessages.status, "sent"),
    ));
    if (!originals.length) return result;
    const mailbox = await mailboxEmail();
    // Older native records used a temporary local ID before reply detection
    // existed. Recover the real RFC Message-ID without reading email bodies.
    const unresolved = originals.filter((m) => m.rfcMessageId.endsWith("@glyph.native"));
    if (unresolved.length > 50) result.replyCheckPartial = true;
    for (const original of unresolved.slice(0, 50)) {
      if (!original.gmailId) { result.replyCheckPartial = true; continue; }
      const sent = await metadata(original.gmailId);
      const id = headerValue(sent.payload?.headers ?? [], "message-id");
      if (messageIds(id).length !== 1) { result.replyCheckPartial = true; continue; }
      await db.update(glyphMessages).set({ rfcMessageId: id }).where(and(eq(glyphMessages.id, original.id), eq(glyphMessages.ownerId, ownerId)));
      original.rfcMessageId = id;
    }
    // Inspect headers only. Transport is Gmail; matching is provider-neutral.
    // Bounded, explicitly disclosed scan: newest 100 received messages / 30 days.
    // Partial scans are reported, never presented as "no replies exist".
    let pageToken: string | undefined;
    for (let page = 0; page < 2; page++) {
      const query = new URLSearchParams({ q: "newer_than:30d -in:sent -in:drafts", maxResults: "50" });
      if (pageToken) query.set("pageToken", pageToken);
      const response = await gmailRequest(`/messages?${query}`);
      if (!response.ok) throw new Error(`Gmail reply search failed (${response.status}). Retry sync.`);
      const listed = await response.json() as { messages?: { id: string }[]; nextPageToken?: string };
      const ids = listed.messages ?? [];
      for (let offset = 0; offset < ids.length; offset += 5) {
        const messages = await Promise.all(ids.slice(offset, offset + 5).map(({ id }) => metadata(id)));
        for (const candidate of messages) {
          const original = matchReply(candidate, originals, mailbox);
          if (!original) continue;
          const fingerprint = createHash("sha256").update(`reply:${ownerId}:${candidate.id}`).digest("hex");
          const inserted = await db.insert(glyphEvents).values({
            id: randomUUID(), messageId: original.id, type: "reply", automated: false,
            source: "Email reply — standard Message-ID reference", fingerprint,
            occurredAt: new Date(Number(candidate.internalDate)),
          }).onConflictDoNothing().returning({ id: glyphEvents.id });
          result.repliesDetected += inserted.length;
        }
      }
      pageToken = listed.nextPageToken;
      if (!pageToken) break;
    }
    if (pageToken) result.replyCheckPartial = true;
  } catch (error) {
    result.replyCheckError = error instanceof Error ? error.message : "Reply detection failed. Retry sync.";
    result.replyCheckPartial = true;
  }
  return result;
}
