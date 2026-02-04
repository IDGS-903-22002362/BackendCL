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
router.get("/debug", debugController.debugFirestore);

// ============================================
// QUERIES (Lectura)
// ============================================

// Listar todos los proveedores activos
router.get("/", queryController.getAll);

// Buscar proveedores por término (ANTES de /:id para evitar conflictos)
router.get(
  "/buscar/:termino",
  validateParams(searchTermSchema),
  queryController.search,
);

// Obtener proveedor por ID
router.get("/:id", validateParams(idParamSchema), queryController.getById);

// ============================================
// COMMANDS (Escritura)
// ============================================

// Crear nuevo proveedor
router.post("/", validateBody(createProviderSchema), commandController.create);

// Actualizar proveedor existente
router.put(
  "/:id",
  validateParams(idParamSchema),
  validateBody(updateProviderSchema),
  commandController.update,
);

// Eliminar proveedor (soft delete)
router.delete("/:id", validateParams(idParamSchema), commandController.remove);

export default router;
