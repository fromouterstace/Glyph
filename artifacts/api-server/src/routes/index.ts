import { Router, type IRouter } from "express";
import healthRouter from "./health";
import glyphRouter from "./glyph";
import glyphTrackingRouter from "./glyph-tracking";

const router: IRouter = Router();

router.use(healthRouter);
router.use(glyphTrackingRouter);
router.use(glyphRouter);

export default router;
