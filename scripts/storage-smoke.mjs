// Opt-in: real private storage, isolated PostgreSQL fixture, no mail delivery.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { isolatedDatabase } from './lib/database-fixture.mjs';
if (process.env.GLYPH_STORAGE_SMOKE !== '1')
  throw new Error('Explicit GLYPH_STORAGE_SMOKE=1 is required.');
const database = await isolatedDatabase();
const owner = `storage_fixture_${randomUUID()}`;
let attachmentId;
const {
  requestUpload,
  completeUpload,
  readAttachment,
  deleteUnusedAttachment,
} = await import('../artifacts/api-server/src/lib/attachments.ts');
try {
  const bytes = Buffer.from('Glyph private storage smoke\n');
  const upload = await requestUpload(owner, {
    name: 'private-storage-smoke.txt',
    size: bytes.length,
    contentType: 'text/plain',
  });
  attachmentId = upload.attachment.id;
  if (process.env.REPLIT_DEV_DOMAIN) {
    const origin = `https://${process.env.REPLIT_DEV_DOMAIN}`;
    const cors = await fetch(upload.uploadUrl, {
      method: 'OPTIONS',
      signal: AbortSignal.timeout(15000),
      headers: {
        Origin: origin,
        'Access-Control-Request-Method': 'PUT',
        'Access-Control-Request-Headers': 'content-type',
      },
    });
    assert.ok(
      [origin, '*'].includes(cors.headers.get('access-control-allow-origin')),
      'Browser uploads require an allowed CORS origin',
    );
    assert.match(cors.headers.get('access-control-allow-methods') ?? '', /PUT/);
    console.log('PASS browser upload CORS preflight');
  }
  const result = await fetch(upload.uploadUrl, {
    method: 'PUT',
    signal: AbortSignal.timeout(30000),
    headers: { 'Content-Type': 'text/plain' },
    body: bytes,
  });
  assert.equal(result.ok, true, 'Direct private upload must succeed');
  assert.ok(await completeUpload(owner, attachmentId));
  const unsigned = new URL(upload.uploadUrl);
  unsigned.search = '';
  assert.equal(
    (await fetch(unsigned, { signal: AbortSignal.timeout(15000) })).ok,
    false,
    'Unsigned storage reads must be denied',
  );
  assert.deepEqual((await readAttachment(owner, attachmentId)).content, bytes);
  await assert.rejects(
    readAttachment(`${owner}_other`, attachmentId),
    /not found/,
  );
  console.log(
    'PASS private upload, verified metadata, exact generation-pinned bytes and cross-owner denial',
  );
} catch (error) {
  console.error(
    'Private attachment storage smoke failed:',
    error instanceof Error ? error.name : 'unknown error',
  );
  process.exitCode = 1;
} finally {
  try {
    if (attachmentId) await deleteUnusedAttachment(owner, attachmentId);
  } finally {
    await database.close();
  }
}
