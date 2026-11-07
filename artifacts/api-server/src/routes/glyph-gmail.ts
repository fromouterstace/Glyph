import { Router } from 'express';
import { getAuth } from '@clerk/express';
import {
  GetGmailAuthorizationResponse,
  BeginGmailAuthorizationResponse,
  CompleteGmailAuthorizationQueryParams,
  DisconnectGmailResponse,
} from '@workspace/api-zod';
import {
  beginGmailAuthorization,
  completeGmailAuthorization,
  disconnectGmail,
} from '../lib/gmail-oauth';
import { gmailOAuthConfig } from '../lib/gmail-oauth-config';
import { personalGmailConnection } from '../lib/gmail-oauth-transport';
import { ownsMailbox, userMailboxEmail } from '../lib/gmail';
import {
  getTrustedRequestOrigin,
  isSameTrustedOrigin,
} from '../middlewares/clerkProxyMiddleware';

const router = Router();
router.use('/glyph/gmail', (req, res, next) => {
  res.set({
    'Cache-Control': 'private, no-store',
    'Referrer-Policy': 'no-referrer',
  });
  const { userId, sessionId } = getAuth(req);
  if (!userId || !sessionId) {
    res.status(401).json({ error: 'Sign in before connecting Gmail.' });
    return;
  }
  if (
    !['GET', 'HEAD'].includes(req.method) &&
    !isSameTrustedOrigin(req.get('origin'), getTrustedRequestOrigin(req))
  ) {
    res
      .status(403)
      .json({ error: 'A same-origin browser request is required.' });
    return;
  }
  next();
});

router.get('/glyph/gmail/authorization', async (req, res): Promise<void> => {
  const ownerId = getAuth(req).userId!;
  let connectOrigin: string | null = null;
  try {
    connectOrigin = gmailOAuthConfig().origin;
  } catch {
    /* Explicitly not configured. */
  }
  const grant = await personalGmailConnection(ownerId);
  let connected = !!grant?.encryptedTokens;
  let email = grant?.email ?? null;
  let kind: 'personal' | 'legacy' | 'none' = grant ? 'personal' : 'none';
  if (!grant) {
    try {
      if (await ownsMailbox(ownerId)) {
        connected = true;
        email = await userMailboxEmail(ownerId);
        kind = 'legacy';
      }
    } catch {
      /* A missing legacy connection must not block personal setup. */
    }
  }
  res.json(
    GetGmailAuthorizationResponse.parse({
      configured: !!connectOrigin,
      connectOrigin,
      connected,
      email,
      kind,
    }),
  );
});

router.post('/glyph/gmail/authorization', async (req, res): Promise<void> => {
  const { userId, sessionId } = getAuth(req);
  const authorizationUrl = await beginGmailAuthorization(
    userId!,
    sessionId!,
    getTrustedRequestOrigin(req)!,
  );
  res.json(BeginGmailAuthorizationResponse.parse({ authorizationUrl }));
});

router.delete('/glyph/gmail/authorization', async (req, res): Promise<void> => {
  const revocationConfirmed = await disconnectGmail(getAuth(req).userId!);
  res.json(
    DisconnectGmailResponse.parse({ disconnected: true, revocationConfirmed }),
  );
});

router.get('/glyph/gmail/oauth/callback', async (req, res): Promise<void> => {
  const config = gmailOAuthConfig();
  const { userId, sessionId } = getAuth(req);
  const parsed = CompleteGmailAuthorizationQueryParams.safeParse(req.query);
  let outcome = 'failed';
  try {
    if (parsed.success) {
      const connected = await completeGmailAuthorization(
        userId!,
        sessionId!,
        getTrustedRequestOrigin(req) ?? '',
        {
          state: parsed.data.state,
          code: parsed.data.code,
          denied: !!parsed.data.error,
        },
      );
      outcome = connected ? 'connected' : 'denied';
    }
  } catch {
    req.log.warn(
      { outcome: 'gmail_authorization_failed' },
      'Gmail authorization did not complete',
    );
  }
  res.redirect(303, `${config.origin}/gmail?gmail=${outcome}`);
});

export default router;
