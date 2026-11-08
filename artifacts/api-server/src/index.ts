import app from './app';
import { logger } from './lib/logger';
import { pool } from '@workspace/db';
import { startManagedServer } from './lib/server-lifecycle';
import { startAlertWorker } from './lib/glyph-alerts';

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

let stopAlerts = () => {};
const { server } = startManagedServer({
  app,
  port,
  logger,
  closeDependencies: async () => {
    stopAlerts();
    await pool.end();
  },
});
server.once('listening', () => {
  stopAlerts = startAlertWorker();
});
