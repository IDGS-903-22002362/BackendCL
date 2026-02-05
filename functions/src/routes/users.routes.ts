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
router.get("/", authMiddleware, queryController.getAll);

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
router.get("/buscar/:termino", authMiddleware, queryController.search);

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
