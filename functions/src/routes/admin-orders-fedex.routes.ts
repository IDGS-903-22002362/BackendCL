import { Router } from "express";
import { z } from "zod";
import { validateBody, validateParams } from "../middleware/validation.middleware";
import {
  fedexCancelShipmentSchema,
  fedexShipCreateSchema,
} from "../modules/shipping/fedex/fedex-ship.types";
import * as shippingController from "../modules/shipping/shipping.controller";
import * as manualShippingController from "../controllers/orders/orders.manual-shipping.controller";
import { authMiddleware, requireAdmin } from "../utils/middlewares";

const router = Router();

const orderIdParamSchema = z
  .object({
    orderId: z.string().trim().min(1).max(120),
  })
  .strict();

const manualNoteSchema = z
  .object({
    note: z.string().trim().max(500).optional(),
  })
  .strict();

const manualTrackingSchema = z
  .object({
    trackingNumber: z.string().trim().min(1).max(80),
    serviceName: z.string().trim().min(1).max(160).optional(),
    realShippingCost: z.number().nonnegative().optional(),
    receiptUrl: z.string().trim().url().optional(),
    guidePdfUrl: z.string().trim().url().optional(),
    notes: z.string().trim().max(1000).optional(),
  })
  .strict();

const manualStatusSchema = z
  .object({
    status: z.enum([
      "IN_TRANSIT",
      "DELIVERED",
      "INCIDENT",
      "EXCEPTION",
      "RETURNED",
    ]),
    note: z.string().trim().max(500).optional(),
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

router.post(
  "/:orderId/manual-shipping/preparing",
  validateParams(orderIdParamSchema),
  validateBody(manualNoteSchema),
  manualShippingController.markPreparing,
);

router.post(
  "/:orderId/manual-shipping/ready-to-ship",
  validateParams(orderIdParamSchema),
  validateBody(manualNoteSchema),
  manualShippingController.markReadyToShip,
);

router.post(
  "/:orderId/manual-shipping/tracking",
  validateParams(orderIdParamSchema),
  validateBody(manualTrackingSchema),
  manualShippingController.captureTracking,
);

router.post(
  "/:orderId/manual-shipping/status",
  validateParams(orderIdParamSchema),
  validateBody(manualStatusSchema),
  manualShippingController.updateStatus,
);

export default router;
