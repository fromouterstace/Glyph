import { and, eq } from 'drizzle-orm';
import { db, glyphLabelImports } from '@workspace/db';
import {
  requireMailboxOwner,
  userGmailRequest,
  type MailboxContext,
} from './gmail';
import { storeLabelMessage } from './gmail-label-storage';
import type { LabelMessage } from './gmail-label-parser';

const flights = new Map<string, Promise<unknown>>();
const isCoolingDown = (
  state: { mailboxIdentity: string; lastSyncedAt: Date | null } | undefined,
  identity: string,
) =>
  state?.mailboxIdentity === identity &&
  state.lastSyncedAt !== null &&
  Date.now() - state.lastSyncedAt.getTime() < 50_000;
export async function labelImportStatus(ownerId: string) {
  const [row] = await db
    .select()
    .from(glyphLabelImports)
    .where(eq(glyphLabelImports.ownerId, ownerId));
  return {
    status: row?.status ?? 'pending',
    lastSyncedAt: row?.lastSyncedAt?.toISOString() ?? null,
  };
}

async function gmailJson<T>(
  ownerId: string,
  mailbox: MailboxContext,
  path: string,
): Promise<T> {
  const response = await userGmailRequest(ownerId, path, {}, mailbox.identity);
  if (response.status === 400 && path.includes('pageToken=')) {
    await db
      .update(glyphLabelImports)
      .set({ pageToken: null })
      .where(eq(glyphLabelImports.ownerId, ownerId));
  }
  if (!response.ok)
    throw new Error(`Gmail label import unavailable (${response.status}).`);
  return response.json() as Promise<T>;
}

async function prepareLabelScan(
  ownerId: string,
  mailbox: MailboxContext,
  old: typeof glyphLabelImports.$inferSelect | undefined,
  found: boolean,
) {
  await db
    .insert(glyphLabelImports)
    .values({
      ownerId,
      mailboxIdentity: mailbox.identity,
      status: found ? 'syncing' : 'label_missing',
    })
    .onConflictDoUpdate({
      target: glyphLabelImports.ownerId,
      set: {
        mailboxIdentity: mailbox.identity,
        status: found ? 'syncing' : 'label_missing',
        pageToken:
          found && old?.mailboxIdentity === mailbox.identity
            ? old.pageToken
            : null,
        lastSyncedAt:
          old?.mailboxIdentity === mailbox.identity ? old.lastSyncedAt : null,
      },
    });
}

async function importPage(ownerId: string) {
  const mailbox = await requireMailboxOwner(ownerId);
  const [old] = await db
    .select()
    .from(glyphLabelImports)
    .where(eq(glyphLabelImports.ownerId, ownerId));
  if (isCoolingDown(old, mailbox.identity)) return labelImportStatus(ownerId);
  const labels = await gmailJson<{ labels?: { id: string; name: string }[] }>(
    ownerId,
    mailbox,
    '/labels',
  );
  const matches = (labels.labels ?? []).filter(
    (l) => l.name.toLowerCase() === 'glyph',
  );
  if (matches.length > 1)
    throw new Error('More than one Glyph label was returned.');
  await prepareLabelScan(ownerId, mailbox, old, matches.length > 0);
  if (!matches.length) return labelImportStatus(ownerId);
  const params = new URLSearchParams({
    labelIds: matches[0].id,
    maxResults: '25',
    q: '-in:drafts',
  });
  if (old?.mailboxIdentity === mailbox.identity && old.pageToken)
    params.set('pageToken', old.pageToken);
  const page = await gmailJson<{
    messages?: { id: string }[];
    nextPageToken?: string;
  }>(ownerId, mailbox, `/messages?${params}`);
  for (const row of page.messages ?? []) {
    const message = await gmailJson<LabelMessage>(
      ownerId,
      mailbox,
      `/messages/${encodeURIComponent(row.id)}?format=full`,
    );
    if (
      !message.labelIds?.includes(matches[0].id) ||
      message.labelIds.includes('DRAFT')
    )
      continue;
    // Check the binding after remote reads, before committing private mailbox data.
    if ((await requireMailboxOwner(ownerId)).identity !== mailbox.identity)
      throw new Error('Gmail connection changed during label import.');
    await storeLabelMessage(ownerId, mailbox, message);
  }
  await db
    .update(glyphLabelImports)
    .set({
      pageToken: page.nextPageToken ?? null,
      status: page.nextPageToken ? 'syncing' : 'synced',
      lastSyncedAt: new Date(Date.now()),
    })
    .where(
      and(
        eq(glyphLabelImports.ownerId, ownerId),
        eq(glyphLabelImports.mailboxIdentity, mailbox.identity),
      ),
    );
  return labelImportStatus(ownerId);
}

export async function syncLabelImport(ownerId: string) {
  const existing = flights.get(ownerId);
  if (existing) return existing;
  const job = importPage(ownerId);
  flights.set(ownerId, job);
  try {
    return await job;
  } catch (error) {
    await db
      .update(glyphLabelImports)
      .set({ status: 'error' })
      .where(eq(glyphLabelImports.ownerId, ownerId));
    throw error;
  } finally {
    flights.delete(ownerId);
  }
}
