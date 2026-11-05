import { createServer, type RequestListener } from 'node:http';
import type { Logger } from 'pino';
import { serverState } from './server-state';

export function startManagedServer({
  app,
  port,
  closeDependencies,
  logger,
  graceMs = 10_000,
  host = '0.0.0.0',
  exit = (code: number) => process.exit(code),
}: {
  app: RequestListener;
  port: number;
  closeDependencies: () => Promise<void>;
  logger: Logger;
  graceMs?: number;
  host?: string;
  exit?: (code: number) => void;
}) {
  const server = createServer(app);
  let stopping = false;
  const shutdown = (signal: string) => {
    if (stopping) return;
    stopping = true;
    serverState.draining = true;
    logger.info({ signal, outcome: 'draining' }, 'Server stopping');
    const deadline = setTimeout(() => {
      logger.error(
        { outcome: 'shutdown_deadline' },
        'Shutdown deadline exceeded',
      );
      server.closeAllConnections();
      exit(1);
    }, graceMs);
    server.close((error) => {
      void closeDependencies().then(
        () => {
          clearTimeout(deadline);
          const failed = Boolean(error);
          logger.info(
            { outcome: failed ? 'shutdown_failed' : 'drained' },
            'Server stopped',
          );
          exit(failed ? 1 : 0);
        },
        () => {
          clearTimeout(deadline);
          logger.error(
            { outcome: 'dependency_close_failed' },
            'Server shutdown failed',
          );
          exit(1);
        },
      );
    });
    server.closeIdleConnections();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  server.once('error', () => {
    logger.error({ outcome: 'listen_failed' }, 'Server could not start');
    exit(1);
  });
  server.listen(port, host, () => {
    logger.info(
      { port: server.address(), outcome: 'listening' },
      'Server listening',
    );
  });
  return { server, shutdown };
}
