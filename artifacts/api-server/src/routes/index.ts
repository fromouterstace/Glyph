import { Router, type IRouter } from 'express';
import healthRouter from './health';
import glyphRouter from './glyph';
import glyphNativeRouter from './glyph-native';

const router: IRouter = Router();

router.use(healthRouter);
router.use(glyphRouter);
router.use(glyphNativeRouter);

export default router;
