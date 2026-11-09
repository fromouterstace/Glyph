import { Router, type IRouter } from 'express';
import glyphRouter from './glyph';
import glyphNativeRouter from './glyph-native';
import glyphSystemRouter from './glyph-system';
import glyphGmailRouter from './glyph-gmail';
import glyphContactsRouter from './glyph-contacts';

const router: IRouter = Router();

router.use(glyphSystemRouter);
router.use(glyphGmailRouter);
router.use(glyphRouter);
router.use(glyphNativeRouter);
router.use(glyphContactsRouter);

export default router;
