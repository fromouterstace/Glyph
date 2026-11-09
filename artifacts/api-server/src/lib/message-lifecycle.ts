import { and, eq, inArray, isNull, notInArray, sql } from 'drizzle-orm';
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
          isNull(glyphMessages.archivedAt),
          eq(glyphMessages.deliverySource, 'web'),
          eq(glyphMessages.status, 'draft'),
          eq(glyphMessages.recipientEmail, snapshot.recipientEmail),
          eq(glyphMessages.toEmails, snapshot.toEmails),
          eq(glyphMessages.ccEmails, snapshot.ccEmails),
          eq(glyphMessages.bccEmails, snapshot.bccEmails),
          eq(glyphMessages.recipientName, snapshot.recipientName),
          eq(glyphMessages.subject, snapshot.subject),
          eq(glyphMessages.body, snapshot.body),
          sql`${glyphMessages.bodyHtml} is not distinct from ${snapshot.bodyHtml}`,
          eq(glyphMessages.attachments, snapshot.attachments),
          eq(glyphMessages.trackOpens, snapshot.trackOpens),
          eq(glyphMessages.trackClicks, snapshot.trackClicks),
        ),
      )
      .returning({ id: glyphMessages.id });
    if (!updated.length) return false;
    const reused = new Set(links.map((link) => link.id));
    const oldLinks = await tx
      .select()
      .from(glyphLinks)
      .where(
        and(
          eq(glyphLinks.messageId, snapshot.id),
          isNull(glyphLinks.retiredAt),
        ),
      );
    for (const link of links) {
      const old = oldLinks.find((candidate) => candidate.id === link.id);
      if (old && (old.token !== link.token || old.url !== link.url))
        throw new Error('Existing tracking links are immutable.');
    }
    const oldIds = new Set(oldLinks.map((link) => link.id));
    const activeLinks = [
      eq(glyphLinks.messageId, snapshot.id),
      isNull(glyphLinks.retiredAt),
    ];
    if (reused.size)
      activeLinks.push(notInArray(glyphLinks.id, Array.from(reused)));
    await tx
      .update(glyphLinks)
      .set({ retiredAt: new Date() })
      .where(and(...activeLinks));
    const insertLinks = links.filter((link) => !oldIds.has(link.id));
    if (insertLinks.length) await tx.insert(glyphLinks).values(insertLinks);
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
          isNull(glyphMessages.archivedAt),
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
