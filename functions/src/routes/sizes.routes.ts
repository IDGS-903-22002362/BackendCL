/**
 * Rutas para el módulo de Tallas
 * Define todos los endpoints CRUD para gestión de tallas
 */

import { Router } from "express";
import * as queryController from "../controllers/sizes/sizes.query.controller";
import * as commandController from "../controllers/sizes/sizes.command.controller";
import * as debugController from "../controllers/sizes/sizes.debug.controller";
import {
  validateBody,
  validateParams,
} from "../middleware/validation.middleware";
import {
  createSizeSchema,
  updateSizeSchema,
} from "../middleware/validators/size.validator";
import { idParamSchema } from "../middleware/validators/common.validator";

const router = Router();

// ============================================
// RUTAS DE DIAGNÓSTICO (DEBUG)
// ============================================

/**
 * @swagger
 * /api/tallas/debug:
 *   get:
 *     summary: Diagnóstico de Firestore para tallas
 *     description: Endpoint de diagnóstico para verificar conexión a Firestore y estructura de datos
 *     tags: [Debug]
 *     deprecated: true
 *     responses:
 *       200:
 *         description: Diagnóstico completado
 *       500:
 *         $ref: '#/components/responses/500ServerError'
 */
router.get("/debug", debugController.debugFirestore);

// ============================================
// RUTAS DE LECTURA (QUERIES)
// ============================================

/**
 * @swagger
 * /api/tallas:
 *   get:
 *     summary: Listar todas las tallas
 *     description: Obtiene todas las tallas ordenadas por el campo 'orden'
 *     tags: [Sizes]
 *     responses:
 *       200:
 *         description: Lista de tallas obtenida exitosamente
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
 *                   example: 6
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Size'
 *       500:
 *         $ref: '#/components/responses/500ServerError'
 */
router.get("/", queryController.getAll);

/**
 * @swagger
 * /api/tallas/{id}:
 *   get:
 *     summary: Obtener talla por ID
 *     description: Retorna una talla específica por su ID
 *     tags: [Sizes]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         description: ID de la talla
 *         schema:
 *           type: string
 *           example: "m"
 *     responses:
 *       200:
 *         description: Talla encontrada
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/Size'
 *       404:
 *         $ref: '#/components/responses/404NotFound'
 *       500:
 *         $ref: '#/components/responses/500ServerError'
 */
router.get("/:id", validateParams(idParamSchema), queryController.getById);

// ============================================
// RUTAS DE ESCRITURA (COMMANDS)
// ============================================

/**
 * @swagger
 * /api/tallas:
 *   post:
 *     summary: Crear nueva talla
 *     description: Crea una nueva talla en el sistema
 *     tags: [Sizes]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateSize'
 *           example:
 *             codigo: "XL"
 *             descripcion: "Extra Grande"
 *             orden: 5
 *     responses:
 *       201:
 *         description: Talla creada exitosamente
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 data:
 *                   $ref: '#/components/schemas/Size'
 *       400:
 *         $ref: '#/components/responses/400BadRequest'
 *       500:
 *         $ref: '#/components/responses/500ServerError'
 */
router.post("/", validateBody(createSizeSchema), commandController.create);

/**
 * @swagger
 * /api/tallas/{id}:
 *   put:
 *     summary: Actualizar talla existente
 *     description: Actualiza los campos de una talla
 *     tags: [Sizes]
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
 *             $ref: '#/components/schemas/UpdateSize'
 *     responses:
 *       200:
 *         description: Talla actualizada exitosamente
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
  validateBody(updateSizeSchema),
  commandController.update,
);

/**
 * @swagger
 * /api/tallas/{id}:
 *   delete:
 *     summary: Eliminar talla (eliminación física)
 *     description: Elimina permanentemente una talla del sistema. NOTA - A diferencia de otros recursos, las tallas usan eliminación física, no soft delete.
 *     tags: [Sizes]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Talla eliminada exitosamente
 *       404:
 *         $ref: '#/components/responses/404NotFound'
 *       500:
 *         $ref: '#/components/responses/500ServerError'
 */
router.delete("/:id", validateParams(idParamSchema), commandController.remove);

export default router;
