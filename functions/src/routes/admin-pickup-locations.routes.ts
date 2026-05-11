import { Router } from "express";
import * as controller from "../controllers/pickup-locations/pickup-locations.controller";
import {
  validateBody,
  validateParams,
} from "../middleware/validation.middleware";
import {
  createPickupLocationSchema,
  pickupLocationIdParamSchema,
  updatePickupLocationSchema,
} from "../middleware/validators/pickup-location.validator";
import { authMiddleware, requireAdmin } from "../utils/middlewares";

const router = Router();

router.use(authMiddleware, requireAdmin);

/**
 * @swagger
 * /api/admin/pickup-locations:
 *   post:
 *     summary: Crear sucursal pickup
 *     tags: [Pickup Locations]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       201:
 *         description: Sucursal creada
 */
router.post("/", validateBody(createPickupLocationSchema), controller.create);

/**
 * @swagger
 * /api/admin/pickup-locations/{id}:
 *   put:
 *     summary: Actualizar sucursal pickup
 *     tags: [Pickup Locations]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Sucursal actualizada
 */
router.put(
  "/:id",
  validateParams(pickupLocationIdParamSchema),
  validateBody(updatePickupLocationSchema),
  controller.update,
);

/**
 * @swagger
 * /api/admin/pickup-locations/{id}:
 *   delete:
 *     summary: Desactivar sucursal pickup
 *     tags: [Pickup Locations]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Sucursal desactivada
 */
router.delete(
  "/:id",
  validateParams(pickupLocationIdParamSchema),
  controller.deactivate,
);

export default router;
