import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { clerkClient } from '@clerk/express';
import {
  db,
  glyphGmailConnections,
  glyphGmailOAuthStates,
  glyphMessages,
} from '@workspace/db';
import {
  gmailOAuthConfig,
  gmailScopes,
  GmailAuthorizationError,
  googleOAuthFetch,
  hashOAuthValue,
  openGmailSecret,
  sealGmailSecret,
} from './gmail-oauth-config';
import {
  googleTokenSchema,
  forgetPersonalGmailGate,
  personalGmailConnection,
} from './gmail-oauth-transport';
import { mailboxContext } from './gmail';

export async function beginGmailAuthorization(
  ownerId: string,
  sessionId: string,
  origin: string,
) {
  const config = gmailOAuthConfig();
  if (origin !== config.origin)
    throw new GmailAuthorizationError(
      `Connect Gmail from ${config.origin}/gmail.`,
      409,
    );
  const state = randomBytes(32).toString('base64url');
  const verifier = randomBytes(48).toString('base64url');
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${ownerId}, 7451))`,
    );
    await tx
      .update(glyphGmailOAuthStates)
      .set({
        encryptedVerifier: '',
        expiresAt: new Date(0),
      })
      .where(eq(glyphGmailOAuthStates.ownerId, ownerId));
    await tx.insert(glyphGmailOAuthStates).values({
      stateHash: hashOAuthValue(state),
      ownerId,
      sessionHash: hashOAuthValue(sessionId),
      origin,
      encryptedVerifier: sealGmailSecret(verifier, ownerId),
      expiresAt: new Date(Date.now() + 10 * 60_000),
    });
  });
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.search = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: 'code',
    scope: gmailScopes.join(' '),
    state,
    access_type: 'offline',
    prompt: 'consent select_account',
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256',
  }).toString();
  return url.toString();
}

async function consumeState(
  ownerId: string,
  sessionId: string,
  origin: string,
  state: string,
) {
  const [row] = await db
    .update(glyphGmailOAuthStates)
    .set({ claimedAt: new Date(Date.now()) })
    .where(
      and(
        eq(glyphGmailOAuthStates.stateHash, hashOAuthValue(state)),
        eq(glyphGmailOAuthStates.ownerId, ownerId),
        eq(glyphGmailOAuthStates.sessionHash, hashOAuthValue(sessionId)),
        eq(glyphGmailOAuthStates.origin, origin),
        isNull(glyphGmailOAuthStates.claimedAt),
        gt(glyphGmailOAuthStates.expiresAt, new Date(Date.now())),
      ),
    )
    .returning();
  if (!row)
    throw new GmailAuthorizationError(
      'Gmail authorization expired or does not match this session.',
    );
  return openGmailSecret(row.encryptedVerifier, ownerId);
}

async function approvedMailbox(ownerId: string, accessToken: string) {
  const profile = await googleOAuthFetch(
    'https://gmail.googleapis.com/gmail/v1/users/me/profile',
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  );
  if (!profile.ok)
    throw new GmailAuthorizationError(
      'Google could not verify the Gmail mailbox.',
    );
  const data = (await profile.json()) as { emailAddress?: unknown };
  const email =
    typeof data.emailAddress === 'string'
      ? data.emailAddress.toLowerCase()
      : '';
  if (!/^[^\s@]+@[^\s@]+$/.test(email))
    throw new GmailAuthorizationError('Google returned no Gmail address.');
  const user = await clerkClient.users.getUser(ownerId);
  if (
    !user.emailAddresses.some(
      (address) =>
        address.verification?.status === 'verified' &&
        address.emailAddress.toLowerCase() === email,
    )
  )
    throw new GmailAuthorizationError(
      'Use Gmail matching a verified email on your Glyph account.',
    );
  return email;
}

async function saveConnection(
  ownerId: string,
  email: string,
  tokens: string,
  stateHash: string,
) {
  const existing = await personalGmailConnection(ownerId);
  let legacyIdentity: string | undefined;
  if (!existing) {
    const [message] = await db
      .select({ id: glyphMessages.id })
      .from(glyphMessages)
      .where(eq(glyphMessages.ownerId, ownerId))
      .limit(1);
    // Old records were created with the shared connector. Never rebind them to
    // a different mailbox when moving the existing owner to personal OAuth.
    if (message) {
      const legacy = await mailboxContext(true);
      if (legacy.email !== email)
        throw new GmailAuthorizationError(
          'Existing messages belong to a different Gmail mailbox.',
        );
      legacyIdentity = legacy.identity;
    }
  }
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${ownerId}, 7451))`,
    );
    const [pending] = await tx
      .update(glyphGmailOAuthStates)
      .set({
        encryptedVerifier: '',
        expiresAt: new Date(0),
      })
      .where(
        and(
          eq(glyphGmailOAuthStates.ownerId, ownerId),
          eq(glyphGmailOAuthStates.stateHash, stateHash),
          gt(glyphGmailOAuthStates.expiresAt, new Date(Date.now())),
        ),
      )
      .returning();
    if (!pending?.claimedAt)
      throw new GmailAuthorizationError(
        'Gmail authorization was cancelled or superseded.',
      );
    const [old] = await tx
      .select()
      .from(glyphGmailConnections)
      .where(eq(glyphGmailConnections.ownerId, ownerId))
      .for('update');
    if (old && old.email !== email)
      throw new GmailAuthorizationError(
        'Reconnect the previously linked Gmail account. Mailbox switching is not supported.',
      );
    const id = old?.id ?? randomUUID();
    const value = {
      ownerId,
      id,
      email,
      generation: randomUUID(),
      replyIdentity: old?.replyIdentity ?? legacyIdentity ?? `${id}:${email}`,
      encryptedTokens: sealGmailSecret(tokens, ownerId),
      updatedAt: new Date(),
    };
    await tx.insert(glyphGmailConnections).values(value).onConflictDoUpdate({
      target: glyphGmailConnections.ownerId,
      set: value,
    });
    if (old) forgetPersonalGmailGate(ownerId, old.generation);
  });
}

export async function completeGmailAuthorization(
  ownerId: string,
  sessionId: string,
  origin: string,
  input: { state: string; code?: string; denied?: boolean },
) {
  const config = gmailOAuthConfig();
  if (origin !== config.origin)
    throw new GmailAuthorizationError('Gmail callback origin does not match.');
  const verifier = await consumeState(ownerId, sessionId, origin, input.state);
  if (input.denied || !input.code) return false;
  const response = await googleOAuthFetch(
    'https://oauth2.googleapis.com/token',
    {
      method: 'POST',
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        redirect_uri: config.redirectUri,
        code: input.code,
        code_verifier: verifier,
        grant_type: 'authorization_code',
      }),
    },
  );
  if (!response.ok)
    throw new GmailAuthorizationError(
      'Google rejected Gmail authorization. Connect again.',
    );
  const parsed = googleTokenSchema.safeParse(await response.json());
  if (!parsed.success)
    throw new GmailAuthorizationError(
      'Google returned invalid authorization data.',
    );
  const grant = parsed.data;
  const scopes = new Set(grant.scope?.split(' ') ?? []);
  if (!grant.refresh_token || gmailScopes.some((scope) => !scopes.has(scope)))
    throw new GmailAuthorizationError(
      'Approve both Gmail reading and sending with offline access.',
    );
  const email = await approvedMailbox(ownerId, grant.access_token);
  await saveConnection(
    ownerId,
    email,
    JSON.stringify({
      accessToken: grant.access_token,
      refreshToken: grant.refresh_token,
      expiresAt: Date.now() + grant.expires_in * 1000,
    }),
    hashOAuthValue(input.state),
  );
  return true;
}

export async function disconnectGmail(ownerId: string) {
  const removed = await db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${ownerId}, 7451))`,
    );
    const [row] = await tx
      .select()
      .from(glyphGmailConnections)
      .where(eq(glyphGmailConnections.ownerId, ownerId))
      .for('update');
    await tx
      .update(glyphGmailOAuthStates)
      .set({
        encryptedVerifier: '',
        expiresAt: new Date(0),
      })
      .where(eq(glyphGmailOAuthStates.ownerId, ownerId));
    if (!row)
      throw new GmailAuthorizationError(
        'There is no personal Gmail connection to disconnect.',
      );
    if (!row.encryptedTokens) return null;
    await tx
      .update(glyphGmailConnections)
      .set({
        encryptedTokens: null,
        generation: randomUUID(),
        updatedAt: new Date(),
      })
      .where(eq(glyphGmailConnections.ownerId, ownerId));
    forgetPersonalGmailGate(ownerId, row.generation);
    return row;
  });
  if (!removed?.encryptedTokens) return true;
  try {
    const tokens = JSON.parse(
      openGmailSecret(removed.encryptedTokens, ownerId),
    ) as { refreshToken: string };
    const response = await googleOAuthFetch(
      'https://oauth2.googleapis.com/revoke',
      {
        method: 'POST',
        body: new URLSearchParams({ token: tokens.refreshToken }),
      },
    );
    return response.ok;
  } catch {
    // Access is already removed locally. Never restore credentials on failure.
    return false;
  }
}
