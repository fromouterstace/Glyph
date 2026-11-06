import { randomUUID } from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db, glyphAttachments, glyphMessages } from '@workspace/db';
import { ObjectStorageService } from './objectStorage';
import {
  ComposerError,
  validateAttachmentInput,
  validateAttachmentTotal,
} from './composer-policy';

const storage = new ObjectStorageService();
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type AttachmentRow = typeof glyphAttachments.$inferSelect;
export const attachmentView = (row: AttachmentRow) => ({
  id: row.id,
  name: row.name,
  size: row.size,
  contentType: row.contentType,
});
export function withComposerLock<T>(
  owner: string,
  work: (tx: Tx) => Promise<T>,
) {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`glyph-files:${owner}`}, 0))`,
    );
    return work(tx);
  });
}
export async function ownedAttachment(
  owner: string,
  id: string,
  client: Tx | typeof db = db,
) {
  const [row] = await client
    .select()
    .from(glyphAttachments)
    .where(
      and(eq(glyphAttachments.ownerId, owner), eq(glyphAttachments.id, id)),
    );
  if (!row) throw new ComposerError(404, 'Attachment not found.');
  return row;
}
export async function attachmentMetadata(tx: Tx, owner: string, ids: string[]) {
  if (!ids.length) return [];
  const rows = await tx
    .select()
    .from(glyphAttachments)
    .where(
      and(
        eq(glyphAttachments.ownerId, owner),
        inArray(glyphAttachments.id, ids),
      ),
    );
  if (rows.length !== ids.length || rows.some((row) => !row.generation))
    throw new ComposerError(
      400,
      'An attachment is unavailable or has not finished uploading.',
    );
  const files = ids.map((id) =>
    attachmentView(rows.find((row) => row.id === id)!),
  );
  validateAttachmentTotal(files);
  return files;
}
export async function requestUpload(
  owner: string,
  input: { name: string; size: number; contentType: string },
) {
  validateAttachmentInput(input);
  const uploadUrl = await storage.getObjectEntityUploadURL();
  return withComposerLock(owner, async (tx) => {
    const [usage] = await tx
      .select({
        bytes: sql<number>`coalesce(sum(${glyphAttachments.size}), 0)::int`,
        count: sql<number>`count(*)::int`,
      })
      .from(glyphAttachments)
      .where(
        and(
          eq(glyphAttachments.ownerId, owner),
          sql`not exists (
        select 1 from ${glyphMessages}
        where ${glyphMessages.ownerId} = ${owner}
        and ${glyphMessages.attachments} @> jsonb_build_array(jsonb_build_object('id', ${glyphAttachments.id}))
      )`,
        ),
      );
    if (usage.bytes + input.size > 100 * 1024 * 1024 || usage.count >= 100)
      throw new ComposerError(
        409,
        'The 100 MiB or 100-file staging limit was reached. Save drafts or remove unused uploads before adding more.',
      );
    const [row] = await tx
      .insert(glyphAttachments)
      .values({
        ...input,
        contentType: input.contentType.toLowerCase(),
        id: randomUUID(),
        ownerId: owner,
        objectPath: storage.normalizeObjectEntityPath(uploadUrl),
      })
      .returning();
    return { attachment: attachmentView(row), uploadUrl };
  });
}
export async function completeUpload(owner: string, id: string) {
  const pending = await ownedAttachment(owner, id);
  if (pending.generation) return attachmentView(pending);
  const file = await storage.getObjectEntityFile(pending.objectPath);
  const [metadata] = await file.getMetadata();
  return withComposerLock(owner, async (tx) => {
    const row = await ownedAttachment(owner, id, tx);
    if (row.generation) return attachmentView(row);
    if (Number(metadata.size) !== row.size || !metadata.generation) {
      await file.delete({ ignoreNotFound: true });
      await tx.delete(glyphAttachments).where(eq(glyphAttachments.id, id));
      // Return a committed rejection, not a throw that rolls back the cleanup.
      return null;
    }
    const [saved] = await tx
      .update(glyphAttachments)
      .set({ generation: String(metadata.generation) })
      .where(eq(glyphAttachments.id, id))
      .returning();
    return attachmentView(saved);
  });
}
export async function readAttachment(owner: string, id: string) {
  const row = await ownedAttachment(owner, id);
  if (!row.generation)
    throw new ComposerError(409, 'Attachment upload is incomplete.');
  try {
    const current = await storage.getObjectEntityFile(row.objectPath);
    const file = current.bucket.file(current.name, {
      generation: row.generation,
    });
    const [content] = await file.download({ start: 0, end: row.size });
    if (content.length !== row.size)
      throw new ComposerError(
        409,
        'Attachment contents changed. Upload the file again.',
      );
    return { name: row.name, contentType: row.contentType, content };
  } catch (error) {
    if (error instanceof ComposerError) throw error;
    throw new ComposerError(
      503,
      'The attachment could not be loaded. Retry or upload it again.',
    );
  }
}
export async function deleteUnusedAttachment(owner: string, id: string) {
  return withComposerLock(owner, async (tx) => {
    const row = await ownedAttachment(owner, id, tx);
    const [used] = await tx
      .select({ id: glyphMessages.id })
      .from(glyphMessages)
      .where(
        and(
          eq(glyphMessages.ownerId, owner),
          sql`${glyphMessages.attachments} @> ${JSON.stringify([{ id }])}::jsonb`,
        ),
      )
      .limit(1);
    if (used)
      throw new ComposerError(
        409,
        'Remove this attachment from saved drafts before deleting its file.',
      );
    try {
      const file = await storage.getObjectEntityFile(row.objectPath);
      await file.delete({ ignoreNotFound: true });
    } catch (error) {
      if (!(error instanceof Error) || error.name !== 'ObjectNotFoundError')
        throw error;
    }
    await tx.delete(glyphAttachments).where(eq(glyphAttachments.id, id));
  });
}
