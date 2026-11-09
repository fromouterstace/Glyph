export type LabelPayload = {
  mimeType?: string;
  headers?: { name: string; value: string }[];
  body?: { data?: string };
  parts?: LabelPayload[];
};
export type LabelMessage = {
  id: string;
  internalDate?: string;
  labelIds?: string[];
  payload?: LabelPayload;
};
export type LabelContact = {
  firstName: string;
  lastName: string;
  email: string;
  emailSuffix: string;
};

function decodeWords(value: string) {
  return value.replace(
    /=\?([^?]+)\?([bq])\?([^?]*)\?=/gi,
    (original, charset: string, encoding: string, encoded: string) => {
      try {
        const bytes =
          encoding.toLowerCase() === 'b'
            ? Buffer.from(encoded, 'base64')
            : Buffer.from(
                encoded
                  .replaceAll('_', ' ')
                  .replace(/=([a-f0-9]{2})/gi, (_, hex: string) =>
                    String.fromCharCode(parseInt(hex, 16)),
                  ),
                'latin1',
              );
        return new TextDecoder(charset).decode(bytes);
      } catch {
        return original;
      }
    },
  );
}

export function labelAddresses(value: string): LabelContact[] {
  const matches = decodeWords(value).matchAll(
    /(?:"([^"]*)"|([^<>,]*))?\s*<([^<>\s]+@[^<>\s]+)>|([a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,})/gi,
  );
  const result = new Map<string, LabelContact>();
  for (const match of matches) {
    const email = (match[3] ?? match[4]).trim().toLowerCase();
    if (email.length > 254 || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email))
      continue;
    const name = (match[1] ?? match[2] ?? '')
      .trim()
      .replace(/^["']|["']$/g, '');
    const [firstName = '', ...last] = name.split(/\s+/).filter(Boolean);
    result.set(email, {
      firstName: firstName.slice(0, 200),
      lastName: last.join(' ').slice(0, 200),
      email,
      emailSuffix: email.slice(email.lastIndexOf('@') + 1),
    });
  }
  return [...result.values()];
}

function messageText(payload: LabelPayload, depth = 0): string {
  if (depth > 8) return '';
  if (payload.mimeType === 'text/plain' && payload.body?.data)
    return Buffer.from(payload.body.data, 'base64url')
      .toString('utf8')
      .slice(0, 50_000);
  const parts = payload.parts ?? [];
  for (const part of parts) {
    const text = messageText(part, depth + 1);
    if (text) return text;
  }
  if (payload.mimeType === 'text/html' && payload.body?.data)
    return Buffer.from(payload.body.data, 'base64url')
      .toString('utf8')
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]*>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&amp;/gi, '&')
      .trim()
      .slice(0, 50_000);
  return '';
}

export function parseLabelMessage(message: LabelMessage, ownEmail: string) {
  if (!message.id || !message.payload)
    throw new Error('Gmail message metadata is incomplete.');
  const header = (name: string) =>
    message.payload?.headers?.find((h) => h.name.toLowerCase() === name)
      ?.value ?? '';
  const from = labelAddresses(header('from'));
  const to = labelAddresses(header('to'));
  const cc = labelAddresses(header('cc'));
  const bcc = labelAddresses(header('bcc'));
  const byEmail = new Map<string, LabelContact>();
  for (const contact of [...from, ...to, ...cc, ...bcc]) {
    if (contact.email === ownEmail.toLowerCase()) continue;
    const existing = byEmail.get(contact.email);
    if (!existing || (!existing.firstName && contact.firstName))
      byEmail.set(contact.email, contact);
  }
  const contacts = [...byEmail.values()];
  const counterpart =
    from.find((c) => c.email !== ownEmail.toLowerCase()) ?? contacts[0];
  const sentAt = new Date(Number(message.internalDate));
  if (!Number.isFinite(sentAt.getTime()))
    throw new Error('Gmail message date is invalid.');
  return {
    contacts,
    values: {
      recipientEmail: counterpart?.email ?? ownEmail,
      recipientName: counterpart
        ? [counterpart.firstName, counterpart.lastName]
            .filter(Boolean)
            .join(' ')
        : '',
      toEmails: to.map((c) => c.email),
      ccEmails: cc.map((c) => c.email),
      bccEmails: bcc.map((c) => c.email),
      subject: decodeWords(header('subject')).slice(0, 1000),
      body: messageText(message.payload),
      rfcMessageId: header('message-id').trim() || `${message.id}@gmail.import`,
      sentAt,
    },
  };
}
