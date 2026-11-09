import app from './app';
import { logger } from './lib/logger';
import { pool } from '@workspace/db';
import { startManagedServer } from './lib/server-lifecycle';
import { startAlertWorker } from './lib/glyph-alerts';
import { startLabelImportWorker } from './lib/gmail-label-worker';
import { inspectDatabaseAccess } from './lib/database-access';

const rawPort = process.env['PORT'];

if (!rawPort) {
  throw new Error(
    'PORT environment variable is required but was not provided.',
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

async function startApp() {
  if (process.env.GLYPH_REQUIRE_RESTRICTED_DATABASE === '1') {
    const access = await inspectDatabaseAccess({
      query: (text, values) => {
        const options = { text, values, query_timeout: 5_000 };
        return pool.query(options);
      },
    });
    if (!access.safe) {
      logger.fatal(
        { issues: access.issues },
        'Restricted database permission verification failed.',
      );
      process.exitCode = 1;
      await pool.end();
      return;
    }
  }
  let stopAlerts = () => {};
  let stopImports = () => {};
  const { server } = startManagedServer({
    app,
    port,
    logger,
    closeDependencies: async () => {
      stopAlerts();
      stopImports();
      await pool.end();
    },
  });
  server.once('listening', () => {
    stopAlerts = startAlertWorker();
    stopImports = startLabelImportWorker();
  });
}

void startApp().catch(async () => {
  logger.fatal('Server startup aborted before serving requests.');
  process.exitCode = 1;
  await Promise.allSettled([pool.end()]);
});
