import { Router } from 'express';
import { getAuth } from '@clerk/express';
import { and, count, eq, ilike, or } from 'drizzle-orm';
import { db, glyphContacts } from '@workspace/db';
import {
  ListContactsQueryParams,
  ListContactsResponse,
  GetLabelImportResponse,
} from '@workspace/api-zod';
import { labelImportStatus, syncLabelImport } from '../lib/gmail-label-import';
import { logSafeError } from '../lib/logger';

// Mounted after glyphRouter's shared authenticated/same-origin/mailbox boundary.
const router = Router();
router.get('/glyph/contacts', async (req, res) => {
  const parsed = ListContactsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid contact filters.' });
    return;
  }
  const { offset = 0, search } = parsed.data;
  const pattern = search ? `%${search.replace(/[\\%_]/g, '\\$&')}%` : null;
  const predicate = and(
    eq(glyphContacts.ownerId, getAuth(req).userId!),
    pattern
      ? or(
          ilike(glyphContacts.firstName, pattern),
          ilike(glyphContacts.lastName, pattern),
          ilike(glyphContacts.email, pattern),
        )
      : undefined,
  );
  const [rows, [totals]] = await Promise.all([
    db
      .select()
      .from(glyphContacts)
      .where(predicate)
      .orderBy(glyphContacts.lastName, glyphContacts.email)
      .limit(50)
      .offset(offset),
    db.select({ count: count() }).from(glyphContacts).where(predicate),
  ]);
  res.json(
    ListContactsResponse.parse({
      contacts: rows.map(({ ownerId: _ownerId, ...row }) => ({
        ...row,
        createdAt: row.createdAt.toISOString(),
      })),
      total: totals.count,
      offset,
      limit: 50,
    }),
  );
});
router.get('/glyph/label-import', async (req, res) => {
  res.json(
    GetLabelImportResponse.parse(await labelImportStatus(getAuth(req).userId!)),
  );
});
router.post('/glyph/label-import', async (req, res) => {
  try {
    res.json(
      GetLabelImportResponse.parse(await syncLabelImport(getAuth(req).userId!)),
    );
  } catch (error) {
    logSafeError(req.log, error, 'Gmail label import deferred', 'warn');
    res.status(502).json({
      error:
        'Gmail label import could not finish. Check your connection and retry; stored emails are preserved.',
    });
  }
});
export default router;
