/**
 * Rutas para el módulo de Galería
 * Define los endpoints REST para gestión de fotos y videos (reels)
 */

import { Router } from "express";
import multer from "multer";
import * as command from "../controllers/galeria/galeria.command.controller";
import * as query from "../controllers/galeria/galeria.query.controller";
import { authMiddleware } from "../utils/middlewares";

const router = Router();

// Configurar multer
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 20 * 1024 * 1024, // 20MB
    },
});

// ==========================================
// RUTAS PRINCIPALES
// ==========================================

/**
 * @swagger
 * /api/galeria:
 *   get:
 *     summary: Listar todas las galerías activas
 *     description: Obtiene la lista de publicaciones de galería (imágenes y reels)
 *     tags: [Galeria]
 *     responses:
 *       200:
 *         description: Lista de galerías obtenida exitosamente
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
 *                     $ref: '#/components/schemas/Galeria'
 */
router.get("/", query.getAll);

/**
 * @swagger
 * /api/galeria:
 *   post:
 *     summary: Crear nueva publicación de galería
 *     description: Crea una nueva entrada en la galería (requiere autenticación)
 *     tags: [Galeria]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               descripcion:
 *                 type: string
 *                 example: Fotos del partido del domingo
 *     responses:
 *       201:
 *         description: Publicación creada correctamente
 *       401:
 *         description: Usuario no autenticado
 */
router.post("/", authMiddleware, command.create);

// ==========================================
// RUTAS CON ID
// ==========================================

/**
 * @swagger
 * /api/galeria/{id}:
 *   get:
 *     summary: Obtener galería por ID
 *     description: Devuelve una publicación específica de galería
 *     tags: [Galeria]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: ID de la galería
 *     responses:
 *       200:
 *         description: Galería encontrada
 *       404:
 *         description: Galería no encontrada
 */
router.get("/:id", query.getById);


// ==========================================
// RUTAS DE ARCHIVOS
// ==========================================

/**
 * @swagger
 * /api/galeria/{id}/imagenes:
 *   post:
 *     summary: Subir imágenes a la galería
 *     description: Permite subir múltiples imágenes a una publicación de galería
 *     tags: [Galeria]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: ID de la galería
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               imagenes:
 *                 type: array
 *                 items:
 *                   type: string
 *                   format: binary
 *     responses:
 *       200:
 *         description: Imágenes subidas correctamente
 *       404:
 *         description: Galería no encontrada
 */
router.post(
    "/:id/imagenes",
    authMiddleware,
    upload.array("imagenes", 10),
    command.uploadImages
);

/**
 * @swagger
 * /api/galeria/{id}/videos:
 *   post:
 *     summary: Subir videos (reels) a la galería
 *     description: Permite subir videos cortos a una publicación de galería
 *     tags: [Galeria]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: ID de la galería
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               videos:
 *                 type: array
 *                 items:
 *                   type: string
 *                   format: binary
 *     responses:
 *       200:
 *         description: Videos subidos correctamente
 *       404:
 *         description: Galería no encontrada
 */
router.post(
    "/:id/videos",
    authMiddleware,
    upload.array("videos", 5),
    command.uploadVideos
);


/**
 * @swagger
 * /api/galeria/{id}/imagenes:
 *   delete:
 *     summary: Eliminar imagen de galería
 *     tags: [Galeria]
 *     security:
 *       - BearerAuth: []
 */
router.delete(
    "/:id/imagenes",
    authMiddleware,
    command.deleteImage
);

/**
 * @swagger
 * /api/galeria/{id}/videos:
 *   delete:
 *     summary: Eliminar video de galería
 *     tags: [Galeria]
 *     security:
 *       - BearerAuth: []
 */
router.delete(
    "/:id/videos",
    authMiddleware,
    command.deleteVideo
);

export default router;