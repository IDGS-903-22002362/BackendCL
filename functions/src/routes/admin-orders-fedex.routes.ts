import { Router } from "express";
import { z } from "zod";
import { validateBody, validateParams } from "../middleware/validation.middleware";
import {
  fedexCancelShipmentSchema,
  fedexShipCreateSchema,
} from "../modules/shipping/fedex/fedex-ship.types";
import * as shippingController from "../modules/shipping/shipping.controller";
import { authMiddleware, requireAdmin } from "../utils/middlewares";

const router = Router();

const orderIdParamSchema = z
  .object({
    orderId: z.string().trim().min(1).max(120),
  })
  .strict();

router.use(authMiddleware, requireAdmin);

router.post(
  "/:orderId/fedex/ship",
  validateParams(orderIdParamSchema),
  validateBody(fedexShipCreateSchema),
  shippingController.createFedexShipmentForOrder,
);

router.post(
  "/:orderId/fedex/cancel-shipment",
  validateParams(orderIdParamSchema),
  validateBody(fedexCancelShipmentSchema),
  shippingController.cancelFedexShipmentForOrder,
);

router.get(
  "/:orderId/fedex/tracking",
  validateParams(orderIdParamSchema),
  shippingController.getAdminFedexOrderTracking,
);

export default router;
