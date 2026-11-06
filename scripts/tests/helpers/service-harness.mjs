import { vi } from 'vitest';
import { once } from 'node:events';
import { isolatedDatabase, fixtureId } from '../../lib/database-fixture.mjs';

const edge = vi.hoisted(() => ({
  proxy: vi.fn(),
  connections: vi.fn(),
  getUser: vi.fn(),
  getCount: vi.fn(),
  now: Date.UTC(2026, 10, 4, 12),
}));
export { edge };
vi.mock('@replit/connectors-sdk', () => ({
  ReplitConnectors: class {
    proxy(...args) {
      return edge.proxy(...args);
    }
    listConnections(...args) {
      return edge.connections(...args);
    }
  },
}));
vi.mock('@clerk/express', () => ({
  getAuth: (req) => ({
    userId: req.headers['x-test-user'] ?? null,
    sessionId: req.headers['x-test-session'] ?? null,
  }),
  clerkMiddleware: () => (_req, _res, next) => next(),
  clerkClient: {
    users: {
      getUser: (...args) => edge.getUser(...args),
      getCount: (...args) => edge.getCount(...args),
    },
  },
}));
vi.mock('node:timers/promises', () => ({
  setTimeout: async (ms) => {
    edge.now += ms;
  },
}));
vi.mock('../../../artifacts/api-server/src/lib/logger', async () => ({
  logger: (await import('pino')).default({ level: 'silent' }),
  logSafeError: vi.fn(),
}));

export const mailbox = 'sender@example.invalid';
export const gmailConnections = (id = 'gmail-connection-fixture') => [
  { id, connector_name: 'google-mail', status: 'connected' },
];
export const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

export function defaultProvider(_integration, path) {
  if (path.endsWith('/profile')) return json({ emailAddress: mailbox });
  if (path.includes('/messages?')) return json({ messages: [] });
  throw new Error(`Unexpected provider request: ${path}`);
}

export async function serviceHarness() {
  vi.spyOn(Date, 'now').mockImplementation(() => edge.now);
  edge.proxy.mockImplementation(defaultProvider);
  edge.connections.mockResolvedValue(gmailConnections());
  edge.getUser.mockImplementation(async (id) => ({
    emailAddresses: [
      {
        emailAddress: id === 'system_admin' ? 'admin@example.invalid' : mailbox,
        verification: { status: 'verified' },
      },
    ],
  }));
  edge.getCount.mockResolvedValue(2);
  const database = await isolatedDatabase();
  const { default: app } =
    await import('../../../artifacts/api-server/src/app.ts');
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    sql: database.query,
    identity: () => `user_fixture_${fixtureId()}`,
    async request(
      path,
      {
        user = null,
        session = 'test-session',
        method = 'GET',
        body,
        headers = {},
        ...options
      } = {},
    ) {
      return fetch(`${base}/api/glyph${path}`, {
        ...options,
        method,
        headers: {
          ...(user ? { 'x-test-user': user } : {}),
          ...(session ? { 'x-test-session': session } : {}),
          origin: 'https://glyph.example',
          'x-forwarded-host': 'glyph.example',
          'x-forwarded-proto': 'https',
          'content-type': 'application/json',
          ...headers,
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    },
    async close() {
      await new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      await database.close();
      vi.restoreAllMocks();
    },
  };
}
