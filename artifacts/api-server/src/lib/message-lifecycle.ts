import { and, eq, inArray } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import {
  db,
  glyphMessages,
  glyphLinks,
  glyphEvents,
  type GlyphMessage,
} from '@workspace/db';

/** Claim exactly the draft that was rendered, not a concurrently edited copy. */
export async function claimDraftForSend(
  snapshot: GlyphMessage,
  links: (typeof glyphLinks.$inferInsert)[],
) {
  if (links.some((link) => link.messageId !== snapshot.id))
    throw new Error('Tracking links must belong to the claimed draft');
  return db.transaction(async (tx) => {
    const updated = await tx
      .update(glyphMessages)
      .set({ status: 'sending' })
      .where(
        and(
          eq(glyphMessages.id, snapshot.id),
          eq(glyphMessages.ownerId, snapshot.ownerId),
          eq(glyphMessages.deliverySource, 'web'),
          eq(glyphMessages.status, 'draft'),
          eq(glyphMessages.recipientEmail, snapshot.recipientEmail),
          eq(glyphMessages.recipientName, snapshot.recipientName),
          eq(glyphMessages.subject, snapshot.subject),
          eq(glyphMessages.body, snapshot.body),
          eq(glyphMessages.trackOpens, snapshot.trackOpens),
          eq(glyphMessages.trackClicks, snapshot.trackClicks),
        ),
      )
      .returning({ id: glyphMessages.id });
    if (!updated.length) return false;
    await tx.delete(glyphLinks).where(eq(glyphLinks.messageId, snapshot.id));
    if (links.length) await tx.insert(glyphLinks).values(links);
    return true;
  });
}

/** Persist the verified state and its one Sent event in the same transaction. */
export async function confirmSentMessage(
  message: Pick<GlyphMessage, 'id' | 'ownerId'>,
  confirmation: {
    gmailId: string;
    sentAt: Date;
    source: string;
    expectedStatuses: ('draft' | 'sending' | 'uncertain')[];
    rfcMessageId?: string;
  },
) {
  return db.transaction(async (tx) => {
    const changed = await tx
      .update(glyphMessages)
      .set({
        status: 'sent',
        gmailId: confirmation.gmailId,
        sentAt: confirmation.sentAt,
        ...(confirmation.rfcMessageId
          ? { rfcMessageId: confirmation.rfcMessageId }
          : {}),
      })
      .where(
        and(
          eq(glyphMessages.id, message.id),
          eq(glyphMessages.ownerId, message.ownerId),
          inArray(glyphMessages.status, confirmation.expectedStatuses),
        ),
      )
      .returning({ id: glyphMessages.id });
    if (!changed.length) return false;
    await tx
      .insert(glyphEvents)
      .values({
        id: randomUUID(),
        messageId: message.id,
        type: 'sent',
        source: confirmation.source,
        read: true,
        occurredAt: confirmation.sentAt,
        fingerprint: `${message.id}:sent`,
      })
      .onConflictDoNothing();
    return true;
  });
}
