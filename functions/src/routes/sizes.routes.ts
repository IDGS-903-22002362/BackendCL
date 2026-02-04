/**
 * Rutas para el módulo de Tallas
 * Define todos los endpoints CRUD para gestión de tallas
 */

import { Router } from "express";
import * as queryController from "../controllers/sizes/sizes.query.controller";
import * as commandController from "../controllers/sizes/sizes.command.controller";
import * as debugController from "../controllers/sizes/sizes.debug.controller";

const router = Router();

// ============================================
// RUTAS DE DIAGNÓSTICO (DEBUG)
// ============================================

/**
 * GET /api/tallas/debug
 * Endpoint de diagnóstico para verificar conexión a Firestore
 * y consultar estructura de datos de tallas
 */
router.get("/debug", debugController.debugFirestore);

// ============================================
// RUTAS DE LECTURA (QUERIES)
// ============================================

/**
 * GET /api/tallas
 * Obtener todas las tallas ordenadas por 'orden'
 */
router.get("/", queryController.getAll);

/**
 * GET /api/tallas/:id
 * Obtener una talla específica por su ID
 */
router.get("/:id", queryController.getById);

// ============================================
// RUTAS DE ESCRITURA (COMMANDS)
// ============================================

/**
 * POST /api/tallas
 * Crear una nueva talla
 * Body: { codigo: string, descripcion: string, orden?: number }
 */
router.post("/", commandController.create);

/**
 * PUT /api/tallas/:id
 * Actualizar una talla existente
 * Body: { codigo?: string, descripcion?: string, orden?: number }
 */
router.put("/:id", commandController.update);

/**
 * DELETE /api/tallas/:id
 * Eliminar una talla (eliminación física)
 */
router.delete("/:id", commandController.remove);

export default router;
