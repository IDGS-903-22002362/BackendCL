import { Router } from "express";
import * as queryController from "../controllers/providers/providers.query.controller";
import * as commandController from "../controllers/providers/providers.command.controller";
import * as debugController from "../controllers/providers/providers.debug.controller";

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
router.get("/buscar/:termino", queryController.search);

// Obtener proveedor por ID
router.get("/:id", queryController.getById);

// ============================================
// COMMANDS (Escritura)
// ============================================

// Crear nuevo proveedor
router.post("/", commandController.create);

// Actualizar proveedor existente
router.put("/:id", commandController.update);

// Eliminar proveedor (soft delete)
router.delete("/:id", commandController.remove);

export default router;
