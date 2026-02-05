import { Router } from "express";
import * as queryController from "../controllers/categories/categories.query.controller";
import * as commandController from "../controllers/categories/categories.command.controller";
import * as debugController from "../controllers/categories/categories.debug.controller";
import {
  validateBody,
  validateParams,
} from "../middleware/validation.middleware";
import {
  createCategorySchema,
  updateCategorySchema,
} from "../middleware/validators/category.validator";
import {
  idParamSchema,
  searchTermSchema,
  lineaIdParamSchema,
} from "../middleware/validators/common.validator";

const router = Router();

// ============================================
// ENDPOINT DE DEBUG (solo para desarrollo)
// ============================================

/**
 * @swagger
 * /api/categorias/debug:
 *   get:
 *     summary: Diagnóstico de Firestore para categorías
 *     description: Endpoint para verificar conexión a Firestore y mostrar información de diagnóstico
 *     tags: [Debug]
 *     deprecated: true
 *     responses:
 *       200:
 *         description: Diagnóstico completado exitosamente
 *       500:
 *         $ref: '#/components/responses/500ServerError'
 */
router.get("/debug", debugController.debugFirestore);

// ============================================
// QUERIES - Operaciones de lectura
// ============================================

/**
 * @swagger
 * /api/categorias:
 *   get:
 *     summary: Listar todas las categorías activas
 *     description: Obtiene la lista completa de categorías activas del catálogo
 *     tags: [Categories]
 *     responses:
 *       200:
 *         description: Lista de categorías obtenida exitosamente
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
 *                   example: 12
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Category'
 *       500:
 *         $ref: '#/components/responses/500ServerError'
 */
router.get("/", queryController.getAll);

/**
 * @swagger
 * /api/categorias/buscar/{termino}:
 *   get:
 *     summary: Buscar categorías por término
 *     description: Busca categorías por nombre. Búsqueda case-insensitive. NOTA - Esta ruta debe ir ANTES de /:id para evitar conflictos.
 *     tags: [Categories]
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
 *                   example: 3
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Category'
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
 * /api/categorias/linea/{lineaId}:
 *   get:
 *     summary: Obtener categorías por línea
 *     description: Filtra y retorna categorías que pertenecen a una línea específica
 *     tags: [Categories]
 *     parameters:
 *       - in: path
 *         name: lineaId
 *         required: true
 *         description: ID de la línea de producto
 *         schema:
 *           type: string
 *           example: "jersey"
 *     responses:
 *       200:
 *         description: Lista de categorías de la línea
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
 *                   example: 4
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Category'
 *       500:
 *         $ref: '#/components/responses/500ServerError'
 */
router.get(
  "/linea/:lineaId",
  validateParams(lineaIdParamSchema),
  queryController.getByLine,
);

/**
 * @swagger
 * /api/categorias/{id}:
 *   get:
 *     summary: Obtener categoría por ID
 *     description: Retorna una categoría específica buscada por su ID
 *     tags: [Categories]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         description: ID de la categoría
 *         schema:
 *           type: string
 *           example: "jersey_hombre"
 *     responses:
 *       200:
 *         description: Categoría encontrada
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/Category'
 *       404:
 *         $ref: '#/components/responses/404NotFound'
 *       500:
 *         $ref: '#/components/responses/500ServerError'
 */
router.get("/:id", validateParams(idParamSchema), queryController.getById);

// ============================================
// COMMANDS - Operaciones de escritura
// ============================================

/**
 * @swagger
 * /api/categorias:
 *   post:
 *     summary: Crear nueva categoría
 *     description: Crea una nueva categoría en el catálogo. Valida unicidad del nombre.
 *     tags: [Categories]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateCategory'
 *           example:
 *             nombre: "Jersey Hombre"
 *             lineaId: "jersey"
 *             orden: 1
 *     responses:
 *       201:
 *         description: Categoría creada exitosamente
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
 *                   example: "Categoría creada exitosamente"
 *                 data:
 *                   $ref: '#/components/schemas/Category'
 *       400:
 *         $ref: '#/components/responses/400BadRequest'
 *       500:
 *         $ref: '#/components/responses/500ServerError'
 */
router.post("/", validateBody(createCategorySchema), commandController.create);

/**
 * @swagger
 * /api/categorias/{id}:
 *   put:
 *     summary: Actualizar categoría existente
 *     description: Actualiza los campos de una categoría. Permite actualización parcial.
 *     tags: [Categories]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         description: ID de la categoría a actualizar
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UpdateCategory'
 *           example:
 *             nombre: "Jersey Hombre Premium"
 *             orden: 2
 *     responses:
 *       200:
 *         description: Categoría actualizada exitosamente
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
 *                   example: "Categoría actualizada exitosamente"
 *                 data:
 *                   $ref: '#/components/schemas/Category'
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
  validateBody(updateCategorySchema),
  commandController.update,
);

/**
 * @swagger
 * /api/categorias/{id}:
 *   delete:
 *     summary: Eliminar categoría (soft delete)
 *     description: Marca una categoría como inactiva en lugar de eliminarla físicamente
 *     tags: [Categories]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         description: ID de la categoría a eliminar
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Categoría eliminada exitosamente
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
 *                   example: "Categoría eliminada exitosamente"
 *       404:
 *         $ref: '#/components/responses/404NotFound'
 *       500:
 *         $ref: '#/components/responses/500ServerError'
 */
router.delete("/:id", validateParams(idParamSchema), commandController.remove);

export default router;
