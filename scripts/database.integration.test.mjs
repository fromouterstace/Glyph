import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import express from 'express';
import pino from 'pino';
import pinoHttp from 'pino-http';
import { Writable } from 'node:stream';
import {
  serializeRequestLog,
  serializeResponseLog,
} from '../artifacts/api-server/src/lib/request-log.ts';
import {
  isolatedDatabase,
  messageFixture,
  fixtureId,
} from './lib/database-fixture.mjs';

let database, server, base;
const logs = [];
let nextRequestId = 0;
const sql = (...args) => database.query(...args);
const count = async (message) =>
  (
    await sql(
      'SELECT count(*)::int AS total FROM glyph_events WHERE message_id=$1',
      [message.id],
    )
  ).rows[0].total;
const pixel = (message, options = {}) =>
  fetch(`${base}/api/glyph/t/${message.token}.gif`, {
    ...options,
    headers: {
      'x-request-id': `glyph-integration-${message.id}`,
      ...options.headers,
    },
  });

before(async () => {
  database = await isolatedDatabase();
  const { default: tracking } =
    await import('../artifacts/api-server/src/routes/glyph-tracking.ts');
  const app = express();
  const stream = new Writable({
    write(chunk, _encoding, done) {
      logs.push(JSON.parse(chunk.toString()));
      done();
    },
  });
  const logger = pino(
    {
      level: 'info',
      redact: [
        'req.headers.authorization',
        'req.headers.cookie',
        "res.headers['set-cookie']",
      ],
    },
    stream,
  );
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) =>
        String(
          req.headers['x-request-id'] ?? `glyph-integration-${++nextRequestId}`,
        ),
      serializers: {
        req: serializeRequestLog,
        res: serializeResponseLog,
      },
    }),
  );
  app.use('/api', tracking);
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server)
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  if (database) await database.close();
});

test('a real pixel GET durably records one PostgreSQL event', async () => {
  const message = await messageFixture(sql);
  const response = await pixel(message);
  assert.equal(response.status, 200);
  assert.equal(await count(message), 1);
});

test('repeated pixel loads are separate events, not deduplicated into one open', async () => {
  const message = await messageFixture(sql);
  await Promise.all([pixel(message), pixel(message)]);
  assert.equal(await count(message), 2);
});

test('HEAD cannot manufacture a pixel-load event', async () => {
  const message = await messageFixture(sql);
  await pixel(message, { method: 'HEAD' });
  assert.equal(await count(message), 0);
});

test('disabled open tracking cannot record a pixel-load event', async () => {
  const message = await messageFixture(sql, { opens: false });
  await pixel(message);
  assert.equal(await count(message), 0);
});

test('an unconfirmed web draft cannot record an open', async () => {
  const message = await messageFixture(sql, { status: 'draft' });
  await pixel(message);
  assert.equal(await count(message), 0);
});

test('sender Gmail compose fetches do not count unconfirmed native drafts', async () => {
  const message = await messageFixture(sql, {
    status: 'draft',
    source: 'gmail',
  });
  await pixel(message, {
    headers: { referer: 'https://mail.google.com/mail/u/0/' },
  });
  assert.equal(await count(message), 0);
  assert.equal(
    logs.findLast((entry) => entry.msg === 'Tracking pixel request')?.outcome,
    'sender_compose_ignored',
  );
});

test('Google proxy requests persist their honest source classification', async () => {
  const message = await messageFixture(sql);
  await pixel(message, { headers: { 'user-agent': 'GoogleImageProxy' } });
  const { rows } = await sql(
    'SELECT source,automated FROM glyph_events WHERE message_id=$1',
    [message.id],
  );
  assert.deepEqual(rows, [
    { source: 'Google image proxy — open signal only', automated: false },
  ]);
});

test('scanner requests remain labeled automated rather than verified human reads', async () => {
  const message = await messageFixture(sql);
  await pixel(message, { headers: { 'user-agent': 'Proofpoint scanner' } });
  const { rows } = await sql(
    'SELECT automated FROM glyph_events WHERE message_id=$1',
    [message.id],
  );
  assert.deepEqual(rows, [{ automated: true }]);
});

test('recorded pixel loads emit one correlated outcome without recipient or token leakage', async () => {
  const message = await messageFixture(sql);
  await pixel(message);
  const emitted = logs.filter(
    (entry) =>
      entry.msg === 'Tracking pixel request' &&
      entry.req?.id === `glyph-integration-${message.id}`,
  );
  assert.equal(
    emitted.length,
    1,
    'Emit exactly one correlated tracking outcome.',
  );
  assert.equal(emitted[0].outcome, 'recorded');
  assert.doesNotMatch(
    JSON.stringify(emitted),
    new RegExp(`${message.token}|recipient@example`),
  );
});

async function linkFixture(message) {
  const token = fixtureId().replaceAll('-', '').padStart(48, '0');
  await sql(
    'INSERT INTO glyph_links(id,message_id,token,url) VALUES ($1,$2,$3,$4)',
    [fixtureId(), message.id, token, 'https://example.invalid/proposal'],
  );
  return `${base}/api/glyph/l/${token}`;
}

test('click redirects record clicks but never infer a pixel load', async () => {
  const message = await messageFixture(sql);
  const response = await fetch(await linkFixture(message), {
    redirect: 'manual',
  });
  const { rows } = await sql(
    'SELECT type FROM glyph_events WHERE message_id=$1',
    [message.id],
  );
  assert.equal(
    response.headers.get('location'),
    'https://example.invalid/proposal',
  );
  assert.deepEqual(rows, [{ type: 'click' }]);
});

test('disabled click tracking still redirects without recording engagement', async () => {
  const message = await messageFixture(sql, { clicks: false });
  const response = await fetch(await linkFixture(message), {
    redirect: 'manual',
  });
  assert.equal(response.status, 302);
  assert.equal(await count(message), 0);
});

test('deleting a message cascades its links and events without orphan rows', async () => {
  const message = await messageFixture(sql);
  await linkFixture(message);
  await pixel(message);
  await sql('DELETE FROM glyph_messages WHERE id=$1', [message.id]);
  assert.equal(await count(message), 0);
  assert.equal(
    (
      await sql(
        'SELECT count(*)::int AS total FROM glyph_links WHERE message_id=$1',
        [message.id],
      )
    ).rows[0].total,
    0,
  );
});

test('PostgreSQL rejects duplicate pixel tokens', async () => {
  const message = await messageFixture(sql);
  await assert.rejects(messageFixture(sql, { token: message.token }), {
    code: '23505',
  });
});

test('PostgreSQL rejects orphan engagement events', async () => {
  await assert.rejects(
    sql(
      `INSERT INTO glyph_events(id,message_id,type,source,fingerprint) VALUES ($1,$2,'open','fixture',$3)`,
      [fixtureId(), fixtureId(), fixtureId()],
    ),
    { code: '23503' },
  );
});

test('reply fingerprints enforce idempotency at the database boundary', async () => {
  const message = await messageFixture(sql);
  const fingerprint = `reply:${message.id}`;
  const insert = () =>
    sql(
      `INSERT INTO glyph_events(id,message_id,type,source,fingerprint) VALUES ($1,$2,'reply','standard Message-ID headers',$3)`,
      [fixtureId(), message.id, fingerprint],
    );
  await insert();
  await assert.rejects(insert(), { code: '23505' });
  assert.equal(await count(message), 1);
});

test('a native compose key cannot create duplicate drafts for the same owner', async () => {
  const first = await messageFixture(sql);
  const second = await messageFixture(sql);
  await sql(
    "UPDATE glyph_messages SET native_compose_key='one-compose' WHERE id=$1",
    [first.id],
  );
  await assert.rejects(
    sql(
      "UPDATE glyph_messages SET native_compose_key='one-compose' WHERE id=$1",
      [second.id],
    ),
    { code: '23505' },
  );
});

test('reply storage never manufactures a corresponding pixel-load event', async () => {
  const message = await messageFixture(sql);
  await sql(
    "INSERT INTO glyph_events(id,message_id,type,source,fingerprint) VALUES ($1,$2,'reply','standard headers',$3)",
    [fixtureId(), message.id, fixtureId()],
  );
  const { rows } = await sql(
    'SELECT type FROM glyph_events WHERE message_id=$1',
    [message.id],
  );
  assert.deepEqual(rows, [{ type: 'reply' }]);
});

test('database insert failures still return the image but emit a failure signal', async () => {
  const message = await messageFixture(sql);
  await sql(
    'ALTER TABLE glyph_events RENAME TO fixture_temporarily_unavailable',
  );
  let response;
  try {
    response = await pixel(message);
  } finally {
    await sql(
      'ALTER TABLE fixture_temporarily_unavailable RENAME TO glyph_events',
    );
  }
  assert.equal(response.status, 200);
  const failure = logs.findLast(
    (entry) =>
      entry.msg === 'Pixel signal could not be recorded' &&
      entry.req?.id === `glyph-integration-${message.id}`,
  );
  assert.ok(
    failure,
    'The failure log must include its originating request ID.',
  );
  assert.doesNotMatch(JSON.stringify(failure), new RegExp(message.token));
  assert.equal(await count(message), 0);
});
