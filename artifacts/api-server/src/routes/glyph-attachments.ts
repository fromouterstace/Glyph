import { Router } from 'express';
import { getAuth } from '@clerk/express';
import { RequestAttachmentUploadBody } from '@workspace/api-zod';
import {
  completeUpload,
  deleteUnusedAttachment,
  readAttachment,
  requestUpload,
} from '../lib/attachments';

// Mounted after Glyph's authenticated/same-origin/mailbox-owner middleware.
const router = Router();
router.post('/glyph/attachments', async (req, res) => {
  const input = RequestAttachmentUploadBody.safeParse(req.body);
  if (!input.success) {
    res.status(400).json({ error: 'Choose a valid attachment up to 10 MiB.' });
    return;
  }
  res.status(201).json(await requestUpload(getAuth(req).userId!, input.data));
});
router.post('/glyph/attachments/:id/complete', async (req, res) => {
  const file = await completeUpload(
    getAuth(req).userId!,
    String(req.params.id),
  );
  if (!file) {
    res.status(400).json({
      error: 'Uploaded file size did not match. The upload was rejected.',
    });
    return;
  }
  res.json(file);
});
router.get('/glyph/attachments/:id', async (req, res) => {
  const file = await readAttachment(
    getAuth(req).userId!,
    String(req.params.id),
  );
  res
    .set({
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(file.name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16)}`)}`,
      'Cache-Control': 'private, no-store',
      'Content-Security-Policy': "default-src 'none'; sandbox",
    })
    .send(file.content);
});
router.delete('/glyph/attachments/:id', async (req, res) => {
  await deleteUnusedAttachment(getAuth(req).userId!, String(req.params.id));
  res.status(204).end();
});
export default router;
