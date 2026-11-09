import { Router } from 'express';
import { clerkClient, getAuth } from '@clerk/express';
import {
  ActOnDatabaseApprovalBody,
  CreateDatabaseApprovalBody,
  ListDatabaseApprovalsQueryParams,
  GetDatabaseApprovalAccessResponse,
  ListDatabaseApprovalsResponse,
  CreateDatabaseApprovalResponse,
  ActOnDatabaseApprovalResponse,
} from '@workspace/api-zod';
import { databaseApprovalSlot } from '../lib/database-approval-policy';
import {
  actOnDatabaseApproval,
  createDatabaseApproval,
  listDatabaseApprovals,
  DatabaseApprovalError,
} from '../lib/database-approvals';
import {
  isSameTrustedOrigin,
  getTrustedRequestOrigin,
} from '../middlewares/clerkProxyMiddleware';

const router = Router();
const verify = async (id: string) =>
  databaseApprovalSlot(await clerkClient.users.getUser(id));

router.use('/glyph/database-approvals', async (req, res, next) => {
  res.set('Cache-Control', 'private, no-store');
  const { userId, sessionId } = getAuth(req);
  if (!userId || !sessionId) {
    res.status(401).json({ error: 'A signed-in session is required.' });
    return;
  }
  if (
    !['GET', 'HEAD'].includes(req.method) &&
    !isSameTrustedOrigin(req.get('origin'), getTrustedRequestOrigin(req))
  ) {
    res
      .status(403)
      .json({ error: 'A same-origin browser request is required.' });
    return;
  }
  try {
    const slot = await verify(userId);
    if (req.path === '/access' && req.method === 'GET') {
      res.json(
        GetDatabaseApprovalAccessResponse.parse({ canApprove: !!slot, slot }),
      );
      return;
    }
    if (!slot) {
      res.status(403).json({
        error: 'Access is limited to the two designated verified accounts.',
      });
      return;
    }
    res.locals.approvalActor = { userId, slot };
    next();
  } catch {
    res
      .status(503)
      .json({ error: 'Approver identity could not be verified. Retry later.' });
  }
});

router.get('/glyph/database-approvals', async (req, res) => {
  const query = ListDatabaseApprovalsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: 'Invalid page offset.' });
    return;
  }
  res.json(
    ListDatabaseApprovalsResponse.parse(
      await listDatabaseApprovals(query.data.offset ?? 0),
    ),
  );
});
router.post('/glyph/database-approvals', async (req, res) => {
  const input = CreateDatabaseApprovalBody.strict().safeParse(req.body);
  if (!input.success || input.data.reason.trim().length < 10) {
    res.status(400).json({
      error: 'Provide an operation, exact target, plan SHA-256 and reason.',
    });
    return;
  }
  res
    .status(201)
    .json(
      CreateDatabaseApprovalResponse.parse(
        await createDatabaseApproval(
          res.locals.approvalActor.userId,
          input.data,
        ),
      ),
    );
});
router.post('/glyph/database-approvals/:id/action', async (req, res) => {
  const input = ActOnDatabaseApprovalBody.strict().safeParse(req.body);
  if (!input.success || !/^[a-f0-9-]{36}$/.test(String(req.params.id))) {
    res
      .status(400)
      .json({ error: 'Provide a valid action and exact request digest.' });
    return;
  }
  try {
    res.json(
      ActOnDatabaseApprovalResponse.parse(
        await actOnDatabaseApproval(
          String(req.params.id),
          input.data.digest,
          input.data.action,
          res.locals.approvalActor,
          verify,
        ),
      ),
    );
  } catch (error) {
    if (error instanceof DatabaseApprovalError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    res.status(503).json({
      error:
        'The approval action could not be completed. Refresh before retrying.',
    });
  }
});
export default router;
