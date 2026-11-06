import { Router, type IRouter } from 'express';
import glyphRouter from './glyph';
import glyphNativeRouter from './glyph-native';
import glyphSystemRouter from './glyph-system';

const router: IRouter = Router();

router.use(glyphSystemRouter);
router.use(glyphRouter);
router.use(glyphNativeRouter);

export default router;
