/**
 * Clerk Frontend API Proxy Middleware
 *
 * Proxies Clerk Frontend API requests through your domain, enabling Clerk
 * authentication on custom domains and .replit.app deployments without
 * requiring CNAME DNS configuration.
 *
 * AUTH CONFIGURATION: To manage users, enable/disable login providers
 * (Google, GitHub, etc.), change app branding, or configure OAuth credentials,
 * use the Auth pane in the workspace toolbar. There is no external Clerk
 * dashboard — all auth configuration is done through the Auth pane.
 *
 * IMPORTANT:
 * - Only active in production (Clerk proxying doesn't work for dev instances)
 * - Must be mounted BEFORE express.json() middleware
 *
 * Usage in app.ts:
 *   import { CLERK_PROXY_PATH, clerkProxyMiddleware } from "./middlewares/clerkProxyMiddleware";
 *   app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());
 */

import type {
  IncomingHttpHeaders,
  IncomingMessage,
  ServerResponse,
} from 'http';
import type { RequestHandler } from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';

const CLERK_FAPI = 'https://frontend-api.clerk.dev';
export const CLERK_PROXY_PATH = '/api/__clerk';

function singleHeader(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value.length === 1 ? value[0] : undefined;
  return value && !value.includes(',') ? value : undefined;
}

function normalizedHost(value: string | undefined) {
  const candidate = value?.trim();
  if (!candidate || /[\s,/@?#\\]/.test(candidate)) return undefined;
  try {
    const parsed = new URL(`https://${candidate}`);
    if (
      parsed.username ||
      parsed.password ||
      parsed.pathname !== '/' ||
      parsed.search ||
      parsed.hash
    )
      return undefined;
    return parsed.host;
  } catch {
    return undefined;
  }
}

function trustedHost(headers: IncomingHttpHeaders) {
  const forwarded = headers['x-forwarded-host'];
  return normalizedHost(
    forwarded === undefined ? headers.host : singleHeader(forwarded),
  );
}

export function getClerkProxyHost(req: {
  headers: IncomingHttpHeaders;
}): string | undefined {
  return trustedHost(req.headers);
}

export function getTrustedRequestOrigin(
  req: Pick<IncomingMessage, 'headers' | 'socket'>,
): string | undefined {
  const host = trustedHost(req.headers);
  if (!host) return undefined;
  const forwarded = req.headers['x-forwarded-proto'];
  const proto =
    forwarded === undefined
      ? process.env.NODE_ENV === 'production'
        ? 'https'
        : 'http'
      : singleHeader(forwarded)?.trim().toLowerCase();
  if (!proto || !['http', 'https'].includes(proto)) return undefined;
  if (process.env.NODE_ENV === 'production' && proto !== 'https')
    return undefined;
  return `${proto}://${host}`;
}

export function isSameTrustedOrigin(
  originHeader: string | undefined,
  requestOrigin: string | undefined,
) {
  if (!originHeader || !requestOrigin) return false;
  try {
    return (
      new URL(originHeader).origin === originHeader &&
      originHeader === requestOrigin
    );
  } catch {
    return false;
  }
}

const clerkResponseBufferLimit = 1024 * 1024;

function sendProxyError(
  res: ServerResponse,
  status: 502 | 504,
  message: string,
) {
  if (res.headersSent) {
    res.destroy();
    return;
  }
  const body = JSON.stringify({ error: message });
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  });
  res.end(body);
}

export function relayClerkResponse(
  proxyRes: IncomingMessage,
  req: IncomingMessage,
  res: ServerResponse,
) {
  const headers = { ...proxyRes.headers };
  delete headers['transfer-encoding'];
  delete headers.connection;
  delete headers['keep-alive'];
  delete headers['x-powered-by'];

  const status = proxyRes.statusCode ?? 502;
  if (status < 200 || status === 204) delete headers['content-length'];
  const bodyless =
    req.method === 'HEAD' || status < 200 || status === 204 || status === 304;
  let settled = false;
  const fail = (code: 502 | 504, message: string) => {
    if (settled) return;
    settled = true;
    sendProxyError(res, code, message);
  };

  proxyRes.on('error', () =>
    fail(502, 'The authentication service is unavailable. Try again.'),
  );
  if (bodyless) {
    res.writeHead(status, headers);
    res.end();
    proxyRes.resume();
    return;
  }
  if (headers['content-length'] !== undefined) {
    res.writeHead(status, headers);
    proxyRes.pipe(res);
    return;
  }

  const chunks: Buffer[] = [];
  let size = 0;
  proxyRes.on('data', (value: Buffer | string) => {
    if (settled) return;
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
    size += chunk.length;
    if (size > clerkResponseBufferLimit) {
      fail(502, 'The authentication service response was too large.');
      proxyRes.destroy();
      return;
    }
    chunks.push(chunk);
  });
  proxyRes.on('end', () => {
    if (settled) return;
    settled = true;
    const body = Buffer.concat(chunks);
    headers['content-length'] = String(body.length);
    res.writeHead(status, headers);
    res.end(body);
  });
}

function sendFixedError(
  res: ServerResponse,
  status: 400 | 503,
  message: string,
) {
  const body = JSON.stringify({ error: message });
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  });
  res.end(body);
}

export function clerkProxyMiddleware(): RequestHandler {
  if (process.env.NODE_ENV !== 'production')
    return (_req, _res, next) => next();

  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey)
    return (_req, res) =>
      sendFixedError(res, 503, 'Authentication proxy is unavailable.');

  const proxy = createProxyMiddleware({
    target: CLERK_FAPI,
    changeOrigin: true,
    proxyTimeout: 10_000,
    timeout: 15_000,
    selfHandleResponse: true,
    pathRewrite: (path: string) =>
      path.replace(new RegExp(`^${CLERK_PROXY_PATH}`), ''),
    on: {
      proxyReq: (proxyReq, req) => {
        const origin = getTrustedRequestOrigin(req);
        if (!origin) {
          proxyReq.destroy();
          return;
        }
        proxyReq.setHeader('Clerk-Proxy-Url', `${origin}${CLERK_PROXY_PATH}`);
        proxyReq.setHeader('Clerk-Secret-Key', secretKey);

        const xff = req.headers['x-forwarded-for'];
        const clientIp =
          (Array.isArray(xff) ? xff[0] : xff)?.split(',')[0]?.trim() ||
          req.socket?.remoteAddress ||
          '';
        if (clientIp) proxyReq.setHeader('X-Forwarded-For', clientIp);
      },
      proxyRes: relayClerkResponse,
      error: (error, _req, res) => {
        if (!('headersSent' in res)) {
          res.destroy();
          return;
        }
        const code =
          'code' in error && typeof error.code === 'string' ? error.code : '';
        sendProxyError(
          res,
          code === 'ETIMEDOUT' ? 504 : 502,
          code === 'ETIMEDOUT'
            ? 'The authentication service timed out. Try again.'
            : 'The authentication service is unavailable. Try again.',
        );
      },
    },
  }) as RequestHandler;

  return (req, res, next) => {
    if (!getTrustedRequestOrigin(req)) {
      sendFixedError(res, 400, 'Invalid forwarded request origin.');
      return;
    }
    proxy(req, res, next);
  };
}
