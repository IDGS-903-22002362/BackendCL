import { Router } from "express";
import {
  validateBody,
  validateQuery,
} from "../middleware/validation.middleware";
import {
  listInventoryMovementsQuerySchema,
  registerInventoryMovementSchema,
} from "../middleware/validators/inventory.validator";
import { authMiddleware, requireAdmin } from "../utils/middlewares";
import * as commandController from "../controllers/inventory/inventory.command.controller";
import * as queryController from "../controllers/inventory/inventory.query.controller";

const router = Router();

/**
 * @swagger
 * /api/inventario/movimientos:
 *   post:
 *     summary: Registrar movimiento de inventario
 *     description: |
 *       Registra un movimiento de inventario y actualiza stock del producto (general o por talla).
 *
 *       **Tipos soportados:** `entrada`, `salida`, `ajuste`, `venta`, `devolucion`.
 *
 *       **Reglas:**
 *       - `ajuste` requiere `cantidadNueva`
 *       - `entrada`, `salida`, `venta`, `devolucion` requieren `cantidad`
 *       - `venta` y `devolucion` requieren `ordenId`
 *       - Solo ADMIN/EMPLEADO pueden registrar manualmente
 *     tags: [Inventory]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/RegisterInventoryMovement'
 *           examples:
 *             entrada:
 *               summary: Entrada de stock
 *               value:
 *                 tipo: "entrada"
 *                 productoId: "prod_123"
 *                 tallaId: "m"
 *                 cantidad: 10
 *                 motivo: "Recepción de proveedor"
 *             ajuste:
 *               summary: Ajuste por conteo físico
 *               value:
 *                 tipo: "ajuste"
 *                 productoId: "prod_123"
 *                 cantidadNueva: 15
 *                 motivo: "Conteo físico"
 *                 referencia: "INV-2026-001"
 *     responses:
 *       201:
 *         description: Movimiento registrado exitosamente
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
 *                   example: "Movimiento de inventario registrado exitosamente"
 *                 data:
 *                   $ref: '#/components/schemas/InventoryMovement'
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
router.post(
  "/movimientos",
  authMiddleware,
  requireAdmin,
  validateBody(registerInventoryMovementSchema),
  commandController.registerMovement,
);

/**
 * @swagger
 * /api/inventario/movimientos:
 *   get:
 *     summary: Consultar historial de movimientos de inventario
 *     description: |
 *       Retorna historial de movimientos ordenado por fecha descendente con paginación cursor-based.
 *
 *       **Autorización:**
 *       - ADMIN/EMPLEADO: consulta global con filtros
 *       - CLIENTE: solo movimientos propios (`usuarioId` del token)
 *     tags: [Inventory]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: productoId
 *         schema:
 *           type: string
 *       - in: query
 *         name: tallaId
 *         schema:
 *           type: string
 *       - in: query
 *         name: tipo
 *         schema:
 *           type: string
 *           enum: [entrada, salida, ajuste, venta, devolucion]
 *       - in: query
 *         name: ordenId
 *         schema:
 *           type: string
 *       - in: query
 *         name: fechaDesde
 *         schema:
 *           type: string
 *           format: date-time
 *       - in: query
 *         name: fechaHasta
 *         schema:
 *           type: string
 *           format: date-time
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 20
 *       - in: query
 *         name: cursor
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Historial de movimientos obtenido exitosamente
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
 *                   example: 20
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/InventoryMovement'
 *                 pagination:
 *                   type: object
 *                   properties:
 *                     limit:
 *                       type: integer
 *                       example: 20
 *                     nextCursor:
 *                       type: string
 *                       nullable: true
 *                       example: "mov_abc123"
 *                     hasNextPage:
 *                       type: boolean
 *                       example: true
 *       400:
 *         $ref: '#/components/responses/400BadRequest'
 *       401:
 *         $ref: '#/components/responses/401Unauthorized'
 *       500:
 *         $ref: '#/components/responses/500ServerError'
 */
router.get(
  "/movimientos",
  authMiddleware,
  validateQuery(listInventoryMovementsQuerySchema),
  queryController.getMovements,
);

export default router;
