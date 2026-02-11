/**
 * Rutas para el módulo de Usuarios
 * Define los endpoints REST para gestión de usuarios
 * Implementa patrón CQRS (Command Query Responsibility Segregation)
 */

import { Router } from "express";
import * as queryController from "../controllers/users/users.query.controller";
import * as commandController from "../controllers/users/users.command.controller";
import * as debugController from "../controllers/users/users.debug.controller";
import { authMiddleware } from "../utils/middlewares";
import {
  validateParams,
  validateQuery,
} from "../middleware/validation.middleware";
import { idParamSchema } from "../middleware/validators/common.validator";
import { historialOrdenesQuerySchema } from "../middleware/validators/orden.validator";

const router = Router();

// ==========================================
// DEBUG (Solo para desarrollo)
// ==========================================

/**
 * @swagger
 * /api/usuarios/debug:
 *   get:
 *     summary: Diagnóstico de Firestore para usuarios
 *     description: Endpoint de diagnóstico protegido para verificar conexión a Firestore
 *     tags: [Debug]
 *     deprecated: true
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Diagnóstico completado
 *       401:
 *         $ref: '#/components/responses/401Unauthorized'
 *       500:
 *         $ref: '#/components/responses/500ServerError'
 */
router.get("/debug", authMiddleware, debugController.debugFirestore);

// ==========================================
// QUERIES (Lectura - Safe & Cacheable)
// ==========================================

/**
 * @swagger
 * /api/usuarios:
 *   get:
 *     summary: Listar todos los usuarios activos
 *     description: Obtiene la lista de usuarios activos. Requiere autenticación.
 *     tags: [Users]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Lista de usuarios obtenida exitosamente
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 count:
 *                   type: integer
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/User'
 *       401:
 *         $ref: '#/components/responses/401Unauthorized'
 *       500:
 *         $ref: '#/components/responses/500ServerError'
 */
router.get("/", queryController.getAll);

/**
 * @swagger
 * /api/usuarios/{id}/ordenes:
 *   get:
 *     summary: Historial de órdenes por usuario
 *     description: |
 *       Obtiene el historial de órdenes de un usuario específico con paginación cursor-based.
 *
 *       **Autorización (BOLA Prevention):**
 *       - Clientes solo pueden ver su propio historial
 *       - Administradores/Empleados pueden ver historial de cualquier usuario
 *
 *       **Paginación:**
 *       - Usa cursor-based pagination (Firestore startAfter)
 *       - El campo `nextCursor` en la respuesta contiene el cursor para la siguiente página
 *       - Si `nextCursor` es null, no hay más páginas
 *     tags: [Users]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         description: UID del usuario (Firebase Auth UID)
 *         schema:
 *           type: string
 *           example: "abc123xyz"
 *       - in: query
 *         name: estado
 *         required: false
 *         description: "Filtrar por estado(s), separados por coma. Ej: PENDIENTE,CONFIRMADA"
 *         schema:
 *           type: string
 *           example: "PENDIENTE,CONFIRMADA"
 *       - in: query
 *         name: fechaDesde
 *         required: false
 *         description: "Filtrar desde fecha (ISO 8601). Ej: 2024-01-01T00:00:00Z"
 *         schema:
 *           type: string
 *           format: date-time
 *           example: "2024-01-01T00:00:00Z"
 *       - in: query
 *         name: fechaHasta
 *         required: false
 *         description: "Filtrar hasta fecha (ISO 8601). Ej: 2024-12-31T23:59:59Z"
 *         schema:
 *           type: string
 *           format: date-time
 *           example: "2024-12-31T23:59:59Z"
 *       - in: query
 *         name: limit
 *         required: false
 *         description: "Cantidad de resultados por página (default: 10, max: 50)"
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 50
 *           default: 10
 *           example: 10
 *       - in: query
 *         name: cursor
 *         required: false
 *         description: "ID de la última orden de la página anterior (para siguiente página)"
 *         schema:
 *           type: string
 *           example: "orden_abc123"
 *     responses:
 *       200:
 *         description: Historial de órdenes obtenido exitosamente
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
 *                   description: Cantidad de órdenes en esta página
 *                   example: 5
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Orden'
 *                 pagination:
 *                   type: object
 *                   properties:
 *                     limit:
 *                       type: integer
 *                       example: 10
 *                     nextCursor:
 *                       type: string
 *                       nullable: true
 *                       description: "Cursor para la siguiente página. null si no hay más páginas."
 *                       example: "orden_xyz789"
 *                     hasNextPage:
 *                       type: boolean
 *                       example: true
 *             examples:
 *               primeraPageConMas:
 *                 summary: Primera página con más resultados
 *                 value:
 *                   success: true
 *                   count: 10
 *                   data:
 *                     - id: "orden_001"
 *                       usuarioId: "abc123xyz"
 *                       estado: "ENTREGADA"
 *                       total: 2599.98
 *                       createdAt: "2024-06-15T10:30:00Z"
 *                     - id: "orden_002"
 *                       usuarioId: "abc123xyz"
 *                       estado: "PENDIENTE"
 *                       total: 1299.99
 *                       createdAt: "2024-06-10T14:00:00Z"
 *                   pagination:
 *                     limit: 10
 *                     nextCursor: "orden_002"
 *                     hasNextPage: true
 *               ultimaPagina:
 *                 summary: Última página (sin más resultados)
 *                 value:
 *                   success: true
 *                   count: 3
 *                   data:
 *                     - id: "orden_098"
 *                       usuarioId: "abc123xyz"
 *                       estado: "CANCELADA"
 *                       total: 599.99
 *                       createdAt: "2024-01-05T08:00:00Z"
 *                   pagination:
 *                     limit: 10
 *                     nextCursor: null
 *                     hasNextPage: false
 *               historialVacio:
 *                 summary: Usuario sin órdenes
 *                 value:
 *                   success: true
 *                   count: 0
 *                   data: []
 *                   pagination:
 *                     limit: 10
 *                     nextCursor: null
 *                     hasNextPage: false
 *       401:
 *         $ref: '#/components/responses/401Unauthorized'
 *       403:
 *         description: Sin permisos para ver historial de otro usuario
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
 *                   example: "Acceso denegado. Solo puedes ver tu propio historial de órdenes."
 *       500:
 *         $ref: '#/components/responses/500ServerError'
 */
router.get(
  "/:id/ordenes",
  authMiddleware,
  validateParams(idParamSchema),
  validateQuery(historialOrdenesQuerySchema),
  queryController.getOrderHistory,
);

/**
 * @swagger
 * /api/usuarios/{id}:
 *   get:
 *     summary: Obtener usuario por ID
 *     description: Retorna un usuario específico. Requiere autenticación.
 *     tags: [Users]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Usuario encontrado
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/User'
 *       401:
 *         $ref: '#/components/responses/401Unauthorized'
 *       404:
 *         $ref: '#/components/responses/404NotFound'
 *       500:
 *         $ref: '#/components/responses/500ServerError'
 */
router.get("/:id", authMiddleware, queryController.getById);

/**
 * GET /api/usuarios/categoria/:categoriaId
 * Obtiene usuarios por categoría

router.get("/categoria/:categoriaId", queryController.getByCategory);

 */

/**
 * GET /api/usuarios/linea/:lineaId
 * Obtiene usuarios por línea
 
router.get("/linea/:lineaId", queryController.getByLine);
*/
/**
 * @swagger
 * /api/usuarios/buscar/{termino}:
 *   get:
 *     summary: Buscar usuarios por término
 *     description: Busca usuarios por nombre o email. Requiere autenticación.
 *     tags: [Users]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: termino
 *         required: true
 *         schema:
 *           type: string
 *           minLength: 1
 *           maxLength: 100
 *     responses:
 *       200:
 *         description: Resultados de búsqueda
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 count:
 *                   type: integer
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/User'
 *       401:
 *         $ref: '#/components/responses/401Unauthorized'
 *       500:
 *         $ref: '#/components/responses/500ServerError'
 */
router.get("/buscar/:termino", queryController.search);

// ==========================================
// COMMANDS (Escritura - Transactional & Secure)
// ==========================================

/**
 * @swagger
 * /api/usuarios/exists/email:
 *   get:
 *     summary: Verificar si un email existe
 *     description: Verifica si un email ya está registrado en el sistema
 *     tags: [Users]
 *     parameters:
 *       - in: query
 *         name: email
 *         required: true
 *         schema:
 *           type: string
 *           format: email
 *     responses:
 *       200:
 *         description: Respuesta de verificación
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 exists:
 *                   type: boolean
 *       400:
 *         $ref: '#/components/responses/400BadRequest'
 */
router.get("/exists/email", commandController.checkEmail);

/**
 * @swagger
 * /api/usuarios:
 *   post:
 *     summary: Crear nuevo usuario
 *     description: Crea un nuevo usuario en el sistema
 *     tags: [Users]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - uid
 *               - provider
 *               - nombre
 *               - email
 *             properties:
 *               uid:
 *                 type: string
 *               provider:
 *                 type: string
 *                 enum: [google, apple, email]
 *               nombre:
 *                 type: string
 *               email:
 *                 type: string
 *                 format: email
 *               telefono:
 *                 type: string
 *     responses:
 *       201:
 *         description: Usuario creado exitosamente
 *       400:
 *         $ref: '#/components/responses/400BadRequest'
 *       500:
 *         $ref: '#/components/responses/500ServerError'
 */
router.post("/", commandController.create);

/**
 * @swagger
 * /api/usuarios/completar-perfil:
 *   put:
 *     summary: Completar perfil de usuario
 *     description: Permite al usuario completar su información de perfil. Requiere autenticación.
 *     tags: [Users]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               telefono:
 *                 type: string
 *               fechaNacimiento:
 *                 type: string
 *                 format: date
 *     responses:
 *       200:
 *         description: Perfil actualizado exitosamente
 *       401:
 *         $ref: '#/components/responses/401Unauthorized'
 *       400:
 *         $ref: '#/components/responses/400BadRequest'
 *       500:
 *         $ref: '#/components/responses/500ServerError'
 */
router.put(
  "/completar-perfil",
  authMiddleware,
  commandController.completarPerfil,
);

/**
 * @swagger
 * /api/usuarios/{id}:
 *   put:
 *     summary: Actualizar usuario existente
 *     description: Actualiza los datos de un usuario
 *     tags: [Users]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200:
 *         description: Usuario actualizado exitosamente
 *       404:
 *         $ref: '#/components/responses/404NotFound'
 *       500:
 *         $ref: '#/components/responses/500ServerError'
 */
router.put("/:id", commandController.update);

/**
 * @swagger
 * /api/usuarios/{id}:
 *   delete:
 *     summary: Eliminar usuario (soft delete)
 *     description: Marca un usuario como inactivo
 *     tags: [Users]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Usuario eliminado exitosamente
 *       404:
 *         $ref: '#/components/responses/404NotFound'
 *       500:
 *         $ref: '#/components/responses/500ServerError'
 */
router.delete("/:id", commandController.remove);

/**
 * POST /api/usuarios/:id/imagenes
 * Sube imágenes

router.post(
    "/:id/imagenes",
    upload.array("imagenes", 5),
    commandController.uploadImages
);
 */

/**
 * DELETE /api/usuarios/:id/imagenes
 * Elimina una imagen

router.delete("/:id/imagenes", commandController.deleteImage);
 */
export default router;
