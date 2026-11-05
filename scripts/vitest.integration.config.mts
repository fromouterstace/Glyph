import { defineConfig } from 'vitest/config';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const apiRequire = createRequire(
  new URL('../artifacts/api-server/package.json', import.meta.url),
);
export default defineConfig({
  resolve: {
    alias: {
      '@clerk/express': apiRequire.resolve('@clerk/express'),
      '@replit/connectors-sdk': apiRequire.resolve('@replit/connectors-sdk'),
    },
  },
  test: {
    root: fileURLToPath(new URL('.', import.meta.url)),
    environment: 'node',
    include: ['tests/**/*.integration.test.mjs'],
    maxWorkers: 1,
    testTimeout: 15_000,
    hookTimeout: 30_000,
  },
});
