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
 *     description: Retorna solo sucursales activas que tienen pickup habilitado.
 *     tags: [Pickup Locations]
 *     responses:
 *       200:
 *         description: Sucursales disponibles
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 count:
 *                   type: integer
 *                   example: 2
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/PickupLocation'
 *       500:
 *         $ref: '#/components/responses/500ServerError'
 */
router.get("/", controller.listPublic);

/**
 * @swagger
 * /api/pickup-locations/{id}:
 *   get:
 *     summary: Obtener sucursal pickup pública
 *     description: Retorna una sucursal activa con pickup habilitado por ID.
 *     tags: [Pickup Locations]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         description: ID de la sucursal pickup
 *         schema:
 *           type: string
 *           example: "loc_123"
 *     responses:
 *       200:
 *         description: Sucursal disponible
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/PickupLocation'
 *       400:
 *         $ref: '#/components/responses/400BadRequest'
 *       404:
 *         $ref: '#/components/responses/404NotFound'
 *       500:
 *         $ref: '#/components/responses/500ServerError'
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
 *     description: Valida si los productos del carrito pueden recogerse en la sucursal indicada.
 *     tags: [Pickup Locations]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         description: ID de la sucursal pickup
 *         schema:
 *           type: string
 *           example: "loc_123"
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/PickupAvailabilityRequest'
 *           example:
 *             cartId: "cart_123"
 *     responses:
 *       200:
 *         description: Resultado de disponibilidad
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/PickupAvailabilityResponse'
 *       400:
 *         $ref: '#/components/responses/400BadRequest'
 *       404:
 *         $ref: '#/components/responses/404NotFound'
 *       500:
 *         $ref: '#/components/responses/500ServerError'
 */
router.post(
  "/:id/availability",
  validateParams(pickupLocationIdParamSchema),
  validateBody(pickupAvailabilitySchema),
  controller.validateAvailability,
);

export default router;
