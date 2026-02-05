/**
 * Rutas para el módulo de Líneas
 * Define los endpoints REST para gestión de líneas de productos
 * Implementa patrón CQRS (Command Query Responsibility Segregation)
 */

import { Router } from "express";
import * as queryController from "../controllers/lines/lines.query.controller";
import * as commandController from "../controllers/lines/lines.command.controller";
import * as debugController from "../controllers/lines/lines.debug.controller";
import {
  validateBody,
  validateParams,
} from "../middleware/validation.middleware";
import {
  createLineSchema,
  updateLineSchema,
} from "../middleware/validators/line.validator";
import {
  idParamSchema,
  searchTermSchema,
} from "../middleware/validators/common.validator";

const router = Router();

// ==========================================
// DEBUG (Solo para desarrollo)
// ==========================================

/**
 * @swagger
 * /api/lineas/debug:
 *   get:
 *     summary: Diagnóstico de Firestore para líneas
 *     description: Endpoint para verificar conexión a Firestore y mostrar información de diagnóstico de líneas
 *     tags: [Debug]
 *     deprecated: true
 *     responses:
 *       200:
 *         description: Diagnóstico completado exitosamente
 *       500:
 *         $ref: '#/components/responses/500ServerError'
 */
router.get("/debug", debugController.debugFirestore);

// ==========================================
// QUERIES (Lectura - Safe & Cacheable)
// ==========================================

/**
 * @swagger
 * /api/lineas:
 *   get:
 *     summary: Listar todas las líneas activas
 *     description: Obtiene la lista completa de líneas activas del catálogo
 *     tags: [Lines]
 *     responses:
 *       200:
 *         description: Lista de líneas obtenida exitosamente
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
 *                   example: 5
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Line'
 *       500:
 *         $ref: '#/components/responses/500ServerError'
 */
router.get("/", queryController.getAll);

/**
 * @swagger
 * /api/lineas/buscar/{termino}:
 *   get:
 *     summary: Buscar líneas por término
 *     description: Busca líneas por nombre. Búsqueda case-insensitive.
 *     tags: [Lines]
 *     parameters:
 *       - in: path
 *         name: termino
 *         required: true
 *         description: Término de búsqueda (mínimo 1 carácter)
 *         schema:
 *           type: string
 *           minLength: 1
 *           maxLength: 100
 *           example: "jersey"
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
 *                   example: true
 *                 count:
 *                   type: integer
 *                   example: 2
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Line'
 *       400:
 *         $ref: '#/components/responses/400BadRequest'
 *       500:
 *         $ref: '#/components/responses/500ServerError'
 */
router.get(
  "/buscar/:termino",
  validateParams(searchTermSchema),
  queryController.search,
);

/**
 * @swagger
 * /api/lineas/{id}:
 *   get:
 *     summary: Obtener línea por ID
 *     description: Retorna una línea específica buscada por su ID
 *     tags: [Lines]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         description: ID de la línea
 *         schema:
 *           type: string
 *           example: "jersey"
 *     responses:
 *       200:
 *         description: Línea encontrada
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/Line'
 *       404:
 *         $ref: '#/components/responses/404NotFound'
 *       500:
 *         $ref: '#/components/responses/500ServerError'
 */
router.get("/:id", validateParams(idParamSchema), queryController.getById);

// ==========================================
// COMMANDS (Escritura - Transactional & Secure)
// ==========================================

/**
 * @swagger
 * /api/lineas:
 *   post:
 *     summary: Crear nueva línea
 *     description: Crea una nueva línea de productos. Valida unicidad del código.
 *     tags: [Lines]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateLine'
 *           example:
 *             codigo: 1
 *             nombre: "Jersey Oficial"
 *     responses:
 *       201:
 *         description: Línea creada exitosamente
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
 *                   example: "Línea creada exitosamente"
 *                 data:
 *                   $ref: '#/components/schemas/Line'
 *       400:
 *         $ref: '#/components/responses/400BadRequest'
 *       500:
 *         $ref: '#/components/responses/500ServerError'
 */
router.post("/", validateBody(createLineSchema), commandController.create);

/**
 * @swagger
 * /api/lineas/{id}:
 *   put:
 *     summary: Actualizar línea existente
 *     description: Actualiza los campos de una línea. Permite actualización parcial.
 *     tags: [Lines]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         description: ID de la línea a actualizar
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UpdateLine'
 *           example:
 *             nombre: "Jersey Oficial Premium"
 *     responses:
 *       200:
 *         description: Línea actualizada exitosamente
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
 *                   example: "Línea actualizada exitosamente"
 *                 data:
 *                   $ref: '#/components/schemas/Line'
 *       400:
 *         $ref: '#/components/responses/400BadRequest'
 *       404:
 *         $ref: '#/components/responses/404NotFound'
 *       500:
 *         $ref: '#/components/responses/500ServerError'
 */
router.put(
  "/:id",
  validateParams(idParamSchema),
  validateBody(updateLineSchema),
  commandController.update,
);

/**
 * @swagger
 * /api/lineas/{id}:
 *   delete:
 *     summary: Eliminar línea (soft delete)
 *     description: Marca una línea como inactiva en lugar de eliminarla físicamente
 *     tags: [Lines]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         description: ID de la línea a eliminar
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Línea eliminada exitosamente
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
 *                   example: "Línea eliminada exitosamente"
 *       404:
 *         $ref: '#/components/responses/404NotFound'
 *       500:
 *         $ref: '#/components/responses/500ServerError'
 */
router.delete("/:id", validateParams(idParamSchema), commandController.remove);

export default router;
