import type { Message } from '@workspace/api-client-react';

export type RecipientText = { to: string; cc: string; bcc: string };
export const splitEmails = (text: string) =>
  text
    .split(/[,;\n]+/)
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
export function initialRecipients(message?: Message | null): RecipientText {
  if (!message) return { to: '', cc: '', bcc: '' };
  const explicit = [message.toEmails, message.ccEmails, message.bccEmails].some(
    (list) => list?.length,
  );
  return {
    to: (explicit ? (message.toEmails ?? []) : [message.recipientEmail]).join(
      ', ',
    ),
    cc: (message.ccEmails ?? []).join(', '),
    bcc: (message.bccEmails ?? []).join(', '),
  };
}
export function recipientInput(value: RecipientText) {
  const toEmails = splitEmails(value.to),
    ccEmails = splitEmails(value.cc),
    bccEmails = splitEmails(value.bcc);
  return {
    recipientEmail: [...toEmails, ...ccEmails, ...bccEmails][0] ?? '',
    toEmails,
    ccEmails,
    bccEmails,
  };
}
export function recipientError(value: RecipientText) {
  const input = recipientInput(value);
  const all = [...input.toEmails, ...input.ccEmails, ...input.bccEmails];
  if (!all.length) return 'Enter at least one recipient in To, Cc or Bcc.';
  if (all.length > 100) return 'Use up to 100 recipients in total.';
  if (
    all.some(
      (email) =>
        email.length > 254 ||
        !/^[^\s@<>:]+@[^\s@<>:]+\.[^\s@<>:]+$/.test(email),
    )
  )
    return 'Enter email addresses only, separated by commas or semicolons.';
  if (new Set(all).size !== all.length)
    return 'Do not repeat an address across To, Cc and Bcc.';
  return null;
}
