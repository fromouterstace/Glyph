import emailAddresses from "email-addresses";

type GmailPart = {
  mimeType?: string;
  body?: { data?: string };
  parts?: GmailPart[];
  headers?: { name: string; value: string }[];
};
export type SentCandidate = { id: string; internalDate?: string; payload?: GmailPart };

function mailboxAddresses(header: string): string[] {
  // A display name can itself look like an email address. Parse the mailbox
  // structure, not every address-shaped substring, and fail closed on groups
  // or malformed headers rather than weakening the one-recipient constraint.
  const parsed = emailAddresses.parseAddressList({ input: header, strict: true, rfc6532: true });
  if (!parsed || parsed.some((entry) => entry.type !== "mailbox")) return [];
  return parsed.flatMap((entry) => entry.type === "mailbox" ? [entry.address] : []);
}

export function containsNativeMarker(part: GmailPart | undefined, token: string): boolean {
  if (!part) return false;
  // Plain text and attachments cannot prove the rich-text glyph survived Gmail.
  if (part.mimeType === "text/html" && part.body?.data &&
    Buffer.from(part.body.data, "base64url").toString("utf8").includes(`glyph=${token}`)) return true;
  return part.parts?.some((p) => containsNativeMarker(p, token)) ?? false;
}

export function matchesNativeSend(candidate: SentCandidate, message: {
  pixelToken: string; recipientEmail: string; createdAt: Date;
}, mailbox: string): boolean {
  const headers = candidate.payload?.headers ?? [];
  const values = (name: string) => headers.filter((h) => h.name.toLowerCase() === name).map((h) => h.value);
  const addresses = (name: string) => mailboxAddresses(values(name).join(","));
  const to = addresses("to"), from = addresses("from");
  const sentAt = Number(candidate.internalDate);
  return Number.isFinite(sentAt) && sentAt >= message.createdAt.getTime() &&
    to.length === 1 && to[0].toLowerCase() === message.recipientEmail.toLowerCase() &&
    from.length === 1 && from[0].toLowerCase() === mailbox.toLowerCase() &&
    values("cc").every((v) => !v.trim()) && values("bcc").every((v) => !v.trim()) &&
    containsNativeMarker(candidate.payload, message.pixelToken);
}
