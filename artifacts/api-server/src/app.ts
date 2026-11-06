import express, { type Express } from 'express';
import pinoHttp from 'pino-http';
import router from './routes';
import healthRouter from './routes/health';
import glyphTrackingRouter from './routes/glyph-tracking';
import { logger, logSafeError } from './lib/logger';
import { GmailRateLimitError } from './lib/gmail-rate-limit';
import { ComposerError } from './lib/composer-policy';
import { serializeRequestLog, serializeResponseLog } from './lib/request-log';
import { clerkMiddleware } from '@clerk/express';
import { publishableKeyFromHost } from '@clerk/shared/keys';
import {
  CLERK_PROXY_PATH,
  clerkProxyMiddleware,
  getClerkProxyHost,
} from './middlewares/clerkProxyMiddleware';

const app: Express = express();
app.disable('x-powered-by');

app.use(
  pinoHttp({
    logger,
    serializers: {
      req: serializeRequestLog,
      res: serializeResponseLog,
    },
  }),
);
app.use((_req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Content-Security-Policy':
      "frame-ancestors 'none'; object-src 'none'; base-uri 'self'",
  });
  next();
});
// Tracking images and redirects are deliberately public. In particular, Clerk's
// development-browser handshake must never replace a pixel with a sign-in redirect.
// Keep all application routes below Clerk and their existing ownership checks.
app.use('/api', healthRouter);
app.use('/api', glyphTrackingRouter);
app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());
// Rich HTML and its plain-text alternative can each contain 50,000 Unicode characters.
app.use(express.json({ limit: '512kb' }));
app.use(express.urlencoded({ extended: true }));
app.use(
  clerkMiddleware((req) => ({
    publishableKey: publishableKeyFromHost(
      getClerkProxyHost(req) ?? '',
      process.env.CLERK_PUBLISHABLE_KEY,
    ),
  })),
);

app.use('/api', router);
app.use(
  (
    err: unknown,
    req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    if (err instanceof ComposerError && !res.headersSent) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    const bodyFailure =
      err && typeof err === 'object' && 'type' in err ? err.type : null;
    if (
      !res.headersSent &&
      (bodyFailure === 'entity.parse.failed' ||
        bodyFailure === 'entity.too.large')
    ) {
      const tooLarge = bodyFailure === 'entity.too.large';
      req.log.warn({ outcome: bodyFailure }, 'Request body rejected');
      res.status(tooLarge ? 413 : 400).json({
        error: tooLarge
          ? 'The request body is too large.'
          : 'Enter a valid JSON request body.',
      });
      return;
    }
    if (err instanceof GmailRateLimitError && !res.headersSent) {
      const seconds = Math.max(1, Math.ceil((err.retryAt - Date.now()) / 1000));
      req.log.warn(
        { retryAfterSeconds: seconds },
        'Gmail reads paused by rate limit',
      );
      res
        .set('Retry-After', String(seconds))
        .status(429)
        .json({ error: err.message });
      return;
    }
    logSafeError(req.log, err, 'Request failed');
    if (!res.headersSent)
      res.status(500).json({
        error: 'The request could not be completed. Please try again.',
      });
  },
);

export default app;
