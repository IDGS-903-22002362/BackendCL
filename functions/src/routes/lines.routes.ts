/**
 * Rutas para el módulo de Productos
 * Define los endpoints REST para gestión de productos
 * Implementa patrón CQRS (Command Query Responsibility Segregation)
 */

import { Router } from "express";
import * as queryController from "../controllers/lines/lines.query.controller";
import * as commandController from "../controllers/lines/lines.command.controller";
import * as debugController from "../controllers/lines/lines.debug.controller";
import { authMiddleware } from "../utils/middlewares";


const router = Router();

// ==========================================
// DEBUG (Solo para desarrollo)
// ==========================================

/**
 * GET /api/productos/debug
 * Endpoint de diagnóstico para verificar conexión a Firestore
 */
router.get("/debug", authMiddleware, debugController.debugFirestore);

// ==========================================
// QUERIES (Lectura - Safe & Cacheable)
// ==========================================

/**
 * GET /api/lineas
 * Obtiene todos las lineas activos
 */
router.get("/", authMiddleware, queryController.getAll);

/**
 * GET /api/lineas/buscar/:termino
 * Busca productos por término
 */
router.get("/buscar/:termino", authMiddleware, queryController.search);

/**
 * GET /api/lineas/:id
 * Obtiene una lineas específico por ID
 */
router.get("/:id", authMiddleware, queryController.getById);


// ==========================================
// COMMANDS (Escritura - Transactional & Secure)
// ==========================================

/**
 * POST /api/lineas
 * Crea una nueva linea
 */
router.post("/", authMiddleware, commandController.create);

/**
 * PUT /api/lineas/:id
 * Actualiza una linea existente
 */
router.put("/:id", authMiddleware, commandController.update);

/**
 * DELETE /api/productos/:id
 * Elimina un producto (soft delete)
 */
router.delete("/:id", authMiddleware, commandController.remove);


export default router;
