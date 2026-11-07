import { and, eq } from 'drizzle-orm';
import { db, glyphMessages } from '@workspace/db';
import {
  userGmailRequest,
  requireMailboxOwner,
  type MailboxContext,
} from './gmail';
import { matchesNativeSend, type SentCandidate } from './native-verification';
import { confirmSentMessage } from './message-lifecycle';
const scans = new Map<
  string,
  { at: number; result: { confirmed: number; pending: number } }
>();
const inFlight = new Map<
  string,
  Promise<{ confirmed: number; pending: number }>
>();
const candidateCache = new Map<
  string,
  { at: number; candidate: SentCandidate }
>();

export async function syncNative(ownerId: string, freshSignal = false) {
  const mailbox = await requireMailboxOwner(ownerId);
  const identityKey = `${mailbox.identity}:${ownerId}`;
  const previous = scans.get(identityKey);
  if (previous && Date.now() - previous.at < (freshSignal ? 5_000 : 25_000))
    return previous.result;
  const running = inFlight.get(identityKey);
  if (running) return running;
  const task = scanNative(ownerId, mailbox);
  inFlight.set(identityKey, task);
  try {
    const result = await task;
    if (scans.size > 1000) scans.clear();
    scans.set(identityKey, { at: Date.now(), result });
    return result;
  } finally {
    inFlight.delete(identityKey);
  }
}

async function scanNative(ownerId: string, mailbox: MailboxContext) {
  const pending = await db
    .select()
    .from(glyphMessages)
    .where(
      and(
        eq(glyphMessages.ownerId, ownerId),
        eq(glyphMessages.deliverySource, 'gmail'),
        eq(glyphMessages.status, 'draft'),
      ),
    );
  if (!pending.length) return { confirmed: 0, pending: 0 };
  const list = await userGmailRequest(
    ownerId,
    '/messages?q=in%3Asent%20newer_than%3A7d&maxResults=25',
    {},
    mailbox.identity,
  );
  if (!list.ok) throw new Error(`Gmail Sent check failed (${list.status})`);
  const rows = (await list.json()) as { messages?: { id: string }[] };
  let confirmed = 0;
  const matched = new Set<string>();
  for (const row of rows.messages ?? []) {
    const candidateKey = `${mailbox.identity}:${row.id}`;
    const cached = candidateCache.get(candidateKey);
    let candidate: SentCandidate;
    if (cached && Date.now() - cached.at < 300_000)
      candidate = cached.candidate;
    else {
      const result = await userGmailRequest(
        ownerId,
        `/messages/${encodeURIComponent(row.id)}?format=full`,
        {},
        mailbox.identity,
      );
      if (!result.ok) continue;
      candidate = (await result.json()) as SentCandidate;
      if (candidateCache.size > 200) candidateCache.clear();
      candidateCache.set(candidateKey, { at: Date.now(), candidate });
    }
    for (const message of pending) {
      if (
        matched.has(message.id) ||
        !matchesNativeSend(candidate, message, mailbox.email)
      )
        continue;
      const millis = Number(candidate.internalDate);
      const sentAt = Number.isFinite(millis) ? new Date(millis) : new Date();
      const changed = await confirmSentMessage(message, {
        gmailId: candidate.id!,
        sentAt,
        source: 'Gmail browser — verified in Sent',
        expectedStatuses: ['draft'],
        rfcMessageId: candidate.payload?.headers
          ?.find((header) => header.name.toLowerCase() === 'message-id')
          ?.value.trim(),
      });
      if (changed) confirmed++;
      matched.add(message.id);
    }
    if (matched.size === pending.length) break;
  }
  return { confirmed, pending: pending.length - matched.size };
}
