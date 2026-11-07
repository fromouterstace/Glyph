# Personal Gmail connections

## Scope

Each signed-in Glyph user can explicitly authorize one Gmail account. Its Google
profile address must match a verified email on that user's Clerk account.
Web sending, native-send verification, provider-independent reply detection and
extension compose checks select that user's connection on the server.

Multiple To/Cc/Bcc recipients remain supported. Multiple sending mailboxes per
Glyph user, mailbox switching and Gmail send-as aliases are not implemented.
Disconnect preserves the mailbox binding, messages, attachments and signal history.
Existing public pixels/links keep working. A Gmail request already in flight may
finish after disconnection.

The old project connector is retained only for its existing verified owner until
they migrate. A personal connection—even a disconnected/revoked one—always takes
precedence; it never falls back to the shared connector. Migrating legacy records
checks their original mailbox and retains reply deduplication identity.

## Google setup and launch requirements

Enable the Gmail API in the Google Cloud project. Create a Web application OAuth
client and configure the consent screen with:

- `https://www.googleapis.com/auth/gmail.readonly`
- `https://www.googleapis.com/auth/gmail.send`

The exact redirect URI is the configured `GLYPH_GMAIL_OAUTH_ORIGIN` followed by
`/api/glyph/gmail/oauth/callback`. The configured production origin is
`https://glyph.rocks`; the registered callback must therefore be
`https://glyph.rocks/api/glyph/gmail/oauth/callback`.

Store `GOOGLE_GMAIL_CLIENT_ID` and `GOOGLE_GMAIL_CLIENT_SECRET` in Replit Secrets.
Do not substitute the Replit-managed Clerk keys or personal Gmail passwords.
Preview and other origins link to the configured production Gmail page; they
cannot begin real authorization against a different environment.

Google classifies Gmail read access as restricted. Follow its applicable consent
verification, limited-use and security-assessment requirements before broad public
rollout. Until approval, use Google's configured test-user audience. Testing-mode
Google refresh tokens may expire and require renewed consent.

References:

- https://developers.google.com/identity/protocols/oauth2/web-server
- https://developers.google.com/workspace/gmail/api/auth/scopes

## Security and lifecycle

- OAuth initiation and disconnect require Clerk authentication, an active session
  and a same-origin browser write. Callback state is bound to that owner/session,
  the canonical origin and a ten-minute expiry; PKCE uses S256.
- PostgreSQL stores only a hash of OAuth state and an encrypted PKCE verifier.
  Claimed callbacks cannot be replayed; reconnect/disconnect invalidates pending
  and already-claimed callbacks before credentials can be committed.
- Tokens are encrypted with AES-256-GCM and owner-bound associated data. The key
  is purpose-derived with HKDF from the existing `SESSION_SECRET`. This secret
  must remain stable; changing it makes saved credentials unreadable and users
  must reconnect. Never log tokens, authorization codes or raw provider errors.
- Refresh takes a PostgreSQL row lock to serialize refresh/disconnect across
  processes. Missing grants, token decryption failures, revoked grants and
  generation changes fail closed. Gmail writes are never retried automatically.
- Disconnect erases local credentials first and separately attempts Google
  revocation. If Google revocation fails, UI says so and directs the user to
  remove access in their Google Account. It never restores local credentials.
- Authorization/Sent/header caches include connection generation; read budgets
  are scoped to the mailbox. Reply deduplication identity remains stable across
  same-mailbox reconnects and legacy migration.

## Verification and publishing

The OAuth integration suite uses isolated PostgreSQL and mocked Google/Clerk
boundaries; it never sends real email or uses actual Google credentials.
It covers state/PKCE/session/owner validation, scopes, encrypted storage,
multi-owner sending, Sent/reply isolation, extension sender mismatch, refresh,
disconnect/reconnect races, revocation, throttling and non-retried sends.
UI tests cover preview routing, configuration errors and explicit disconnect.
Anonymous HTTP checks include all new authorization routes.

Publish applies the new PostgreSQL relations to production. Workspace tests
cannot prove the registered Google client or consent-screen configuration is
correct. After publishing, a controlled account must complete Google consent,
send to an approved test recipient, and confirm the native-send/reply journey.
Do not describe that external journey as verified until observed.
