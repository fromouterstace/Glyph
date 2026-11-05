import emailAddresses from 'email-addresses';

type GmailPart = {
  mimeType?: string;
  body?: { data?: string };
  parts?: GmailPart[];
  headers?: { name: string; value: string }[];
};
export type SentCandidate = {
  id: string;
  internalDate?: string;
  payload?: GmailPart;
};

export function mailboxAddresses(header: string): string[] {
  // A display name can itself look like an email address. Parse the mailbox
  // structure, not every address-shaped substring, and fail closed on groups
  // or malformed headers rather than confusing display names with mailboxes.
  const parsed = emailAddresses.parseAddressList({
    input: header,
    strict: true,
    rfc6532: true,
  });
  if (!parsed || parsed.some((entry) => entry.type !== 'mailbox')) return [];
  return parsed.flatMap((entry) =>
    entry.type === 'mailbox' ? [entry.address] : [],
  );
}

export function containsNativeMarker(
  part: GmailPart | undefined,
  token: string,
): boolean {
  if (!part) return false;
  // Plain text and attachments cannot prove the rich-text glyph survived Gmail.
  if (
    part.mimeType === 'text/html' &&
    part.body?.data &&
    Buffer.from(part.body.data, 'base64url')
      .toString('utf8')
      .includes(`glyph=${token}`)
  )
    return true;
  return part.parts?.some((p) => containsNativeMarker(p, token)) ?? false;
}

export type MessageRecipients = {
  recipientEmail: string;
  toEmails?: string[];
  ccEmails?: string[];
  bccEmails?: string[];
};

export function normalizeNativeRecipients(message: MessageRecipients) {
  const explicit =
    message.toEmails !== undefined ||
    message.ccEmails !== undefined ||
    message.bccEmails !== undefined;
  const normalize = (emails: string[]) =>
    [...new Set(emails.map((email) => email.toLowerCase()))].sort();
  const toEmails = normalize(
    message.toEmails ?? (explicit ? [] : [message.recipientEmail]),
  );
  const ccEmails = normalize(message.ccEmails ?? []),
    bccEmails = normalize(message.bccEmails ?? []);
  const all = [...toEmails, ...ccEmails, ...bccEmails];
  if (
    !all.length ||
    all.length > 100 ||
    new Set(all).size !== all.length ||
    !all.includes(message.recipientEmail.toLowerCase())
  )
    return null;
  return { toEmails, ccEmails, bccEmails };
}

/** Empty legacy arrays represent the original single To recipient. */
export function recipientGroups(message: MessageRecipients) {
  const to = message.toEmails ?? [],
    cc = message.ccEmails ?? [],
    bcc = message.bccEmails ?? [];
  return {
    to: to.length || cc.length || bcc.length ? to : [message.recipientEmail],
    cc,
    bcc,
  };
}

export function matchesNativeSend(
  candidate: SentCandidate,
  message: {
    pixelToken: string;
    recipientEmail: string;
    toEmails?: string[];
    ccEmails?: string[];
    bccEmails?: string[];
    createdAt: Date;
  },
  mailbox: string,
): boolean {
  const headers = candidate.payload?.headers ?? [];
  const values = (name: string) =>
    headers.filter((h) => h.name.toLowerCase() === name).map((h) => h.value);
  const addresses = (name: string) => mailboxAddresses(values(name).join(','));
  const from = addresses('from');
  const groups = recipientGroups(message);
  const recipientsMatch = Object.entries(groups).every(([role, expected]) => {
    const raw = values(role).join(',');
    const actual = addresses(role)
      .map((address) => address.toLowerCase())
      .sort();
    const normalized = [
      ...new Set(expected.map((address) => address.toLowerCase())),
    ].sort();
    if (
      raw.trim() &&
      !actual.length &&
      !/^undisclosed-recipients:\s*;$/i.test(raw.trim())
    )
      return false;
    return (
      actual.length === normalized.length &&
      actual.every((address, index) => address === normalized[index])
    );
  });
  const sentAt = Number(candidate.internalDate);
  return (
    Number.isFinite(sentAt) &&
    sentAt >= message.createdAt.getTime() &&
    recipientsMatch &&
    from.length === 1 &&
    from[0].toLowerCase() === mailbox.toLowerCase() &&
    containsNativeMarker(candidate.payload, message.pixelToken)
  );
}
