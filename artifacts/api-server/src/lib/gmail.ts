import { ReplitConnectors } from '@replit/connectors-sdk';
import { clerkClient } from '@clerk/express';
import { randomBytes } from 'node:crypto';
import { logger, logSafeError } from './logger';
import { createGmailReadGate } from './gmail-rate-limit';

const connectors = new ReplitConnectors();
const readGate = createGmailReadGate();
let profileCache:
  { connectionId: string; email: string; until: number } | undefined;
const userCache = new Map<string, { authorized: boolean; until: number }>();
const profileTtlMs = 15_000;
let activeMailboxIdentity: string | undefined;

export type MailboxContext = {
  connectionId: string;
  email: string;
  identity: string;
};

function invalidateMailboxCache() {
  profileCache = undefined;
  userCache.clear();
  activeMailboxIdentity = undefined;
}

function observeMailboxIdentity(connectionId: string, email: string) {
  const identity = `${connectionId}:${email}`;
  if (activeMailboxIdentity && activeMailboxIdentity !== identity)
    userCache.clear();
  activeMailboxIdentity = identity;
  return { connectionId, email, identity };
}

async function activeGmailConnectionId(): Promise<string> {
  let connections;
  try {
    connections = await connectors.listConnections({
      connector_names: 'google-mail',
      refresh_policy: 'force',
    });
  } catch {
    invalidateMailboxCache();
    throw new Error('Gmail connection identity is unavailable.');
  }
  const matching = connections.filter(
    (connection) =>
      connection.connector_name === 'google-mail' &&
      typeof connection.id === 'string' &&
      connection.id.length > 0,
  );
  if (matching.length !== 1) {
    invalidateMailboxCache();
    throw new Error('Gmail connection identity is unavailable or ambiguous.');
  }
  return matching[0].id;
}

export async function gmailRequest(
  path: string,
  init: NonNullable<Parameters<typeof connectors.proxy>[2]> = {},
) {
  const request = () =>
    connectors.proxy('google-mail', `/gmail/v1/users/me${path}`, init);
  // Never retry or deduplicate sends/writes: that could send duplicate emails.
  return (init.method ?? 'GET').toUpperCase() === 'GET'
    ? readGate.run(request)
    : request();
}

export async function mailboxContext(
  forceProfile = false,
): Promise<MailboxContext> {
  const connectionId = await activeGmailConnectionId();
  const cachedProfile = profileCache;
  if (
    !forceProfile &&
    cachedProfile &&
    cachedProfile.until > Date.now() &&
    cachedProfile.connectionId === connectionId
  )
    return observeMailboxIdentity(connectionId, cachedProfile.email);

  try {
    const response = await gmailRequest('/profile');
    if (!response.ok)
      throw new Error(
        `Gmail connection unavailable (${response.status}). Reconnect Gmail in Integrations.`,
      );
    const data = (await response.json()) as { emailAddress?: string };
    if (!data.emailAddress)
      throw new Error('Gmail did not return an account email.');
    const email = data.emailAddress.toLowerCase();
    const verifiedConnectionId = await activeGmailConnectionId();
    if (verifiedConnectionId !== connectionId)
      throw new Error('Gmail connection changed during identity verification.');
    const mailbox = observeMailboxIdentity(connectionId, email);
    profileCache = {
      connectionId,
      email,
      until: Date.now() + profileTtlMs,
    };
    return mailbox;
  } catch (error) {
    invalidateMailboxCache();
    throw error;
  }
}

export async function mailboxEmail(): Promise<string> {
  return (await mailboxContext()).email;
}

async function mailboxForOwner(
  userId: string,
  forceProfile: boolean,
): Promise<MailboxContext | null> {
  const mailbox = await mailboxContext(forceProfile);
  const cacheKey = `${mailbox.identity}:${userId}`;
  const cached = userCache.get(cacheKey);
  if (cached && cached.until > Date.now())
    return cached.authorized ? mailbox : null;
  const user = await clerkClient.users.getUser(userId);
  const authorized = user.emailAddresses.some(
    (address) =>
      address.verification?.status === 'verified' &&
      address.emailAddress.toLowerCase() === mailbox.email,
  );
  if (userCache.size > 1000) userCache.clear();
  userCache.set(cacheKey, { authorized, until: Date.now() + 30_000 });
  return authorized ? mailbox : null;
}

export async function ownsMailbox(userId: string): Promise<boolean> {
  return (await mailboxForOwner(userId, true)) !== null;
}

export async function requireMailboxOwner(
  userId: string,
): Promise<MailboxContext> {
  const mailbox = await mailboxForOwner(userId, true);
  if (!mailbox)
    throw new Error(
      'The connected Gmail account is unavailable for this user.',
    );
  return mailbox;
}

export const newToken = () => randomBytes(24).toString('hex');
export { escapeHtml, extractUrls } from './email-content';

export { mimeMessage } from './mime-message';

export async function findSentMessage(
  rfcMessageId: string,
): Promise<string | null> {
  const response = await gmailRequest(
    `/messages?q=${encodeURIComponent(`in:sent rfc822msgid:${rfcMessageId}`)}&maxResults=1`,
  );
  if (!response.ok)
    throw new Error(
      'Unable to reconcile Gmail send status. Do not retry automatically.',
    );
  const result = (await response.json()) as { messages?: { id: string }[] };
  return result.messages?.[0]?.id ?? null;
}

export async function safeMailboxOwnership(userId: string): Promise<boolean> {
  try {
    return await ownsMailbox(userId);
  } catch (err) {
    logSafeError(logger, err, 'Could not verify Gmail ownership', 'warn');
    return false;
  }
}
