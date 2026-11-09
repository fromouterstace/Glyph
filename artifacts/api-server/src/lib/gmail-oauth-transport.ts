import { and, eq } from 'drizzle-orm';
import { db, glyphGmailConnections } from '@workspace/db';
import { z } from 'zod';
import {
  gmailOAuthConfig,
  GmailAuthorizationError,
  googleOAuthFetch,
  openGmailSecret,
  sealGmailSecret,
} from './gmail-oauth-config';
import { createGmailReadGate } from './gmail-rate-limit';

export const gmailTokenSchema = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
  expiresAt: z.number().finite(),
});
export const googleTokenSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1).optional(),
  token_type: z.string().refine((value) => value.toLowerCase() === 'bearer'),
  expires_in: z.number().positive().max(86_400),
  scope: z.string().optional(),
});
const gates = new Map<
  string,
  { gate: ReturnType<typeof createGmailReadGate>; lastUsed: number }
>();

export async function personalGmailConnection(ownerId: string) {
  const [row] = await db
    .select()
    .from(glyphGmailConnections)
    .where(eq(glyphGmailConnections.ownerId, ownerId));
  return row;
}

async function accessToken(ownerId: string, generation: string) {
  const result = await db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(glyphGmailConnections)
      .where(eq(glyphGmailConnections.ownerId, ownerId))
      .for('update');
    if (!row?.encryptedTokens || row.generation !== generation)
      throw new GmailAuthorizationError(
        'Gmail was disconnected or changed. Reconnect and retry.',
      );
    const tokens = gmailTokenSchema.parse(
      JSON.parse(openGmailSecret(row.encryptedTokens, ownerId)),
    );
    if (tokens.expiresAt > Date.now() + 60_000)
      return { token: tokens.accessToken };
    const config = gmailOAuthConfig();
    const response = await googleOAuthFetch(
      'https://oauth2.googleapis.com/token',
      {
        method: 'POST',
        body: new URLSearchParams({
          client_id: config.clientId,
          client_secret: config.clientSecret,
          refresh_token: tokens.refreshToken,
          grant_type: 'refresh_token',
        }),
      },
    );
    if (response.status === 400 || response.status === 401) {
      await tx
        .update(glyphGmailConnections)
        .set({ encryptedTokens: null, updatedAt: new Date() })
        .where(eq(glyphGmailConnections.ownerId, ownerId));
      return { token: null };
    }
    if (!response.ok)
      throw new GmailAuthorizationError(
        'Google could not refresh Gmail access. Try again.',
        502,
      );
    const data = googleTokenSchema.safeParse(await response.json());
    if (!data.success)
      throw new GmailAuthorizationError(
        'Google returned invalid authorization data.',
        502,
      );
    const next = {
      accessToken: data.data.access_token,
      refreshToken: data.data.refresh_token ?? tokens.refreshToken,
      expiresAt: Date.now() + data.data.expires_in * 1000,
    };
    await tx
      .update(glyphGmailConnections)
      .set({
        encryptedTokens: sealGmailSecret(JSON.stringify(next), ownerId),
        updatedAt: new Date(),
      })
      .where(eq(glyphGmailConnections.ownerId, ownerId));
    return { token: next.accessToken };
  });
  if (!result.token)
    throw new GmailAuthorizationError(
      'Google revoked Gmail access. Reconnect Gmail.',
    );
  return result.token;
}

export async function personalGmailRequest(
  ownerId: string,
  generation: string,
  path: string,
  init: RequestInit = {},
) {
  // Label discovery is read-only. Do not expand this to label mutations or
  // arbitrary Gmail paths when adding an importer endpoint.
  const labelRead =
    path === '/labels' && (init.method ?? 'GET').toUpperCase() === 'GET';
  if (
    (!labelRead && !/^\/(?:messages|profile)(?:[/?]|$)/.test(path)) ||
    path.includes('\\') ||
    path.includes('#')
  )
    throw new GmailAuthorizationError('Unsupported Gmail request.', 400);
  const key = `${ownerId}:${generation}`;
  let budget = gates.get(key);
  if (!budget) {
    for (const [oldKey, old] of gates) {
      if (Date.now() - old.lastUsed > 30 * 60_000 && old.gate.isIdle())
        gates.delete(oldKey);
    }
    if (gates.size >= 1000)
      throw new GmailAuthorizationError(
        'Gmail checks are busy. Try again.',
        503,
      );
    budget = { gate: createGmailReadGate(), lastUsed: Date.now() };
    gates.set(key, budget);
  }
  budget.lastUsed = Date.now();
  const request = async () => {
    const token = await accessToken(ownerId, generation);
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${token}`);
    // Never retry a Gmail write, including a transport failure or a 401.
    const response = await googleOAuthFetch(
      `https://gmail.googleapis.com/gmail/v1/users/me${path}`,
      { ...init, headers },
    );
    if (response.status === 401) {
      await db
        .update(glyphGmailConnections)
        .set({ encryptedTokens: null, updatedAt: new Date() })
        .where(
          and(
            eq(glyphGmailConnections.ownerId, ownerId),
            eq(glyphGmailConnections.generation, generation),
          ),
        );
    }
    return response;
  };
  return (init.method ?? 'GET').toUpperCase() === 'GET'
    ? budget.gate.run(request)
    : request();
}

export function forgetPersonalGmailGate(ownerId: string, generation: string) {
  gates.delete(`${ownerId}:${generation}`);
}
