// Only the isolated process suite may run this harness. No test routes or identity
// bypasses are added to the production app.
import { db, pool } from '@workspace/db';
import app from '../../../artifacts/api-server/src/app.ts';
import { logger } from '../../../artifacts/api-server/src/lib/logger.ts';
import { startManagedServer } from '../../../artifacts/api-server/src/lib/server-lifecycle.ts';
import {
  claimDraftForSend,
  confirmSentMessage,
} from '../../../artifacts/api-server/src/lib/message-lifecycle.ts';

if (
  process.env.GLYPH_DATABASE_TESTS !== '1' ||
  process.env.NODE_ENV === 'production' ||
  !/^-c search_path=glyph_test_[a-f0-9]{32}$/.test(process.env.PGOPTIONS ?? '')
)
  throw new Error('Process harness requires an isolated database schema.');

const { server } = startManagedServer({
  app,
  port: 0,
  host: '127.0.0.1',
  logger,
  graceMs: Number(process.env.GLYPH_TEST_GRACE_MS ?? 5_000),
  closeDependencies: () => pool.end(),
});
server.once('listening', () =>
  process.send({ event: 'listening', port: server.address().port }),
);
process.on('SIGTERM', () => process.send({ event: 'draining' }));
process.on('message', async ({ action, id }) => {
  if (action === 'idle-error') {
    // Outside the command catch: without the real app listener this would be a
    // fatal EventEmitter error, as with a disconnected idle pg client.
    queueMicrotask(() =>
      pool.emit('error', new Error('Synthetic idle failure')),
    );
    process.send({ event: 'command', result: true });
    return;
  }
  try {
    const message = await db.query.glyphMessages.findFirst({
      where: (messages, { eq }) => eq(messages.id, id),
    });
    if (!message) throw new Error('Missing isolated fixture');
    const result =
      action === 'claim'
        ? await claimDraftForSend(message, [])
        : await confirmSentMessage(message, {
            gmailId: 'verified-provider-fixture',
            sentAt: new Date('2026-11-05T00:00:00Z'),
            source: 'Process recovery fixture',
            expectedStatuses: ['sending', 'uncertain'],
          });
    process.send({ event: 'command', result });
  } catch {
    process.send({ event: 'command', error: 'Fixture operation failed' });
  }
});
