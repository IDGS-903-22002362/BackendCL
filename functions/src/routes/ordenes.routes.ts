/**
 * Rutas para el módulo de Órdenes
 * Define los endpoints REST para gestión de órdenes de compra
 * Implementa patrón CQRS (Command Query Responsibility Segregation)
 */

import { Router } from "express";
import * as commandController from "../controllers/orders/orders.command.controller";
import {
  validateBody,
  validateParams,
} from "../middleware/validation.middleware";
import {
  createOrdenSchema,
  updateEstadoOrdenSchema,
} from "../middleware/validators/orden.validator";
import { idParamSchema } from "../middleware/validators/common.validator";
import { authMiddleware, requireAdmin } from "../utils/middlewares";

const router = Router();

// ==========================================
// COMMANDS (Escritura - Mutación de datos)
// ==========================================

/**
 * @swagger
 * /api/ordenes:
 *   post:
 *     summary: Crear nueva orden de compra
 *     description: |
 *       Crea una nueva orden de compra validando productos, stock y calculando totales automáticamente en el servidor.
 *
 *       **IMPORTANTE:**
 *       - El servidor recalcula todos los precios y totales (ignora valores del cliente por seguridad)
 *       - Valida existencia y stock de cada producto
 *       - IVA = 0% (temporal)
 *       - Estado inicial: PENDIENTE
 *       - NO reduce stock automáticamente (funcionalidad futura)
 *       - NO requiere autenticación por ahora (agregar en versión futura)
 *     tags: [Orders]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateOrden'
 *           example:
 *             usuarioId: "user_12345"
 *             items:
 *               - productoId: "prod_jersey_001"
 *                 cantidad: 2
 *                 precioUnitario: 1299.99
 *                 subtotal: 2599.98
 *                 tallaId: "m"
 *               - productoId: "prod_gorra_001"
 *                 cantidad: 1
 *                 precioUnitario: 399.99
 *                 subtotal: 399.99
 *             subtotal: 2999.97
 *             impuestos: 0
 *             total: 2999.97
 *             metodoPago: "TARJETA"
 *             direccionEnvio:
 *               nombre: "Juan Pérez"
 *               telefono: "4774123456"
 *               calle: "Blvd. Adolfo López Mateos"
 *               numero: "2010"
 *               numeroInterior: "A"
 *               colonia: "León Moderno"
 *               ciudad: "León"
 *               estado: "Guanajuato"
 *               codigoPostal: "37480"
 *               referencias: "Casa azul, entre 5 de Mayo y Juárez"
 *             costoEnvio: 150
 *             notas: "Entregar en horario de oficina"
 *     responses:
 *       201:
 *         description: Orden creada exitosamente
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
 *                   example: "Orden creada exitosamente"
 *                 data:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: string
 *                       example: "orden_abc123"
 *                       description: "ID único de la orden generado por Firestore"
 *                     usuarioId:
 *                       type: string
 *                       example: "user_12345"
 *                     items:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           productoId:
 *                             type: string
 *                             example: "prod_jersey_001"
 *                           cantidad:
 *                             type: integer
 *                             example: 2
 *                           precioUnitario:
 *                             type: number
 *                             example: 1299.99
 *                             description: "Precio recalculado por el servidor"
 *                           subtotal:
 *                             type: number
 *                             example: 2599.98
 *                             description: "Subtotal recalculado por el servidor"
 *                           tallaId:
 *                             type: string
 *                             example: "m"
 *                     subtotal:
 *                       type: number
 *                       example: 2999.97
 *                       description: "Subtotal total recalculado por el servidor"
 *                     impuestos:
 *                       type: number
 *                       example: 0
 *                       description: "IVA calculado por el servidor (0% temporal)"
 *                     total:
 *                       type: number
 *                       example: 2999.97
 *                       description: "Total calculado por el servidor"
 *                     estado:
 *                       type: string
 *                       example: "PENDIENTE"
 *                       enum: [PENDIENTE, CONFIRMADA, EN_PROCESO, ENVIADA, ENTREGADA, CANCELADA]
 *                     metodoPago:
 *                       type: string
 *                       example: "TARJETA"
 *                       enum: [TARJETA, TRANSFERENCIA, EFECTIVO, PAYPAL, MERCADOPAGO]
 *                     direccionEnvio:
 *                       type: object
 *                       properties:
 *                         nombre:
 *                           type: string
 *                           example: "Juan Pérez"
 *                         telefono:
 *                           type: string
 *                           example: "4774123456"
 *                         calle:
 *                           type: string
 *                           example: "Blvd. Adolfo López Mateos"
 *                         numero:
 *                           type: string
 *                           example: "2010"
 *                         numeroInterior:
 *                           type: string
 *                           example: "A"
 *                         colonia:
 *                           type: string
 *                           example: "León Moderno"
 *                         ciudad:
 *                           type: string
 *                           example: "León"
 *                         estado:
 *                           type: string
 *                           example: "Guanajuato"
 *                         codigoPostal:
 *                           type: string
 *                           example: "37480"
 *                         referencias:
 *                           type: string
 *                           example: "Casa azul, entre 5 de Mayo y Juárez"
 *                     costoEnvio:
 *                       type: number
 *                       example: 150
 *                     notas:
 *                       type: string
 *                       example: "Entregar en horario de oficina"
 *                     createdAt:
 *                       type: object
 *                       description: "Timestamp de Firestore"
 *                     updatedAt:
 *                       type: object
 *                       description: "Timestamp de Firestore"
 *       400:
 *         description: Error de validación (producto no existe, sin stock, datos inválidos)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 message:
 *                   type: string
 *                   example: "Error al procesar la orden"
 *                 error:
 *                   type: string
 *                   example: "Stock insuficiente para \"Jersey Oficial Local 2024\". Disponible: 5, Solicitado: 10"
 *             examples:
 *               productoNoExiste:
 *                 summary: Producto no existe
 *                 value:
 *                   success: false
 *                   message: "Error al procesar la orden"
 *                   error: "El producto con ID \"prod_xyz\" no existe en el catálogo"
 *               sinStock:
 *                 summary: Stock insuficiente
 *                 value:
 *                   success: false
 *                   message: "Error al procesar la orden"
 *                   error: "Stock insuficiente para \"Jersey Oficial\". Disponible: 3, Solicitado: 5"
 *               productoInactivo:
 *                 summary: Producto no disponible
 *                 value:
 *                   success: false
 *                   message: "Error al procesar la orden"
 *                   error: "El producto \"Jersey Edición Especial\" no está disponible"
 *               validacionZod:
 *                 summary: Error de validación de campos
 *                 value:
 *                   success: false
 *                   message: "Validación fallida"
 *                   errors:
 *                     - campo: "direccionEnvio.telefono"
 *                       mensaje: "El teléfono debe tener exactamente 10 dígitos"
 *                       codigo: "invalid_string"
 *       500:
 *         $ref: '#/components/responses/500ServerError'
 */
router.post("/", validateBody(createOrdenSchema), commandController.create);

/**
 * @swagger
 * /api/ordenes/{id}/estado:
 *   put:
 *     summary: Actualizar estado de una orden
 *     description: |
 *       Actualiza el estado de una orden existente. Solo administradores y empleados pueden realizar esta operación.
 *
 *       **IMPORTANTE:**
 *       - Requiere autenticación con Bearer token
 *       - Solo usuarios con rol ADMIN o EMPLEADO pueden cambiar estados
 *       - Valida ownership: los usuarios solo pueden actualizar sus propias órdenes (admins pueden actualizar cualquiera)
 *       - Todas las transiciones de estado son permitidas (flexibilidad operativa)
 *       - Actualiza timestamp updatedAt automáticamente
 *       - Estados disponibles: PENDIENTE, CONFIRMADA, EN_PROCESO, ENVIADA, ENTREGADA, CANCELADA
 *     tags: [Orders]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         description: ID único de la orden a actualizar
 *         schema:
 *           type: string
 *           example: "orden_abc123"
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UpdateEstadoOrden'
 *           example:
 *             estado: "CONFIRMADA"
 *     responses:
 *       200:
 *         description: Estado actualizado exitosamente
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
 *                   example: "Estado de la orden actualizado a CONFIRMADA"
 *                 data:
 *                   type: object
 *                   description: Orden actualizada con nuevo estado
 *                   properties:
 *                     id:
 *                       type: string
 *                       example: "orden_abc123"
 *                     estado:
 *                       type: string
 *                       example: "CONFIRMADA"
 *                       enum: [PENDIENTE, CONFIRMADA, EN_PROCESO, ENVIADA, ENTREGADA, CANCELADA]
 *                     updatedAt:
 *                       type: object
 *                       description: Timestamp de Firestore actualizado
 *       400:
 *         description: Error de validación (estado inválido)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 message:
 *                   type: string
 *                   example: "Validación fallida"
 *                 errors:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       campo:
 *                         type: string
 *                         example: "estado"
 *                       mensaje:
 *                         type: string
 *                         example: "El estado debe ser uno de: PENDIENTE, CONFIRMADA, EN_PROCESO, ENVIADA, ENTREGADA, CANCELADA"
 *       401:
 *         $ref: '#/components/responses/401Unauthorized'
 *       403:
 *         description: Sin permisos (no es admin/empleado o no es propietario de la orden)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 message:
 *                   type: string
 *                   example: "No tienes permisos para actualizar esta orden"
 *       404:
 *         description: Orden no encontrada
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 message:
 *                   type: string
 *                   example: "Orden no encontrada"
 *       500:
 *         $ref: '#/components/responses/500ServerError'
 */
router.put(
  "/:id/estado",
  authMiddleware,
  requireAdmin,
  validateParams(idParamSchema),
  validateBody(updateEstadoOrdenSchema),
  commandController.updateEstado,
);

// ==========================================
// QUERIES (Lectura - Consulta de datos)
// ==========================================
// TODO: Implementar en TASK-046, TASK-047, TASK-050
// router.get("/", queryController.getAll);
// router.get("/:id", validateParams(idParamSchema), queryController.getById);

// ==========================================
// EXPORTS
// ==========================================
export default router;
