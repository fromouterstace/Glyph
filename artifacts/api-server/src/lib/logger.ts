import pino, { type Logger } from 'pino';

const isProduction = process.env.NODE_ENV === 'production';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  redact: [
    'req.headers.authorization',
    'req.headers.cookie',
    "res.headers['set-cookie']",
  ],
  ...(isProduction
    ? {}
    : {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true },
        },
      }),
});

/**
 * Log only a fixed error classification. Raw Error serialization can disclose
 * SQL text, query parameters, message content, provider responses, or secrets.
 */
export function logSafeError(
  target: Logger,
  error: unknown,
  message: string,
  level: 'error' | 'warn' = 'error',
): void {
  let errorType = 'NonError';
  try {
    if (error instanceof Error) errorType = 'Error';
  } catch {
    // Untrusted thrown values must not break the failure handler.
  }
  const fields = { errorType };

  if (level === 'warn') target.warn(fields, message);
  else target.error(fields, message);
}
