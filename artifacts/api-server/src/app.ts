import express, { type Express } from 'express';
import pinoHttp from 'pino-http';
import router from './routes';
import glyphTrackingRouter from './routes/glyph-tracking';
import { logger } from './lib/logger';
import { clerkMiddleware } from '@clerk/express';
import { publishableKeyFromHost } from '@clerk/shared/keys';
import {
  CLERK_PROXY_PATH,
  clerkProxyMiddleware,
  getClerkProxyHost,
} from './middlewares/clerkProxyMiddleware';

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url
            ?.split('?')[0]
            .replace(/(\/glyph\/[tl]\/)[^/]+/g, '$1[redacted]'),
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
// Tracking images and redirects are deliberately public. In particular, Clerk's
// development-browser handshake must never replace a pixel with a sign-in redirect.
// Keep all application routes below Clerk and their existing ownership checks.
app.use('/api', glyphTrackingRouter);
app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());
app.use(express.json({ limit: '100kb' }));
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
    req.log.error({ err }, 'Request failed');
    if (!res.headersSent)
      res.status(500).json({
        error: 'The request could not be completed. Please try again.',
      });
  },
);

export default app;
