import { Router, type IRouter } from 'express';
import {
  HealthCheckResponse,
  ReadinessCheckResponse,
} from '@workspace/api-zod';
import { pool } from '@workspace/db';
import { createReadinessProbe } from '../lib/database-readiness';
import { serverState } from '../lib/server-state';

const router: IRouter = Router();
const probe = createReadinessProbe(async () => pool.connect());

router.get('/healthz', (_req, res) => {
  const data = HealthCheckResponse.parse({ status: 'ok' });
  res.set('Cache-Control', 'no-store');
  res.json(data);
});

router.get('/readyz', async (_req, res): Promise<void> => {
  const ready =
    !serverState.draining && (await probe()) && !serverState.draining;
  res
    .set('Cache-Control', 'no-store')
    .status(ready ? 200 : 503)
    .json(
      ReadinessCheckResponse.parse({ status: ready ? 'ready' : 'not_ready' }),
    );
});

export default router;
