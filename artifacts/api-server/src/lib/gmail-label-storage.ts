import { randomUUID } from 'node:crypto';
import { and, eq, or, sql } from 'drizzle-orm';
import { db, glyphContacts, glyphMessages } from '@workspace/db';
import { newToken, type MailboxContext } from './gmail';
import { parseLabelMessage, type LabelMessage } from './gmail-label-parser';

export async function storeLabelMessage(
  ownerId: string,
  mailbox: MailboxContext,
  message: LabelMessage,
) {
  const parsed = parseLabelMessage(message, mailbox.email);
  await db.transaction(async (tx) => {
    // Serialize import deduplication for this owner, including concurrent instances.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`label-import:${ownerId}`}))`,
    );
    const [existing] = await tx
      .select({ id: glyphMessages.id })
      .from(glyphMessages)
      .where(
        and(
          eq(glyphMessages.ownerId, ownerId),
          or(
            eq(glyphMessages.gmailId, message.id),
            eq(glyphMessages.rfcMessageId, parsed.values.rfcMessageId),
          ),
        ),
      )
      .limit(1);
    if (!existing)
      await tx
        .insert(glyphMessages)
        .values({
          ...parsed.values,
          id: randomUUID(),
          ownerId,
          gmailId: message.id,
          pixelToken: newToken(),
          deliverySource: 'import',
          nativeComposeKey: `label-import:${mailbox.email}:${message.id}`,
          status: 'sent',
          trackOpens: false,
          trackClicks: false,
          bodyHtml: null,
          attachments: [],
        })
        .onConflictDoNothing({
          target: [glyphMessages.ownerId, glyphMessages.nativeComposeKey],
        });
    if (parsed.contacts.length)
      await tx
        .insert(glyphContacts)
        .values(
          parsed.contacts.map((contact) => ({
            ...contact,
            id: randomUUID(),
            ownerId,
          })),
        )
        .onConflictDoUpdate({
          target: [glyphContacts.ownerId, glyphContacts.email],
          // Enrich missing names, but never overwrite an existing contact's identity.
          set: {
            firstName: sql`case when ${glyphContacts.firstName} = '' then excluded.first_name else ${glyphContacts.firstName} end`,
            lastName: sql`case when ${glyphContacts.lastName} = '' then excluded.last_name else ${glyphContacts.lastName} end`,
          },
        });
  });
}
