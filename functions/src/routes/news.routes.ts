/**
 * Rutas para el módulo de Noticias
 * Define los endpoints REST para gestión de noticias
 */

import { Router } from "express";
import multer from "multer";
import * as queryController from "../controllers/noticias/news.query.controller";
import * as commandController from "../controllers/noticias/news.command.controller";
import {
    validateBody,
    validateParams,
} from "../middleware/validation.middleware";
import {
    createNewSchema,
    updateNewSchema,
    deleteImageSchema,
} from "../middleware/validators/new.validator";
import {
    idParamSchema,
    searchTermSchema,
} from "../middleware/validators/common.validator";

// Configurar multer para almacenar archivos en memoria
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 5 * 1024 * 1024, // Límite de 5MB por archivo
    },
    fileFilter: (_req, file, cb) => {
        if (file.mimetype.startsWith("image/")) {
            cb(null, true);
        } else {
            cb(new Error("Solo se permiten archivos de imagen"));
        }
    },
});

const router = Router();

// ==========================================
// RUTAS PRINCIPALES (mantén este orden)
// ==========================================

// 1. Rutas específicas SIN parámetros (van primero)
/**
 * @swagger
 * /api/noticias:
 *   get:
 *     summary: Listar todas las noticias activas
 *     description: Obtiene la lista completa de noticias activas ordenadas por fecha
 *     tags: [News]
 *     responses:
 *       200:
 *         description: Lista de noticias obtenida exitosamente
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
 *                     $ref: '#/components/schemas/News'
 */
router.get("/", queryController.getAll);

/**
 * @swagger
 * /api/noticias:
 *   post:
 *     summary: Crear nueva noticia
 *     description: Crea una nueva noticia en el sistema
 *     tags: [News]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateNews'
 *     responses:
 *       201:
 *         description: Noticia creada exitosamente
 *       400:
 *         description: Error de validación
 *       500:
 *         description: Error del servidor
 */
router.post("/", validateBody(createNewSchema), commandController.create);

// 2. Rutas con parámetros específicas
/**
 * @swagger
 * /api/noticias/buscar/{termino}:
 *   get:
 *     summary: Buscar noticias por término
 *     description: Busca noticias por título o contenido
 *     tags: [News]
 *     parameters:
 *       - in: path
 *         name: termino
 *         required: true
 *     responses:
 *       200:
 *         description: Resultados de búsqueda
 */
router.get(
    "/buscar/:termino",
    validateParams(searchTermSchema),
    queryController.search
);

// 3. Rutas con ID genérico (van AL FINAL)
/**
 * @swagger
 * /api/noticias/{id}:
 *   get:
 *     summary: Obtener noticia por ID
 *     tags: [News]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *     responses:
 *       200:
 *         description: Noticia encontrada
 */
router.get("/:id", validateParams(idParamSchema), queryController.getById);

// 5. Ruta especial de IA
router.post(
    "/:id/generar-ia",
    validateParams(idParamSchema),
    commandController.generarIA
);
/**
 * @swagger
 * /api/noticias/sync-instagram:
 *   post:
 *     summary: Sincroniza publicaciones de Instagram como noticias
 *     tags: [News]
 *     responses:
 *       200:
 *         description: Noticias sincronizadas correctamente
 */
router.post(
    "/sync-instagram",
    commandController.syncInstagramNoticias
);


/**
 * @swagger
 * /api/noticias/{id}:
 *   put:
 *     summary: Actualizar noticia existente
 *     tags: [News]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *     responses:
 *       200:
 *         description: Noticia actualizada
 */
router.put(
    "/:id",
    validateParams(idParamSchema),
    validateBody(updateNewSchema),
    commandController.update
);

/**
 * @swagger
 * /api/noticias/{id}:
 *   delete:
 *     summary: Eliminar noticia (soft delete)
 *     tags: [News]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *     responses:
 *       200:
 *         description: Noticia eliminada
 */
router.delete("/:id", validateParams(idParamSchema), commandController.remove);

// 4. Rutas de imágenes
router.post(
    "/:id/imagenes",
    validateParams(idParamSchema),
    upload.array("imagenes", 5),
    commandController.uploadImages
);

router.delete(
    "/:id/imagenes",
    validateParams(idParamSchema),
    validateBody(deleteImageSchema),
    commandController.deleteImage
);


export default router;