import { Router } from "express";
import * as queryController from "../controllers/providers/providers.query.controller";
import * as commandController from "../controllers/providers/providers.command.controller";
import * as debugController from "../controllers/providers/providers.debug.controller";
import {
  validateBody,
  validateParams,
} from "../middleware/validation.middleware";
import {
  createProviderSchema,
  updateProviderSchema,
} from "../middleware/validators/provider.validator";
import {
  idParamSchema,
  searchTermSchema,
} from "../middleware/validators/common.validator";

const router = Router();

// ============================================
// DEBUG (Solo desarrollo)
// ============================================

/**
 * @swagger
 * /api/proveedores/debug:
 *   get:
 *     summary: Diagnóstico de Firestore para proveedores
 *     description: Endpoint de diagnóstico para desarrollo
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
// QUERIES (Lectura)
// ============================================

/**
 * @swagger
 * /api/proveedores:
 *   get:
 *     summary: Listar todos los proveedores activos
 *     description: Obtiene la lista completa de proveedores activos
 *     tags: [Providers]
 *     responses:
 *       200:
 *         description: Lista de proveedores obtenida exitosamente
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
 *                   example: 8
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Provider'
 *       500:
 *         $ref: '#/components/responses/500ServerError'
 */
router.get("/", queryController.getAll);

/**
 * @swagger
 * /api/proveedores/buscar/{termino}:
 *   get:
 *     summary: Buscar proveedores por término
 *     description: Busca proveedores por nombre. Búsqueda case-insensitive.
 *     tags: [Providers]
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
 *                     $ref: '#/components/schemas/Provider'
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
 * /api/proveedores/{id}:
 *   get:
 *     summary: Obtener proveedor por ID
 *     description: Retorna un proveedor específico
 *     tags: [Providers]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Proveedor encontrado
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/Provider'
 *       404:
 *         $ref: '#/components/responses/404NotFound'
 *       500:
 *         $ref: '#/components/responses/500ServerError'
 */
router.get("/:id", validateParams(idParamSchema), queryController.getById);

// ============================================
// COMMANDS (Escritura)
// ============================================

/**
 * @swagger
 * /api/proveedores:
 *   post:
 *     summary: Crear nuevo proveedor
 *     description: Crea un nuevo proveedor en el sistema
 *     tags: [Providers]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateProvider'
 *     responses:
 *       201:
 *         description: Proveedor creado exitosamente
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
 *                   $ref: '#/components/schemas/Provider'
 *       400:
 *         $ref: '#/components/responses/400BadRequest'
 *       500:
 *         $ref: '#/components/responses/500ServerError'
 */
router.post("/", validateBody(createProviderSchema), commandController.create);

/**
 * @swagger
 * /api/proveedores/{id}:
 *   put:
 *     summary: Actualizar proveedor existente
 *     description: Actualiza los campos de un proveedor
 *     tags: [Providers]
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
 *             $ref: '#/components/schemas/UpdateProvider'
 *     responses:
 *       200:
 *         description: Proveedor actualizado exitosamente
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
  validateBody(updateProviderSchema),
  commandController.update,
);

/**
 * @swagger
 * /api/proveedores/{id}:
 *   delete:
 *     summary: Eliminar proveedor (soft delete)
 *     description: Marca un proveedor como inactivo
 *     tags: [Providers]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Proveedor eliminado exitosamente
 *       404:
 *         $ref: '#/components/responses/404NotFound'
 *       500:
 *         $ref: '#/components/responses/500ServerError'
 */
router.delete("/:id", validateParams(idParamSchema), commandController.remove);

export default router;
