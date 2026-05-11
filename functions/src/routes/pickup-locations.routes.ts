import { Router } from "express";
import * as controller from "../controllers/pickup-locations/pickup-locations.controller";
import {
  validateBody,
  validateParams,
} from "../middleware/validation.middleware";
import {
  pickupAvailabilitySchema,
  pickupLocationIdParamSchema,
} from "../middleware/validators/pickup-location.validator";

const router = Router();

/**
 * @swagger
 * /api/pickup-locations:
 *   get:
 *     summary: Listar sucursales activas con pickup
 *     tags: [Pickup Locations]
 *     responses:
 *       200:
 *         description: Sucursales disponibles
 */
router.get("/", controller.listPublic);

/**
 * @swagger
 * /api/pickup-locations/{id}:
 *   get:
 *     summary: Obtener sucursal pickup pública
 *     tags: [Pickup Locations]
 *     responses:
 *       200:
 *         description: Sucursal disponible
 *       404:
 *         $ref: '#/components/responses/404NotFound'
 */
router.get(
  "/:id",
  validateParams(pickupLocationIdParamSchema),
  controller.getPublicById,
);

/**
 * @swagger
 * /api/pickup-locations/{id}/availability:
 *   post:
 *     summary: Validar disponibilidad de carrito para pickup
 *     tags: [Pickup Locations]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/PickupAvailabilityRequest'
 *     responses:
 *       200:
 *         description: Resultado de disponibilidad
 */
router.post(
  "/:id/availability",
  validateParams(pickupLocationIdParamSchema),
  validateBody(pickupAvailabilitySchema),
  controller.validateAvailability,
);

export default router;
