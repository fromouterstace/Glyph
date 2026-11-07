import { Router, type IRouter } from 'express';
import glyphRouter from './glyph';
import glyphNativeRouter from './glyph-native';
import glyphSystemRouter from './glyph-system';
import glyphGmailRouter from './glyph-gmail';

const router: IRouter = Router();

router.use(glyphSystemRouter);
router.use(glyphGmailRouter);
router.use(glyphRouter);
router.use(glyphNativeRouter);

export default router;
