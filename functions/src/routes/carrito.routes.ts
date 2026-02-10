/**
 * Rutas para el módulo de Carrito de Compras
 * Define los endpoints REST para gestión del carrito
 * Implementa patrón CQRS (Command Query Responsibility Segregation)
 *
 * AUTENTICACIÓN:
 * - optionalAuthMiddleware: permite acceso autenticado y anónimo (x-session-id)
 * - authMiddleware: requiere autenticación (solo para merge)
 */

import { Router } from "express";
import * as commandController from "../controllers/carrito/carrito.command.controller";
import * as queryController from "../controllers/carrito/carrito.query.controller";
import {
  validateBody,
  validateParams,
} from "../middleware/validation.middleware";
import {
  addItemCarritoSchema,
  updateItemCarritoSchema,
  productoIdParamSchema,
  mergeCarritoSchema,
} from "../middleware/validators/carrito.validator";
import { authMiddleware, optionalAuthMiddleware } from "../utils/middlewares";

const router = Router();

// ==========================================
// QUERIES (Lectura)
// ==========================================

/**
 * @swagger
 * /api/carrito:
 *   get:
 *     summary: Obtener carrito actual
 *     description: |
 *       Obtiene el carrito del usuario autenticado o de la sesión anónima.
 *       Si no existe un carrito, se crea uno vacío automáticamente.
 *       Los items incluyen información populada de los productos (clave, descripción, imágenes, stock, precio actual).
 *
 *       **Identificación del carrito:**
 *       - Usuario autenticado: se usa el UID del token Bearer
 *       - Usuario anónimo: se usa el header `x-session-id` (UUID generado por el cliente)
 *     tags: [Cart]
 *     parameters:
 *       - in: header
 *         name: x-session-id
 *         schema:
 *           type: string
 *           format: uuid
 *           example: "550e8400-e29b-41d4-a716-446655440000"
 *         description: UUID de sesión para usuarios no autenticados. Requerido si no se envía Bearer token.
 *     security:
 *       - BearerAuth: []
 *       - {}
 *     responses:
 *       200:
 *         description: Carrito obtenido exitosamente
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/Carrito'
 *             example:
 *               success: true
 *               data:
 *                 id: "cart_abc123"
 *                 sessionId: "550e8400-e29b-41d4-a716-446655440000"
 *                 items:
 *                   - productoId: "prod_001"
 *                     cantidad: 2
 *                     precioUnitario: 1299.99
 *                 subtotal: 2599.98
 *                 total: 2599.98
 *                 itemsDetallados:
 *                   - productoId: "prod_001"
 *                     cantidad: 2
 *                     precioUnitario: 1299.99
 *                     producto:
 *                       clave: "JER-001"
 *                       descripcion: "Jersey Oficial Local 2024"
 *                       imagenes: ["https://storage.googleapis.com/.../jersey.jpg"]
 *                       existencias: 50
 *                       precioPublico: 1299.99
 *                       activo: true
 *       400:
 *         description: No se proporcionó identificación (ni auth ni x-session-id)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       500:
 *         $ref: '#/components/responses/500ServerError'
 */
router.get("/", optionalAuthMiddleware, queryController.getCart);

// ==========================================
// COMMANDS (Escritura - Mutación de datos)
// ==========================================

/**
 * @swagger
 * /api/carrito/items:
 *   post:
 *     summary: Agregar producto al carrito
 *     description: |
 *       Agrega un producto al carrito. Si el producto ya existe, incrementa la cantidad.
 *
 *       **Seguridad:**
 *       - El precio unitario se obtiene del servidor (precioPublico del producto), nunca del cliente
 *       - Se valida existencia, disponibilidad y stock del producto
 *       - Cantidad máxima por producto: 10 unidades
 *
 *       **Identificación:**
 *       - Autenticado: Bearer token
 *       - Anónimo: header x-session-id
 *     tags: [Cart]
 *     parameters:
 *       - in: header
 *         name: x-session-id
 *         schema:
 *           type: string
 *           format: uuid
 *         description: UUID de sesión para usuarios no autenticados
 *     security:
 *       - BearerAuth: []
 *       - {}
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/AddItemCarrito'
 *           example:
 *             productoId: "prod_jersey_001"
 *             cantidad: 2
 *             tallaId: "m"
 *     responses:
 *       200:
 *         description: Producto agregado al carrito
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
 *                   example: "Producto agregado al carrito"
 *                 data:
 *                   $ref: '#/components/schemas/Carrito'
 *       400:
 *         description: Error de validación (producto no existe, sin stock, cantidad máxima excedida)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             examples:
 *               productoNoExiste:
 *                 summary: Producto no existe
 *                 value:
 *                   success: false
 *                   message: 'Producto con ID "xyz" no existe'
 *               stockInsuficiente:
 *                 summary: Stock insuficiente
 *                 value:
 *                   success: false
 *                   message: 'Stock insuficiente para "Jersey Oficial". Disponible: 5, solicitado: 10'
 *       500:
 *         $ref: '#/components/responses/500ServerError'
 */
router.post(
  "/items",
  optionalAuthMiddleware,
  validateBody(addItemCarritoSchema),
  commandController.addItem,
);

/**
 * @swagger
 * /api/carrito/items/{productoId}:
 *   put:
 *     summary: Actualizar cantidad de item en carrito
 *     description: |
 *       Actualiza la cantidad de un producto en el carrito.
 *       Si la cantidad es 0, el item se elimina del carrito.
 *
 *       **Validaciones:**
 *       - Verifica que el producto exista en el carrito
 *       - Valida stock disponible
 *       - Cantidad máxima: 10 unidades por producto
 *     tags: [Cart]
 *     parameters:
 *       - in: path
 *         name: productoId
 *         required: true
 *         description: ID del producto en el carrito
 *         schema:
 *           type: string
 *           example: "prod_jersey_001"
 *       - in: header
 *         name: x-session-id
 *         schema:
 *           type: string
 *           format: uuid
 *         description: UUID de sesión para usuarios no autenticados
 *     security:
 *       - BearerAuth: []
 *       - {}
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UpdateItemCarrito'
 *           example:
 *             cantidad: 3
 *     responses:
 *       200:
 *         description: Cantidad actualizada exitosamente
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
 *                   example: "Cantidad actualizada"
 *                 data:
 *                   $ref: '#/components/schemas/Carrito'
 *       400:
 *         description: Stock insuficiente
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: Producto no encontrado en el carrito
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       500:
 *         $ref: '#/components/responses/500ServerError'
 */
router.put(
  "/items/:productoId",
  optionalAuthMiddleware,
  validateParams(productoIdParamSchema),
  validateBody(updateItemCarritoSchema),
  commandController.updateItem,
);

/**
 * @swagger
 * /api/carrito/items/{productoId}:
 *   delete:
 *     summary: Eliminar item del carrito
 *     description: |
 *       Elimina un producto del carrito completamente.
 *       Recalcula los totales automáticamente.
 *     tags: [Cart]
 *     parameters:
 *       - in: path
 *         name: productoId
 *         required: true
 *         description: ID del producto a eliminar del carrito
 *         schema:
 *           type: string
 *           example: "prod_jersey_001"
 *       - in: header
 *         name: x-session-id
 *         schema:
 *           type: string
 *           format: uuid
 *         description: UUID de sesión para usuarios no autenticados
 *     security:
 *       - BearerAuth: []
 *       - {}
 *     responses:
 *       200:
 *         description: Producto eliminado del carrito
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
 *                   example: "Producto eliminado del carrito"
 *                 data:
 *                   $ref: '#/components/schemas/Carrito'
 *       404:
 *         description: Producto no encontrado en el carrito
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               success: false
 *               message: 'Producto "prod_xyz" no encontrado en el carrito'
 *       500:
 *         $ref: '#/components/responses/500ServerError'
 */
router.delete(
  "/items/:productoId",
  optionalAuthMiddleware,
  validateParams(productoIdParamSchema),
  commandController.removeItem,
);

/**
 * @swagger
 * /api/carrito:
 *   delete:
 *     summary: Vaciar carrito completamente
 *     description: |
 *       Elimina todos los items del carrito, dejándolo vacío.
 *       El carrito sigue existiendo pero con items = [], subtotal = 0, total = 0.
 *     tags: [Cart]
 *     parameters:
 *       - in: header
 *         name: x-session-id
 *         schema:
 *           type: string
 *           format: uuid
 *         description: UUID de sesión para usuarios no autenticados
 *     security:
 *       - BearerAuth: []
 *       - {}
 *     responses:
 *       200:
 *         description: Carrito vaciado exitosamente
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
 *                   example: "Carrito vaciado exitosamente"
 *                 data:
 *                   $ref: '#/components/schemas/Carrito'
 *       400:
 *         description: Sin identificación del carrito
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       500:
 *         $ref: '#/components/responses/500ServerError'
 */
router.delete("/", optionalAuthMiddleware, commandController.clearCart);

/**
 * @swagger
 * /api/carrito/merge:
 *   post:
 *     summary: Fusionar carrito de sesión con carrito de usuario
 *     description: |
 *       Fusiona el carrito de una sesión anónima con el carrito del usuario autenticado.
 *       Llamar este endpoint cuando un usuario anónimo inicia sesión para conservar sus items.
 *
 *       **Reglas de merge:**
 *       - Items del carrito de sesión se agregan al carrito del usuario
 *       - Si un producto ya existe en ambos, las cantidades se suman
 *       - Se respeta el máximo de 10 unidades por producto
 *       - Se respeta el stock disponible
 *       - Productos inactivos o eliminados se omiten
 *       - El carrito de sesión se elimina después del merge
 *
 *       **Requiere autenticación** (Bearer token obligatorio)
 *     tags: [Cart]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/MergeCarrito'
 *           example:
 *             sessionId: "550e8400-e29b-41d4-a716-446655440000"
 *     responses:
 *       200:
 *         description: Carritos fusionados exitosamente
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
 *                   example: "Carritos fusionados exitosamente"
 *                 data:
 *                   $ref: '#/components/schemas/Carrito'
 *       401:
 *         $ref: '#/components/responses/401Unauthorized'
 *       500:
 *         $ref: '#/components/responses/500ServerError'
 */
router.post(
  "/merge",
  authMiddleware,
  validateBody(mergeCarritoSchema),
  commandController.mergeCarts,
);

export default router;
