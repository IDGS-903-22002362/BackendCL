/**
 * Rutas para el módulo de Órdenes
 * Define los endpoints REST para gestión de órdenes de compra
 * Implementa patrón CQRS (Command Query Responsibility Segregation)
 */

import { Router } from "express";
import * as commandController from "../controllers/orders/orders.command.controller";
import * as queryController from "../controllers/orders/orders.query.controller";
import {
  validateBody,
  validateParams,
  validateQuery,
} from "../middleware/validation.middleware";
import {
  createOrdenSchema,
  updateEstadoOrdenSchema,
  listOrdenesQuerySchema,
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

/**
 * @swagger
 * /api/ordenes/{id}/cancelar:
 *   put:
 *     summary: Cancelar una orden existente
 *     description: |
 *       Cancela una orden existente y restaura el stock de productos automáticamente.
 *
 *       **REGLAS DE NEGOCIO (TASK-049):**
 *       - Solo se pueden cancelar órdenes en estado **PENDIENTE** o **CONFIRMADA**
 *       - El stock de todos los productos se restaura automáticamente (transacciones atómicas)
 *       - El estado cambia a **CANCELADA** de forma permanente (no reversible)
 *       - Se actualiza el timestamp `updatedAt` automáticamente
 *
 *       **AUTORIZACIÓN (BOLA prevention - AGENTS.MD):**
 *       - Requiere autenticación con Bearer token
 *       - **Admins/Empleados:** Pueden cancelar cualquier orden
 *       - **Clientes:** Solo pueden cancelar sus propias órdenes
 *       - Validación de ownership automática en capa de servicio
 *
 *       **SEGURIDAD:**
 *       - Transacciones Firestore para atomicidad (orden + stock)
 *       - Rollback automático si falla la operación
 *       - Logs detallados para auditoría
 *
 *       **ESTADOS QUE PERMITEN CANCELACIÓN:**
 *       - `PENDIENTE`: Orden creada, esperando confirmación de pago
 *       - `CONFIRMADA`: Pago confirmado, lista para procesar
 *
 *       **ESTADOS QUE NO PERMITEN CANCELACIÓN:**
 *       - `EN_PROCESO`: Orden ya en preparación/empaque
 *       - `ENVIADA`: Orden ya enviada al cliente
 *       - `ENTREGADA`: Orden ya entregada
 *       - `CANCELADA`: Orden ya cancelada (no se puede cancelar dos veces)
 *     tags: [Orders]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         description: ID único de la orden a cancelar
 *         schema:
 *           type: string
 *           example: "orden_abc123"
 *     responses:
 *       200:
 *         description: Orden cancelada exitosamente y stock restaurado
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
 *                   example: "Orden cancelada exitosamente"
 *                 data:
 *                   $ref: '#/components/schemas/Orden'
 *             examples:
 *               canceladaExitosamente:
 *                 summary: Orden PENDIENTE cancelada por cliente
 *                 value:
 *                   success: true
 *                   message: "Orden cancelada exitosamente"
 *                   data:
 *                     id: "orden_abc123"
 *                     usuarioId: "user_12345"
 *                     estado: "CANCELADA"
 *                     subtotal: 2999.97
 *                     impuestos: 0
 *                     total: 2999.97
 *                     items:
 *                       - productoId: "prod_jersey_001"
 *                         cantidad: 2
 *                         precioUnitario: 1299.99
 *                         subtotal: 2599.98
 *                     direccionEnvio:
 *                       nombre: "Juan Pérez"
 *                       telefono: "4774123456"
 *                       calle: "Blvd. Adolfo López Mateos"
 *                       numero: "2010"
 *                       colonia: "León Moderno"
 *                       ciudad: "León"
 *                       estado: "Guanajuato"
 *                       codigoPostal: "37480"
 *                     metodoPago: "TARJETA"
 *                     createdAt: "2024-02-05T10:00:00Z"
 *                     updatedAt: "2024-02-05T10:35:00Z"
 *               canceladaPorAdmin:
 *                 summary: Orden CONFIRMADA cancelada por admin
 *                 value:
 *                   success: true
 *                   message: "Orden cancelada exitosamente"
 *                   data:
 *                     id: "orden_xyz789"
 *                     usuarioId: "user_67890"
 *                     estado: "CANCELADA"
 *                     total: 5499.50
 *       400:
 *         description: No se puede cancelar (estado no permite cancelación)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             examples:
 *               estadoEnProceso:
 *                 summary: Orden ya EN_PROCESO (no se puede cancelar)
 *                 value:
 *                   success: false
 *                   message: "No se puede cancelar la orden en su estado actual"
 *                   error: 'No se puede cancelar una orden en estado "EN_PROCESO". Solo se pueden cancelar órdenes en estado PENDIENTE o CONFIRMADA.'
 *               yaEnviada:
 *                 summary: Orden ya ENVIADA (no se puede cancelar)
 *                 value:
 *                   success: false
 *                   message: "No se puede cancelar la orden en su estado actual"
 *                   error: 'No se puede cancelar una orden en estado "ENVIADA". Solo se pueden cancelar órdenes en estado PENDIENTE o CONFIRMADA.'
 *               yaCancelada:
 *                 summary: Orden ya CANCELADA (no se puede cancelar dos veces)
 *                 value:
 *                   success: false
 *                   message: "No se puede cancelar la orden en su estado actual"
 *                   error: 'No se puede cancelar una orden en estado "CANCELADA". Solo se pueden cancelar órdenes en estado PENDIENTE o CONFIRMADA.'
 *       401:
 *         $ref: '#/components/responses/401Unauthorized'
 *       403:
 *         description: Sin permisos para cancelar esta orden (no es propietario ni admin)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             examples:
 *               sinOwnership:
 *                 summary: Cliente intenta cancelar orden ajena
 *                 value:
 *                   success: false
 *                   message: "Sin permisos para cancelar esta orden"
 *                   error: "No tienes permisos para cancelar esta orden. Solo puedes cancelar tus propias órdenes."
 *       404:
 *         description: Orden no encontrada
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               success: false
 *               message: "Orden no encontrada"
 *               error: 'La orden con ID "orden_xyz" no existe'
 *       500:
 *         $ref: '#/components/responses/500ServerError'
 */
router.put(
  "/:id/cancelar",
  authMiddleware,
  validateParams(idParamSchema),
  commandController.cancel,
);

// ==========================================
// QUERIES (Lectura - Consulta de datos)
// ==========================================

/**
 * @swagger
 * /api/ordenes:
 *   get:
 *     summary: Listar órdenes con filtros opcionales
 *     description: |
 *       Lista las órdenes de compra con filtros opcionales. Implementa autorización por ownership (BOLA prevention):
 *
 *       **AUTORIZACIÓN:**
 *       - **Clientes:** Solo ven sus propias órdenes (filtrado automático por usuarioId)
 *       - **Admins/Empleados:** Ven todas las órdenes (pueden filtrar por usuarioId específico)
 *
 *       **FILTROS DISPONIBLES:**
 *       - `estado`: Filtrar por uno o múltiples estados (CSV). Ej: `PENDIENTE` o `PENDIENTE,CONFIRMADA`
 *       - `usuarioId`: Filtrar por usuario específico (solo admins, ignorado para clientes)
 *       - `fechaDesde`: Filtrar órdenes desde esta fecha (ISO 8601)
 *       - `fechaHasta`: Filtrar órdenes hasta esta fecha (ISO 8601)
 *
 *       **ORDENAMIENTO:**
 *       - Siempre ordenado por `createdAt` descendente (más recientes primero)
 *
 *       **SIN PAGINACIÓN:**
 *       - Retorna todas las órdenes que coincidan con los filtros
 *       - Consistente con otros endpoints del proyecto (productos, categorías)
 *
 *       **SEGURIDAD:**
 *       - Requiere autenticación (Bearer token)
 *       - Validación de ownership automática
 *     tags: [Orders]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: estado
 *         required: false
 *         description: |
 *           Estado(s) de orden separados por coma.
 *           Valores válidos: PENDIENTE, CONFIRMADA, EN_PROCESO, ENVIADA, ENTREGADA, CANCELADA
 *         schema:
 *           type: string
 *           example: "PENDIENTE,CONFIRMADA"
 *       - in: query
 *         name: usuarioId
 *         required: false
 *         description: ID del usuario (solo para admins/empleados, ignorado para clientes)
 *         schema:
 *           type: string
 *           example: "user_abc123"
 *       - in: query
 *         name: fechaDesde
 *         required: false
 *         description: Fecha desde (inclusive) en formato ISO 8601
 *         schema:
 *           type: string
 *           format: date-time
 *           example: "2024-01-01T00:00:00Z"
 *       - in: query
 *         name: fechaHasta
 *         required: false
 *         description: Fecha hasta (inclusive) en formato ISO 8601
 *         schema:
 *           type: string
 *           format: date-time
 *           example: "2024-12-31T23:59:59Z"
 *     responses:
 *       200:
 *         description: Lista de órdenes obtenida exitosamente
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
 *                   description: Número total de órdenes encontradas
 *                   example: 15
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Orden'
 *             examples:
 *               cliente:
 *                 summary: Cliente lista sus órdenes
 *                 value:
 *                   success: true
 *                   count: 3
 *                   data:
 *                     - id: "orden_001"
 *                       usuarioId: "user_123"
 *                       estado: "PENDIENTE"
 *                       total: 1299.99
 *                       createdAt: "2024-02-01T10:30:00Z"
 *                     - id: "orden_002"
 *                       usuarioId: "user_123"
 *                       estado: "ENTREGADA"
 *                       total: 899.00
 *                       createdAt: "2024-01-15T14:20:00Z"
 *               admin:
 *                 summary: Admin lista todas las órdenes
 *                 value:
 *                   success: true
 *                   count: 50
 *                   data:
 *                     - id: "orden_001"
 *                       usuarioId: "user_123"
 *                       estado: "PENDIENTE"
 *                       total: 1299.99
 *                     - id: "orden_002"
 *                       usuarioId: "user_456"
 *                       estado: "CONFIRMADA"
 *                       total: 2500.00
 *               filtrado:
 *                 summary: Órdenes filtradas por estado
 *                 value:
 *                   success: true
 *                   count: 10
 *                   data:
 *                     - id: "orden_003"
 *                       estado: "PENDIENTE"
 *                       total: 750.00
 *       401:
 *         $ref: '#/components/responses/401Unauthorized'
 *       500:
 *         $ref: '#/components/responses/500ServerError'
 */
router.get(
  "/",
  authMiddleware,
  validateQuery(listOrdenesQuerySchema),
  queryController.getAll,
);

/**
 * @swagger
 * /api/ordenes/{id}/pago:
 *   get:
 *     summary: Obtener pago asociado a una orden
 *     description: |
 *       Endpoint de compatibilidad para consultar el pago asociado a una orden.
 *       Internamente delega al módulo de pagos.
 *
 *       **Autorización:**
 *       - Solo propietario o ADMIN/EMPLEADO.
 *     tags: [Orders]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         description: ID de la orden
 *         schema:
 *           type: string
 *           example: "orden_abc123"
 *     responses:
 *       200:
 *         description: Pago obtenido exitosamente
 *       401:
 *         $ref: '#/components/responses/401Unauthorized'
 *       403:
 *         $ref: '#/components/responses/403Forbidden'
 *       404:
 *         $ref: '#/components/responses/404NotFound'
 *       500:
 *         $ref: '#/components/responses/500ServerError'
 */
router.get(
  "/:id/pago",
  authMiddleware,
  validateParams(idParamSchema),
  queryController.getPagoByOrdenIdProxy,
);

/**
 * @swagger
 * /api/ordenes/{id}:
 *   get:
 *     summary: Obtener orden específica por ID con información populada
 *     description: |
 *       Obtiene los detalles completos de una orden específica por su ID, incluyendo:
 *
 *       **INFORMACIÓN POPULADA:**
 *       - **Productos:** Clave, descripción e imágenes de cada producto en la orden
 *       - **Usuario:** Nombre, email y teléfono del usuario que realizó la orden
 *
 *       **AUTORIZACIÓN (BOLA Prevention):**
 *       - **Clientes:** Solo pueden ver sus propias órdenes
 *       - **Admins/Empleados:** Pueden ver cualquier orden
 *
 *       **SEGURIDAD:**
 *       - Requiere autenticación (Bearer token)
 *       - Validación de ownership automática
 *       - Retorna 403 si el cliente intenta ver una orden que no le pertenece
 *     tags: [Orders]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         description: ID único de la orden
 *         schema:
 *           type: string
 *           example: "orden_abc123"
 *     responses:
 *       200:
 *         description: Orden encontrada exitosamente con información populada
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
 *                   properties:
 *                     id:
 *                       type: string
 *                       example: "orden_abc123"
 *                     usuarioId:
 *                       type: string
 *                       example: "user_12345"
 *                     estado:
 *                       type: string
 *                       enum: [PENDIENTE, CONFIRMADA, EN_PROCESO, ENVIADA, ENTREGADA, CANCELADA]
 *                       example: "CONFIRMADA"
 *                     items:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           productoId:
 *                             type: string
 *                             example: "prod_001"
 *                           cantidad:
 *                             type: integer
 *                             example: 2
 *                           precioUnitario:
 *                             type: number
 *                             example: 599.99
 *                           subtotal:
 *                             type: number
 *                             example: 1199.98
 *                           tallaId:
 *                             type: string
 *                             example: "m"
 *                     itemsDetallados:
 *                       type: array
 *                       description: Items con información de productos populada
 *                       items:
 *                         type: object
 *                         properties:
 *                           productoId:
 *                             type: string
 *                             example: "prod_001"
 *                           cantidad:
 *                             type: integer
 *                             example: 2
 *                           precioUnitario:
 *                             type: number
 *                             example: 599.99
 *                           subtotal:
 *                             type: number
 *                             example: 1199.98
 *                           tallaId:
 *                             type: string
 *                             example: "m"
 *                           producto:
 *                             type: object
 *                             description: Información del producto populada
 *                             properties:
 *                               clave:
 *                                 type: string
 *                                 example: "JERSEY-002"
 *                               descripcion:
 *                                 type: string
 *                                 example: "Jersey Oficial Club León Temporada 2024"
 *                               imagenes:
 *                                 type: array
 *                                 items:
 *                                   type: string
 *                                 example: ["https://storage.googleapis.com/ejemplo/jersey1.jpg"]
 *                     usuario:
 *                       type: object
 *                       description: Información del usuario populada
 *                       properties:
 *                         nombre:
 *                           type: string
 *                           example: "Juan Pérez"
 *                         email:
 *                           type: string
 *                           example: "juan.perez@example.com"
 *                         telefono:
 *                           type: string
 *                           example: "4774123456"
 *                     subtotal:
 *                       type: number
 *                       example: 1199.98
 *                     impuestos:
 *                       type: number
 *                       example: 0
 *                     total:
 *                       type: number
 *                       example: 1199.98
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
 *                           example: "Av. Principal"
 *                         numero:
 *                           type: string
 *                           example: "123"
 *                         colonia:
 *                           type: string
 *                           example: "Centro"
 *                         ciudad:
 *                           type: string
 *                           example: "León"
 *                         estado:
 *                           type: string
 *                           example: "Guanajuato"
 *                         codigoPostal:
 *                           type: string
 *                           example: "37000"
 *                     metodoPago:
 *                       type: string
 *                       enum: [TARJETA, TRANSFERENCIA, EFECTIVO, PAYPAL, MERCADOPAGO]
 *                       example: "TARJETA"
 *                     createdAt:
 *                       type: object
 *                       description: Timestamp de Firestore
 *                     updatedAt:
 *                       type: object
 *                       description: Timestamp de Firestore
 *             example:
 *               success: true
 *               data:
 *                 id: "orden_abc123"
 *                 usuarioId: "user_12345"
 *                 estado: "CONFIRMADA"
 *                 items:
 *                   - productoId: "prod_001"
 *                     cantidad: 2
 *                     precioUnitario: 599.99
 *                     subtotal: 1199.98
 *                     tallaId: "m"
 *                 itemsDetallados:
 *                   - productoId: "prod_001"
 *                     cantidad: 2
 *                     precioUnitario: 599.99
 *                     subtotal: 1199.98
 *                     tallaId: "m"
 *                     producto:
 *                       clave: "JERSEY-002"
 *                       descripcion: "Jersey Oficial Club León Temporada 2024"
 *                       imagenes: ["https://storage.googleapis.com/ejemplo/jersey1.jpg"]
 *                 usuario:
 *                   nombre: "Juan Pérez"
 *                   email: "juan.perez@example.com"
 *                   telefono: "4774123456"
 *                 subtotal: 1199.98
 *                 impuestos: 0
 *                 total: 1199.98
 *                 direccionEnvio:
 *                   nombre: "Juan Pérez"
 *                   telefono: "4774123456"
 *                   calle: "Av. Principal"
 *                   numero: "123"
 *                   colonia: "Centro"
 *                   ciudad: "León"
 *                   estado: "Guanajuato"
 *                   codigoPostal: "37000"
 *                 metodoPago: "TARJETA"
 *                 createdAt: "2024-02-05T10:30:00Z"
 *                 updatedAt: "2024-02-05T10:30:00Z"
 *       401:
 *         $ref: '#/components/responses/401Unauthorized'
 *       403:
 *         description: Sin permisos para ver esta orden (no es el propietario)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               success: false
 *               message: "No tienes permisos para acceder a esta orden. Solo puedes ver tus propias órdenes."
 *       404:
 *         description: Orden no encontrada
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               success: false
 *               message: 'Orden con ID "orden_xyz" no encontrada'
 *       500:
 *         $ref: '#/components/responses/500ServerError'
 */
router.get(
  "/:id",
  authMiddleware,
  validateParams(idParamSchema),
  queryController.getById,
);

// ==========================================
// EXPORTS
// ==========================================
export default router;
