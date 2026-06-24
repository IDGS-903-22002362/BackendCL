import { Router } from "express";

import { codigosPromocionCommandController } from "../controllers/codigos-promocion/codigos-promocion.command.controller";
import { codigosPromocionQueryController } from "../controllers/codigos-promocion/codigos-promocion.query.controller";
import {
  codigoPromocionParamsSchema,
  createCodigoPromocionSchema,
  disponibilidadCodigosPromocionCarritoSchema,
  listCodigosPromocionQuerySchema,
  updateCodigoPromocionSchema,
  validarCodigoPromocionSchema,
} from "../middleware/validators/codigos-promocion.validator";
import {
  validateBody,
  validateParams,
  validateQuery,
} from "../middleware/validation.middleware";
import { createSimpleRateLimiter } from "../middleware/rate-limit.middleware";
import { authMiddleware, requireAdmin } from "../utils/middlewares";

const router = Router();

const couponRateLimit = createSimpleRateLimiter({
  keyPrefix: "coupons",
  windowMs: 60_000,
  maxRequests: 30,
});

/**
 * @swagger
 * /api/codigos-promocion:
 *   get:
 *     summary: Listar códigos promocionales
 *     description: Lista códigos promocionales con filtros opcionales.
 *     tags:
 *       - Codigos Promocionales
 *     parameters:
 *       - in: query
 *         name: estado
 *         schema:
 *           type: boolean
 *         description: Filtra códigos habilitados o deshabilitados.
 *       - in: query
 *         name: q
 *         schema:
 *           type: string
 *         description: Búsqueda por código o descripción.
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *         description: Límite de resultados.
 *     responses:
 *       200:
 *         description: Lista de códigos promocionales obtenida correctamente.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/CodigoPromocion'
 *       400:
 *         description: Parámetros de consulta inválidos.
 */
router.get(
  "/",
  authMiddleware,
  requireAdmin,
  validateQuery(listCodigosPromocionQuerySchema),
  codigosPromocionQueryController.listar,
);

/**
 * @swagger
 * /api/codigos-promocion/validar:
 *   post:
 *     summary: Validar código promocional
 *     description: Valida un código promocional contra los productos del carrito.
 *     tags:
 *       - Codigos Promocionales
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ValidarCodigoPromocion'
 *     responses:
 *       200:
 *         description: Validación completada correctamente.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *       400:
 *         description: Datos inválidos o código no válido.
 */
router.post(
  "/validar",
  couponRateLimit,
  validateBody(validarCodigoPromocionSchema),
  codigosPromocionQueryController.validar,
);

router.post(
  "/disponibilidad-carrito",
  couponRateLimit,
  validateBody(disponibilidadCodigosPromocionCarritoSchema),
  codigosPromocionQueryController.consultarDisponibilidadCarrito,
);

/**
 * @swagger
 * /api/codigos-promocion/{id}:
 *   get:
 *     summary: Obtener código promocional por ID
 *     description: Obtiene el detalle de un código promocional específico.
 *     tags:
 *       - Codigos Promocionales
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: ID del código promocional.
 *     responses:
 *       200:
 *         description: Código promocional obtenido correctamente.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/CodigoPromocion'
 *       400:
 *         description: Parámetros inválidos.
 *       404:
 *         description: Código promocional no encontrado.
 */
router.get(
  "/:id",
  validateParams(codigoPromocionParamsSchema),
  codigosPromocionQueryController.obtenerPorId,
);

/**
 * @swagger
 * /api/codigos-promocion:
 *   post:
 *     summary: Crear código promocional
 *     description: Crea un nuevo código promocional.
 *     tags:
 *       - Codigos Promocionales
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateCodigoPromocion'
 *     responses:
 *       201:
 *         description: Código promocional creado correctamente.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/CodigoPromocion'
 *       400:
 *         description: Datos inválidos.
 */
router.post(
  "/",
  authMiddleware,
  requireAdmin,
  validateBody(createCodigoPromocionSchema),
  codigosPromocionCommandController.crear,
);

/**
 * @swagger
 * /api/codigos-promocion/{id}:
 *   put:
 *     summary: Actualizar código promocional
 *     description: Actualiza un código promocional existente.
 *     tags:
 *       - Codigos Promocionales
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: ID del código promocional.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UpdateCodigoPromocion'
 *     responses:
 *       200:
 *         description: Código promocional actualizado correctamente.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/CodigoPromocion'
 *       400:
 *         description: Datos inválidos.
 *       404:
 *         description: Código promocional no encontrado.
 */
router.put(
  "/:id",
  authMiddleware,
  requireAdmin,
  validateParams(codigoPromocionParamsSchema),
  validateBody(updateCodigoPromocionSchema),
  codigosPromocionCommandController.actualizar,
);

/**
 * @swagger
 * /api/codigos-promocion/{id}:
 *   delete:
 *     summary: Eliminar código promocional
 *     description: Elimina/desactiva un código promocional existente.
 *     tags:
 *       - Codigos Promocionales
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: ID del código promocional.
 *     responses:
 *       200:
 *         description: Código promocional eliminado correctamente.
 *       400:
 *         description: Parámetros inválidos.
 *       404:
 *         description: Código promocional no encontrado.
 */
router.delete(
  "/:id",
  authMiddleware,
  requireAdmin,
  validateParams(codigoPromocionParamsSchema),
  codigosPromocionCommandController.eliminar,
);

export const codigosPromocionRoutes = router;
export default router;