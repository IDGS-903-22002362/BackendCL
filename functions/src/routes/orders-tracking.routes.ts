import { Router } from "express";
import { z } from "zod";
import { validateParams } from "../middleware/validation.middleware";
import * as shippingController from "../modules/shipping/shipping.controller";
import { authMiddleware } from "../utils/middlewares";

const router = Router();

const orderIdParamSchema = z
  .object({
    orderId: z.string().trim().min(1).max(120),
  })
  .strict();

router.get(
  "/:orderId/tracking",
  authMiddleware,
  validateParams(orderIdParamSchema),
  shippingController.getFedexOrderTracking,
);

export default router;
