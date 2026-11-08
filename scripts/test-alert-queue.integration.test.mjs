import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
if (process.env.GLYPH_DATABASE_TESTS !== '1')
  throw new Error(
    'Alert queue checks require explicit GLYPH_DATABASE_TESTS=1.',
  );
const { db, pool, glyphMessages, glyphSettings, glyphEvents, glyphDeliveries } =
  await import('../lib/db/src/index.ts');
const { recordSignal } =
  await import('../artifacts/api-server/src/routes/glyph-tracking.ts');
const { eq, and } = createRequire(
  new URL('../lib/db/package.json', import.meta.url),
)('drizzle-orm');

test('live requests persist separately while email deliveries deduplicate and honor consent', async () => {
  const ownerId = `alert-test-${randomUUID()}`;
  const messageId = randomUUID();
  const preferences = (values) =>
    db
      .update(glyphSettings)
      .set(values)
      .where(eq(glyphSettings.ownerId, ownerId));
  const signal = (type, agent) => recordSignal(messageId, type, agent, null);
  const deliveries = () =>
    db
      .select()
      .from(glyphDeliveries)
      .where(eq(glyphDeliveries.ownerId, ownerId));
  try {
    await db.insert(glyphSettings).values({ ownerId, emailAlerts: false });
    await db.insert(glyphMessages).values({
      id: messageId,
      ownerId,
      recipientEmail: 'recipient@example.com',
      recipientName: 'Test',
      subject: 'Synthetic alert test',
      body: '',
      pixelToken: randomUUID(),
      rfcMessageId: randomUUID(),
      status: 'sent',
    });
    await signal('open', 'Before consent');
    assert.equal((await deliveries()).length, 0);
    const since = new Date();
    await preferences({
      emailAlerts: true,
      emailAlertsSince: since,
      alertMailbox: 'owner@example.com',
    });
    assert.equal((await deliveries()).length, 0, 'no historical backfill');
    await signal('open', 'Proofpoint scanner');
    assert.equal((await deliveries()).length, 0);
    await Promise.all(
      Array.from({ length: 5 }, () => signal('open', 'GoogleImageProxy')),
    );
    await signal('open', 'Another browser');
    const [open] = await deliveries();
    assert.equal((await deliveries()).length, 1);
    const events = await db
      .select()
      .from(glyphEvents)
      .where(eq(glyphEvents.messageId, messageId));
    assert.equal(events.length, 8, 'repeat requests remain independent events');
    assert.equal(open.consentAt.getTime(), since.getTime());
    await preferences({ notifyClicks: false });
    await signal('click', 'Disabled clicks');
    assert.equal((await deliveries()).length, 1);
    await preferences({ notifyClicks: true });
    await signal('click', 'Enabled clicks');
    assert.equal((await deliveries()).length, 2);
    await preferences({ emailAlerts: false, emailAlertsSince: null });
    await signal('click', 'Disabled alerts');
    assert.equal((await deliveries()).length, 2);
    const [scanner] = await db
      .select()
      .from(glyphEvents)
      .where(
        and(
          eq(glyphEvents.messageId, messageId),
          eq(glyphEvents.automated, true),
        ),
      );
    assert.ok(scanner, 'automated signals persist without generating email');
  } finally {
    await db.delete(glyphMessages).where(eq(glyphMessages.id, messageId));
    await db.delete(glyphSettings).where(eq(glyphSettings.ownerId, ownerId));
    await pool.end();
  }
});
