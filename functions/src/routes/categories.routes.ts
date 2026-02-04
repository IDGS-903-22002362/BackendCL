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
router.get("/debug", debugController.debugFirestore);

// ============================================
// QUERIES - Operaciones de lectura
// ============================================

/**
 * GET /api/categorias
 * Obtiene todas las categorías activas
 */
router.get("/", queryController.getAll);

/**
 * GET /api/categorias/buscar/:termino
 * Busca categorías por término en el nombre
 * NOTA: Debe ir ANTES de /:id para evitar conflictos de rutas
 */
router.get(
  "/buscar/:termino",
  validateParams(searchTermSchema),
  queryController.search,
);

/**
 * GET /api/categorias/linea/:lineaId
 * Obtiene categorías por línea
 */
router.get(
  "/linea/:lineaId",
  validateParams(lineaIdParamSchema),
  queryController.getByLine,
);

/**
 * GET /api/categorias/:id
 * Obtiene una categoría específica por ID
 */
router.get("/:id", validateParams(idParamSchema), queryController.getById);

// ============================================
// COMMANDS - Operaciones de escritura
// ============================================

/**
 * POST /api/categorias
 * Crea una nueva categoría
 * Body: { nombre: string, lineaId?: string, orden?: number }
 */
router.post("/", validateBody(createCategorySchema), commandController.create);

/**
 * PUT /api/categorias/:id
 * Actualiza una categoría existente
 * Body: { nombre?: string, lineaId?: string, orden?: number }
 */
router.put(
  "/:id",
  validateParams(idParamSchema),
  validateBody(updateCategorySchema),
  commandController.update,
);

/**
 * DELETE /api/categorias/:id
 * Elimina una categoría (soft delete)
 */
router.delete("/:id", validateParams(idParamSchema), commandController.remove);

export default router;
