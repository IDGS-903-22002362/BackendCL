/**
 * Rutas para el módulo de Productos
 * Define los endpoints REST para gestión de productos
 * Implementa patrón CQRS (Command Query Responsibility Segregation)
 */

import { Router } from "express";
import multer from "multer";
import * as queryController from "../controllers/products/products.query.controller";
import * as commandController from "../controllers/products/products.command.controller";
import * as debugController from "../controllers/products/products.debug.controller";
import {
  validateBody,
  validateParams,
} from "../middleware/validation.middleware";
import {
  createProductSchema,
  updateProductSchema,
  deleteImageSchema,
} from "../middleware/validators/product.validator";
import {
  idParamSchema,
  searchTermSchema,
  categoriaIdParamSchema,
  lineaIdParamSchema,
} from "../middleware/validators/common.validator";

// Configurar multer para almacenar archivos en memoria
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // Límite de 5MB por archivo
  },
  fileFilter: (_req, file, cb) => {
    // Aceptar solo imágenes
    if (file.mimetype.startsWith("image/")) {
      cb(null, true);
    } else {
      cb(new Error("Solo se permiten archivos de imagen"));
    }
  },
});

const router = Router();

// ==========================================
// DEBUG (Solo para desarrollo)
// ==========================================

/**
 * GET /api/productos/debug
 * Endpoint de diagnóstico para verificar conexión a Firestore
 */
router.get("/debug", debugController.debugFirestore);

// ==========================================
// QUERIES (Lectura - Safe & Cacheable)
// ==========================================

/**
 * GET /api/productos
 * Obtiene todos los productos activos
 */
router.get("/", queryController.getAll);

/**
 * GET /api/productos/:id
 * Obtiene un producto específico por ID
 */
router.get("/:id", validateParams(idParamSchema), queryController.getById);

/**
 * GET /api/productos/categoria/:categoriaId
 * Obtiene productos por categoría
 */
router.get(
  "/categoria/:categoriaId",
  validateParams(categoriaIdParamSchema),
  queryController.getByCategory,
);

/**
 * GET /api/productos/linea/:lineaId
 * Obtiene productos por línea
 */
router.get(
  "/linea/:lineaId",
  validateParams(lineaIdParamSchema),
  queryController.getByLine,
);

/**
 * GET /api/productos/buscar/:termino
 * Busca productos por término
 */
router.get(
  "/buscar/:termino",
  validateParams(searchTermSchema),
  queryController.search,
);

// ==========================================
// COMMANDS (Escritura - Transactional & Secure)
// ==========================================

/**
 * POST /api/productos
 * Crea un nuevo producto
 */
router.post("/", validateBody(createProductSchema), commandController.create);

/**
 * PUT /api/productos/:id
 * Actualiza un producto existente
 */
router.put(
  "/:id",
  validateParams(idParamSchema),
  validateBody(updateProductSchema),
  commandController.update,
);

/**
 * DELETE /api/productos/:id
 * Elimina un producto (soft delete)
 */
router.delete("/:id", validateParams(idParamSchema), commandController.remove);

/**
 * POST /api/productos/:id/imagenes
 * Sube imágenes
 */
router.post(
  "/:id/imagenes",
  validateParams(idParamSchema),
  upload.array("imagenes", 5),
  commandController.uploadImages,
);

/**
 * DELETE /api/productos/:id/imagenes
 * Elimina una imagen
 */
router.delete(
  "/:id/imagenes",
  validateParams(idParamSchema),
  validateBody(deleteImageSchema),
  commandController.deleteImage,
);

export default router;
