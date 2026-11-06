import { randomBytes } from 'node:crypto';
import { recipientGroups } from './native-verification';

function addressHeader(name: string, emails: string[]) {
  let line = `${name}: ${emails[0]}`;
  const lines: string[] = [];
  for (const email of emails.slice(1)) {
    if (Buffer.byteLength(`${line}, ${email}`) > 78) {
      lines.push(`${line},`);
      line = ` ${email}`;
    } else line += `, ${email}`;
  }
  return [...lines, line].join('\r\n');
}

export type MimeAttachment = {
  name: string;
  contentType: string;
  content: Buffer;
};
const encoded = (value: string | Buffer) =>
  Buffer.from(value)
    .toString('base64')
    .match(/.{1,76}/g)
    ?.join('\r\n') ?? '';
export function mimeMessage(input: {
  from: string;
  to: string;
  toEmails?: string[];
  ccEmails?: string[];
  bccEmails?: string[];
  subject: string;
  body: string;
  html: string;
  rfcMessageId: string;
  attachments?: MimeAttachment[];
}): string {
  const boundary = `glyph_${randomBytes(24).toString('hex')}`;
  const mixed = `${boundary}_mixed`;
  const recipients = recipientGroups({ recipientEmail: input.to, ...input });
  if (
    [input.from, input.rfcMessageId, ...Object.values(recipients).flat()].some(
      (value) => /[\r\n]/.test(value),
    )
  )
    throw new Error('Unsafe address header');
  const lines = [
    `From: ${input.from}`,
    recipients.to.length
      ? addressHeader('To', recipients.to)
      : 'To: undisclosed-recipients:;',
    ...(recipients.cc.length ? [addressHeader('Cc', recipients.cc)] : []),
    // Gmail needs this sender-side header to address blind copies. Gmail removes
    // it from delivered recipient copies; never put Bcc addresses in To or Cc.
    ...(recipients.bcc.length ? [addressHeader('Bcc', recipients.bcc)] : []),
    `Subject: =?UTF-8?B?${Buffer.from(input.subject).toString('base64')}?=`,
    `Message-ID: <${input.rfcMessageId}>`,
    `Date: ${new Date().toUTCString()}`,
    'MIME-Version: 1.0',
  ];
  if (input.attachments?.length)
    lines.push(
      `Content-Type: multipart/mixed; boundary="${mixed}"`,
      '',
      `--${mixed}`,
    );
  lines.push(
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    encoded(input.body),
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    encoded(input.html),
    `--${boundary}--`,
    '',
  );
  for (const file of input.attachments ?? []) {
    if (
      /[\r\n]/.test(file.contentType) ||
      !/^[\w!#$&^_.+-]+\/[\w!#$&^_.+-]+$/.test(file.contentType)
    )
      throw new Error('Unsafe attachment content type');
    const filename = encodeURIComponent(file.name).replace(
      /['()*]/g,
      (c) => `%${c.charCodeAt(0).toString(16)}`,
    );
    lines.push(
      `--${mixed}`,
      `Content-Type: ${file.contentType}`,
      `Content-Disposition: attachment; filename*=UTF-8''${filename}`,
      'Content-Transfer-Encoding: base64',
      '',
      encoded(file.content),
      '',
    );
  }
  if (input.attachments?.length) lines.push(`--${mixed}--`, '');
  return Buffer.from(lines.join('\r\n')).toString('base64url');
}
