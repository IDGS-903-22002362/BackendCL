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
 * GET /api/usuarios/debug
 * Endpoint de diagnóstico para verificar conexión a Firestore
 */
router.get("/debug", authMiddleware, debugController.debugFirestore);

// ==========================================
// QUERIES (Lectura - Safe & Cacheable)
// ==========================================

/**
 * GET /api/usuarios
 * Obtiene todos los usuarios activos
 */
router.get("/", authMiddleware, queryController.getAll);

/**
 * GET /api/usuarios/:id
 * Obtiene un usuario específico por ID
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
 * GET /api/usuarios/buscar/:termino
 * Busca usuarios por término
 */
router.get("/buscar/:termino", authMiddleware, queryController.search);

// ==========================================
// COMMANDS (Escritura - Transactional & Secure)
// ==========================================

/**
 * POST /api/usuarios
 * Crea un nuevo usuario
 */
router.post("/", commandController.create);


router.get("/exists/email", commandController.checkEmail);
/**
 * Update /api/usuarios/completar
 */
router.put("/completar-perfil", authMiddleware, commandController.completarPerfil);

/**
 * PUT /api/usuarios/:id
 * Actualiza un usuario existente
 */
router.put("/:id", commandController.update);

/**
 * DELETE /api/usuarios/:id
 * Elimina un usuario (soft delete)
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
