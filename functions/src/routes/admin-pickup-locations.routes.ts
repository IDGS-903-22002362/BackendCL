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
 *     description: Crea una nueva sucursal disponible para operación pickup.
 *     tags: [Pickup Locations]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreatePickupLocation'
 *           example:
 *             name: "Tienda Estadio León"
 *             address: "Blvd. Adolfo López Mateos 1810"
 *             city: "León"
 *             state: "Guanajuato"
 *             postalCode: "37500"
 *             country: "MX"
 *             phone: "4771234567"
 *             active: true
 *             pickupEnabled: true
 *             pickupInstructions: "Presenta tu código en mostrador."
 *             businessHours:
 *               monday:
 *                 open: "10:00"
 *                 close: "18:00"
 *             preparationCutoffTime: "16:00"
 *             estimatedPreparationMinutes: 120
 *     responses:
 *       201:
 *         description: Sucursal creada exitosamente
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "Sucursal pickup creada exitosamente"
 *                 data:
 *                   $ref: '#/components/schemas/PickupLocation'
 *       400:
 *         $ref: '#/components/responses/400BadRequest'
 *       401:
 *         $ref: '#/components/responses/401Unauthorized'
 *       403:
 *         $ref: '#/components/responses/403Forbidden'
 *       500:
 *         $ref: '#/components/responses/500ServerError'
 */
router.post("/", validateBody(createPickupLocationSchema), controller.create);

/**
 * @swagger
 * /api/admin/pickup-locations/{id}:
 *   put:
 *     summary: Actualizar sucursal pickup
 *     description: Actualiza parcialmente la configuración de una sucursal pickup.
 *     tags: [Pickup Locations]
 *     security:
 *       - BearerAuth: []
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
 *             $ref: '#/components/schemas/UpdatePickupLocation'
 *           example:
 *             pickupEnabled: true
 *             pickupInstructions: "Recoge tu pedido en el mostrador principal."
 *             estimatedPreparationMinutes: 90
 *     responses:
 *       200:
 *         description: Sucursal actualizada exitosamente
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "Sucursal pickup actualizada exitosamente"
 *                 data:
 *                   $ref: '#/components/schemas/PickupLocation'
 *       400:
 *         $ref: '#/components/responses/400BadRequest'
 *       401:
 *         $ref: '#/components/responses/401Unauthorized'
 *       403:
 *         $ref: '#/components/responses/403Forbidden'
 *       404:
 *         $ref: '#/components/responses/404NotFound'
 *       500:
 *         $ref: '#/components/responses/500ServerError'
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
 *     description: Marca una sucursal como inactiva para que deje de aparecer como opción pickup.
 *     tags: [Pickup Locations]
 *     security:
 *       - BearerAuth: []
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
 *         description: Sucursal desactivada exitosamente
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "Sucursal pickup desactivada exitosamente"
 *                 data:
 *                   $ref: '#/components/schemas/PickupLocation'
 *       401:
 *         $ref: '#/components/responses/401Unauthorized'
 *       403:
 *         $ref: '#/components/responses/403Forbidden'
 *       404:
 *         $ref: '#/components/responses/404NotFound'
 *       500:
 *         $ref: '#/components/responses/500ServerError'
 */
router.delete(
  "/:id",
  validateParams(pickupLocationIdParamSchema),
  controller.deactivate,
);

export default router;
