import { mailboxAddresses, recipientGroups } from './native-verification';

export type MessageHeaders = { name: string; value: string }[];
export type ReplyCandidate = {
  id: string;
  internalDate?: string;
  labelIds?: string[];
  payload?: { mimeType?: string; headers?: MessageHeaders };
};
export type ReplyOriginal = {
  id: string;
  rfcMessageId: string;
  recipientEmail: string;
  toEmails?: string[];
  ccEmails?: string[];
  bccEmails?: string[];
  sentAt: Date | null;
};
export function headerValue(headers: MessageHeaders, name: string): string {
  return headers
    .filter((h) => h.name.toLowerCase() === name.toLowerCase())
    .map((h) => h.value)
    .join(' ');
}
export function messageIds(value: string): string[] {
  const matches = [...value.matchAll(/<([^<>\s]+@[^<>\s]+)>/g)].map(
    (m) => m[1],
  );
  if (matches.length) return matches;
  return /^[^<>\s]+@[^<>\s]+$/.test(value.trim()) ? [value.trim()] : [];
}
export function matchReply(
  candidate: ReplyCandidate,
  originals: ReplyOriginal[],
  mailbox: string,
): ReplyOriginal | null {
  const headers = candidate.payload?.headers ?? [];
  if (
    candidate.labelIds?.some((label) => label === 'SENT' || label === 'DRAFT')
  )
    return null;
  if (candidate.payload?.mimeType === 'multipart/report') return null;
  const auto = headerValue(headers, 'auto-submitted').trim().toLowerCase();
  if (auto && auto !== 'no') return null;
  if (
    /^(bulk|junk|list)$/i.test(headerValue(headers, 'precedence').trim()) ||
    headerValue(headers, 'x-autoreply') ||
    headerValue(headers, 'x-autorespond') ||
    /delivery-status|disposition-notification/i.test(
      headerValue(headers, 'content-type'),
    )
  )
    return null;
  const from = mailboxAddresses(headerValue(headers, 'from'));
  if (
    from.length !== 1 ||
    from[0].toLowerCase() === mailbox.toLowerCase() ||
    /^(mailer-daemon|postmaster)@/i.test(from[0])
  )
    return null;
  const recipients = mailboxAddresses(
    [headerValue(headers, 'to'), headerValue(headers, 'cc')]
      .filter(Boolean)
      .join(','),
  );
  if (
    !recipients.some(
      (address) => address.toLowerCase() === mailbox.toLowerCase(),
    )
  )
    return null;
  const receivedAt = Number(candidate.internalDate);
  if (!Number.isFinite(receivedAt)) return null;
  const eligible = originals.filter(
    (m) =>
      m.sentAt !== null &&
      receivedAt >= m.sentAt.getTime() &&
      Object.values(recipientGroups(m))
        .flat()
        .some((address) => address.toLowerCase() === from[0].toLowerCase()),
  );
  // Prefer a direct parent; otherwise attribute to the nearest tracked ancestor
  // in the standard References chain. Never use a Gmail thread ID or subject.
  const referenced = [
    ...messageIds(headerValue(headers, 'in-reply-to')).reverse(),
    ...messageIds(headerValue(headers, 'references')).reverse(),
  ];
  for (const id of referenced) {
    const original = eligible.find((m) =>
      messageIds(m.rfcMessageId).includes(id),
    );
    if (original) return original;
  }
  return null;
}
