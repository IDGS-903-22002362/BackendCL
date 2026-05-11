import { Router } from "express";
import * as controller from "../controllers/pickup-orders/pickup-orders.controller";
import {
  validateBody,
  validateParams,
  validateQuery,
} from "../middleware/validation.middleware";
import { idParamSchema } from "../middleware/validators/common.validator";
import {
  completePickupSchema,
  pickupOrdersQuerySchema,
  verifyPickupCodeSchema,
} from "../middleware/validators/pickup-location.validator";
import { authMiddleware, requireAdmin } from "../utils/middlewares";

const router = Router();

router.use(authMiddleware, requireAdmin);

/**
 * @swagger
 * /api/admin/pickup-orders:
 *   get:
 *     summary: Listar pedidos pickup
 *     tags: [Pickup Orders]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Pedidos pickup
 */
router.get("/", validateQuery(pickupOrdersQuerySchema), controller.list);

/**
 * @swagger
 * /api/admin/pickup-orders/{id}:
 *   get:
 *     summary: Ver detalle de pedido pickup
 *     tags: [Pickup Orders]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Pedido pickup
 */
router.get("/:id", validateParams(idParamSchema), controller.getById);

router.post("/:id/prepare", validateParams(idParamSchema), controller.prepare);
router.post("/:id/ready", validateParams(idParamSchema), controller.ready);
router.post(
  "/:id/verify-code",
  validateParams(idParamSchema),
  validateBody(verifyPickupCodeSchema),
  controller.verifyCode,
);
router.post(
  "/:id/complete",
  validateParams(idParamSchema),
  validateBody(completePickupSchema),
  controller.complete,
);
router.post("/:id/expire", validateParams(idParamSchema), controller.expire);

export default router;
