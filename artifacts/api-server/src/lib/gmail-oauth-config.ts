import {
  createCipheriv,
  createDecipheriv,
  createHash,
  hkdfSync,
  randomBytes,
} from 'node:crypto';

export class GmailAuthorizationError extends Error {
  constructor(
    message: string,
    public readonly status = 409,
  ) {
    super(message);
    this.name = 'GmailAuthorizationError';
  }
}

export const gmailScopes = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
];
export const hashOAuthValue = (value: string) =>
  createHash('sha256').update(value).digest('hex');

export function gmailOAuthConfig() {
  const clientId = process.env.GOOGLE_GMAIL_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_GMAIL_CLIENT_SECRET;
  const origin = process.env.GLYPH_GMAIL_OAUTH_ORIGIN;
  const secret = process.env.SESSION_SECRET;
  if (!clientId || !clientSecret || !origin || !secret || secret.length < 32)
    throw new GmailAuthorizationError(
      'Individual Gmail connections are not configured yet.',
      503,
    );
  const url = new URL(origin);
  if (
    url.protocol !== 'https:' ||
    url.origin !== origin ||
    url.hostname.endsWith('.replit.dev') ||
    url.username ||
    url.password
  )
    throw new GmailAuthorizationError(
      'The Gmail authorization origin is not configured correctly.',
      503,
    );
  return {
    clientId,
    clientSecret,
    origin,
    redirectUri: `${origin}/api/glyph/gmail/oauth/callback`,
  };
}

function encryptionKey() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32)
    throw new GmailAuthorizationError(
      'Gmail credential encryption is unavailable.',
      503,
    );
  return Buffer.from(
    hkdfSync('sha256', secret, 'glyph-gmail', 'credentials-v1', 32),
  );
}

export function sealGmailSecret(value: string, ownerId: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  cipher.setAAD(Buffer.from(ownerId));
  const encrypted = Buffer.concat([
    cipher.update(value, 'utf8'),
    cipher.final(),
  ]);
  return [iv, cipher.getAuthTag(), encrypted]
    .map((part) => part.toString('base64url'))
    .join('.');
}

export function openGmailSecret(value: string, ownerId: string) {
  try {
    const [iv, tag, encrypted] = value
      .split('.')
      .map((part) => Buffer.from(part, 'base64url'));
    const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), iv);
    decipher.setAAD(Buffer.from(ownerId));
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    throw new GmailAuthorizationError(
      'Gmail credentials cannot be read. Reconnect Gmail.',
    );
  }
}

export async function googleOAuthFetch(url: string, init: RequestInit) {
  try {
    return await fetch(url, {
      ...init,
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new GmailAuthorizationError(
      'Google authorization is temporarily unavailable. Try again.',
      502,
    );
  }
}
