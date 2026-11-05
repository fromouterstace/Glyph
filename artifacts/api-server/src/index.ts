import app from './app';
import { logger } from './lib/logger';
import { pool } from '@workspace/db';
import { startManagedServer } from './lib/server-lifecycle';

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

startManagedServer({
  app,
  port,
  logger,
  closeDependencies: () => pool.end(),
});
