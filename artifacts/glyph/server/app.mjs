import express from 'express';
import { accessSync, constants } from 'node:fs';
import { extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const defaultRoot = fileURLToPath(new URL('../dist/public/', import.meta.url));
const publicRootFiles = new Set([
  '/index.html',
  '/favicon.svg',
  '/logo.svg',
  '/robots.txt',
  '/glyph-extension.zip',
]);

// Production only. Vite still owns Preview, including Replit's preview iframe.
export const documentHeaders = Object.freeze({
  'Content-Security-Policy':
    "frame-ancestors 'none'; object-src 'none'; base-uri 'self'",
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
});

export function createProductionApp({
  root = defaultRoot,
  basePath = '/',
} = {}) {
  if (!/^\/(?:[^?#\\]*\/)?$/.test(basePath))
    throw new Error('Invalid web base path');
  const directory = resolve(root);
  accessSync(resolve(directory, 'index.html'), constants.R_OK);
  const app = express();
  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.set({ ...documentHeaders, 'Cache-Control': 'no-store' });
    next();
  });
  const router = express.Router();
  // /api belongs to its separate service. Never disguise a routing failure as HTML.
  router.use((req, res, next) => {
    let path;
    try {
      path = decodeURIComponent(req.path);
    } catch {
      res.status(400).end();
      return;
    }
    if (
      /^\/api(?:\/|$)/i.test(path) ||
      /(?:^|\/)\./.test(path) ||
      path.includes('\\') ||
      path.endsWith('.map')
    ) {
      res.status(404).end();
      return;
    }
    next();
  });
  const serveStatic = express.static(directory, {
    index: false,
    redirect: false,
    dotfiles: 'deny',
    setHeaders(res, path) {
      if (/[\\/]assets[\\/].+-[A-Za-z0-9_-]{8,}\.(?:js|css)$/.test(path))
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    },
  });
  router.use((req, res, next) => {
    const path = decodeURIComponent(req.path);
    const asset =
      /^\/assets\/.+\.(?:js|css|svg|png|jpe?g|gif|webp|avif|ico|woff2?|ttf|otf)$/i.test(
        path,
      );
    if (!publicRootFiles.has(path) && !asset) {
      next();
      return;
    }
    serveStatic(req, res, next);
  });
  router.use((req, res) => {
    if (!['GET', 'HEAD'].includes(req.method)) {
      res.status(405).set('Allow', 'GET, HEAD').end();
      return;
    }
    if (/^\/assets(?:\/|$)/.test(req.path) || extname(req.path)) {
      res.status(404).end();
      return;
    }
    res.sendFile(resolve(directory, 'index.html'));
  });
  app.use(basePath, router);
  app.use((_req, res) => res.status(404).end());
  app.use((error, _req, res, _next) => {
    // Express recognizes error middleware by its four-argument signature.
    void _next;
    if (res.headersSent) {
      res.destroy();
      return;
    }
    const status = [400, 403, 404].includes(error.status) ? error.status : 500;
    res.status(status).json({ error: 'Web resource unavailable.' });
  });
  return app;
}
