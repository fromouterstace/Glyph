import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db, glyphMessages, glyphEvents } from "@workspace/db";
import { gmailRequest, mailboxEmail } from "./gmail";
import { matchesNativeSend, type SentCandidate } from "./native-verification";
const scans = new Map<string, { at: number; result: { confirmed: number; pending: number } }>();
const inFlight = new Map<string, Promise<{ confirmed: number; pending: number }>>();
const candidateCache = new Map<string, { at: number; candidate: SentCandidate }>();

export async function syncNative(ownerId: string, freshSignal = false) {
  const previous = scans.get(ownerId);
  if (previous && Date.now() - previous.at < (freshSignal ? 5_000 : 25_000)) return previous.result;
  const running = inFlight.get(ownerId);
  if (running) return running;
  const task = scanNative(ownerId);
  inFlight.set(ownerId, task);
  try {
    const result = await task;
    if (scans.size > 1000) scans.clear();
    scans.set(ownerId, { at: Date.now(), result });
    return result;
  } finally { inFlight.delete(ownerId); }
}

async function scanNative(ownerId: string) {
  const pending = await db.select().from(glyphMessages).where(and(
    eq(glyphMessages.ownerId, ownerId), eq(glyphMessages.deliverySource, "gmail"), eq(glyphMessages.status, "draft"),
  ));
  if (!pending.length) return { confirmed: 0, pending: 0 };
  const mailbox = await mailboxEmail();
  const list = await gmailRequest("/messages?q=in%3Asent%20newer_than%3A7d&maxResults=25");
  if (!list.ok) throw new Error(`Gmail Sent check failed (${list.status})`);
  const rows = await list.json() as { messages?: { id: string }[] };
  let confirmed = 0;
  const matched = new Set<string>();
  for (const row of rows.messages ?? []) {
    const cached = candidateCache.get(row.id);
    let candidate: SentCandidate;
    if (cached && Date.now() - cached.at < 300_000) candidate = cached.candidate;
    else {
      const result = await gmailRequest(`/messages/${encodeURIComponent(row.id)}?format=full`);
      if (!result.ok) continue;
      candidate = await result.json() as SentCandidate;
      if (candidateCache.size > 200) candidateCache.clear();
      candidateCache.set(row.id, { at: Date.now(), candidate });
    }
    for (const message of pending) {
      if (matched.has(message.id) || !matchesNativeSend(candidate, message, mailbox)) continue;
      const millis = Number(candidate.internalDate);
      const sentAt = Number.isFinite(millis) ? new Date(millis) : new Date();
      await db.transaction(async (tx) => {
        const changed = await tx.update(glyphMessages).set({
          status: "sent", gmailId: candidate.id, sentAt,
        }).where(and(eq(glyphMessages.id, message.id), eq(glyphMessages.status, "draft"))).returning();
        if (!changed.length) return;
        await tx.insert(glyphEvents).values({
          id: randomUUID(), messageId: message.id, type: "sent", source: "Gmail browser — verified in Sent",
          read: true, occurredAt: sentAt, fingerprint: `${message.id}:sent`,
        }).onConflictDoNothing();
        confirmed++;
      });
      matched.add(message.id);
    }
    if (matched.size === pending.length) break;
  }
  return { confirmed, pending: pending.length - matched.size };
}
