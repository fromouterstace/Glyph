import { createServer } from 'node:http';
import { createProductionApp } from './app.mjs';

const port = Number(process.env.PORT);
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error('PORT must be a valid web service port.');
const server = createServer(
  createProductionApp({ basePath: process.env.BASE_PATH || '/' }),
);
server.headersTimeout = 10_000;
server.requestTimeout = 15_000;
server.on('error', () => {
  console.error('Glyph web server could not start.');
  process.exit(1);
});
server.listen(port, '0.0.0.0', () =>
  console.log(`Glyph production web server listening on ${port}`),
);
let draining = false;
const shutdown = () => {
  if (draining) return;
  draining = true;
  const deadline = setTimeout(() => {
    server.closeAllConnections();
    process.exit(1);
  }, 10_000);
  server.close((error) => {
    clearTimeout(deadline);
    process.exit(error ? 1 : 0);
  });
  server.closeIdleConnections();
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
