import { Router } from "express";
import * as queryController from "../controllers/banner/banner.query.controller";
import * as commandController from "../controllers/banner/banner.command.controller";
import { authMiddleware, requireAdmin } from "../utils/middlewares";
import { validateBody, validateParams } from "../middleware/validation.middleware";
import { createBannerSchema, updateBannerSchema } from "../middleware/validators/banner.validator";
import { idParamSchema } from "../middleware/validators/common.validator";
import { parseMultipartImages } from "../middleware/multipart.middleware";

const router = Router();
console.log("🔥 Cargando módulo de rutas de bannerssssssssssss");

// ==========================================
// QUERIES (Lectura - Públicas)
// ==========================================

/**
 * @swagger
 * /api/banners:
 *   get:
 *     summary: Obtener todos los banners (activos e inactivos)
 *     description: Retorna la lista completa de banners ordenados por el campo `order` ascendente. Incluye tanto banners activos como inactivos.
 *     tags: [Banners]
 *     responses:
 *       200:
 *         description: Lista de banners obtenida exitosamente
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Banner'
 *       500:
 *         $ref: '#/components/responses/500ServerError'
 */
router.get("/", queryController.getAll);

/**
 * @swagger
 * /api/banners/active:
 *   get:
 *     summary: Obtener todos los banners activos con sus productos populados
 *     description: |
 *       Retorna un array de banners que tienen `active: true`, ordenados por `order` ascendente.
 *       Cada banner incluye la lista completa de productos asociados (populados con todos sus datos).
 *       Es el endpoint ideal para el carrusel del frontend público.
 *     tags: [Banners]
 *     responses:
 *       200:
 *         description: Banners activos obtenidos exitosamente
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       banner:
 *                         $ref: '#/components/schemas/Banner'
 *                       products:
 *                         type: array
 *                         items:
 *                           $ref: '#/components/schemas/Product'
 *       404:
 *         description: No hay banners activos
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               success: false
 *               message: "No hay banners activos"
 *       500:
 *         $ref: '#/components/responses/500ServerError'
 */
router.get("/active", queryController.getActive);

/**
 * @swagger
 * /api/banners/{id}:
 *   get:
 *     summary: Obtener un banner por su ID
 *     description: Retorna un banner específico sin popular sus productos (solo los IDs).
 *     tags: [Banners]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         description: ID del banner
 *         schema:
 *           type: string
 *           example: "banner_abc123"
 *     responses:
 *       200:
 *         description: Banner encontrado
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/Banner'
 *       404:
 *         $ref: '#/components/responses/404NotFound'
 *       500:
 *         $ref: '#/components/responses/500ServerError'
 */
router.get("/:id", validateParams(idParamSchema), queryController.getById);

// ==========================================
// COMMANDS (Escritura - Solo administradores)
// ==========================================

/**
 * @swagger
 * /api/banners:
 *   post:
 *     summary: Crear un nuevo banner dinámico
 *     description: |
 *       Crea un banner que puede mostrar productos según reglas dinámicas (categoría, línea, talla, productos específicos, novedades, más vendidos).
 *       `backgroundImage` y `videoUrl` son opcionales (se pueden subir después con los endpoints /imagen y /video).
 *     tags: [Banners]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateBanner'
 *           examples:
 *             porCategoria:
 *               summary: Banner con productos de una categoría
 *               value:
 *                 title: "Jerseys de hombre"
 *                 subtitle: "Los mejores precios"
 *                 buttons:
 *                   - text: "Ver colección"
 *                     url: "/tienda/jerseys"
 *                     style: "primary"
 *                 contentConfig:
 *                   type: "categoria"
 *                   categoriaId: "jersey_hombre"
 *                   limit: 8
 *                   sortBy: "precioPublico"
 *                   sortOrder: "asc"
 *                 active: true
 *                 order: 1
 *             porProductos:
 *               summary: Banner con IDs específicos
 *               value:
 *                 title: "Selección especial"
 *                 contentConfig:
 *                   type: "productos"
 *                   productIds: ["puzDAYPIOEPVYr7HLDbM", "mMER9puSog4DmqU7fhUv"]
 *                 active: true
 *             novedades:
 *               summary: Banner con novedades
 *               value:
 *                 title: "Nuevos lanzamientos"
 *                 contentConfig:
 *                   type: "novedades"
 *                   limit: 12
 *                 active: true
 *     responses:
 *       201:
 *         description: Banner creado exitosamente
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/Banner'
 *       400:
 *         $ref: '#/components/responses/400BadRequest'
 *       401:
 *         $ref: '#/components/responses/401Unauthorized'
 *       403:
 *         $ref: '#/components/responses/403Forbidden'
 *       500:
 *         $ref: '#/components/responses/500ServerError'
 */
router.post("/", authMiddleware, requireAdmin, validateBody(createBannerSchema), commandController.create);

/**
 * @swagger
 * /api/banners/{id}:
 *   put:
 *     summary: Actualizar un banner existente
 *     description: Actualiza parcial o totalmente los campos de un banner. Permite cambiar el orden, activar/desactivar, modificar productos, etc.
 *     tags: [Banners]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         description: ID del banner a actualizar
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UpdateBanner'
 *           example:
 *             title: "Nuevo título actualizado"
 *             active: false
 *             order: 3
 *     responses:
 *       200:
 *         description: Banner actualizado exitosamente
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/Banner'
 *       400:
 *         $ref: '#/components/responses/400BadRequest'
 *       401:
 *         $ref: '#/components/responses/401Unauthorized'
 *       403:
 *         $ref: '#/components/responses/403Forbidden'
 *       404:
 *         $ref: '#/components/responses/404NotFound'
 *       500:
 *         $ref: '#/components/responses/500ServerError'
 */
router.put("/:id", authMiddleware, requireAdmin, validateParams(idParamSchema), validateBody(updateBannerSchema), commandController.update);

/**
 * @swagger
 * /api/banners/{id}:
 *   delete:
 *     summary: Eliminar un banner (borrado físico)
 *     description: Elimina permanentemente el banner de Firestore. No es un soft delete, se borra el documento.
 *     tags: [Banners]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         description: ID del banner a eliminar
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Banner eliminado exitosamente
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "Banner eliminado"
 *       401:
 *         $ref: '#/components/responses/401Unauthorized'
 *       403:
 *         $ref: '#/components/responses/403Forbidden'
 *       404:
 *         $ref: '#/components/responses/404NotFound'
 *       500:
 *         $ref: '#/components/responses/500ServerError'
 */
router.delete("/:id", authMiddleware, requireAdmin, validateParams(idParamSchema), commandController.remove);



/**
 * @swagger
 * /api/banners/{id}/reactivate:
 *   patch:
 *     summary: Reactivar un banner eliminado
 *     tags: [Banners]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Banner reactivado exitosamente
 */
router.patch("/:id/reactivate", authMiddleware, requireAdmin, validateParams(idParamSchema), commandController.reactivate);

/**
 * @swagger
 * /api/banners/{id}/imagen:
 *   post:
 *     summary: Subir imagen de fondo para un banner
 *     description: Sube una imagen a Firebase Storage y actualiza el campo `backgroundImage` del banner con la URL resultante.
 *     tags: [Banners]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         description: ID del banner
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               imagen:
 *                 type: string
 *                 format: binary
 *                 description: Archivo de imagen (JPEG, PNG, WEBP o GIF, máximo 10MB)
 *     responses:
 *       200:
 *         description: Imagen subida exitosamente
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     url:
 *                       type: string
 *                       format: uri
 *                       example: "https://storage.googleapis.com/.../background_123456.jpg"
 *       400:
 *         description: No se envió imagen o formato inválido
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         $ref: '#/components/responses/401Unauthorized'
 *       403:
 *         $ref: '#/components/responses/403Forbidden'
 *       404:
 *         $ref: '#/components/responses/404NotFound'
 *       500:
 *         $ref: '#/components/responses/500ServerError'
 */
router.post(
    "/:id/imagen",
    authMiddleware,
    requireAdmin,
    validateParams(idParamSchema),
    parseMultipartImages({
        fieldName: "imagen",
        maxFiles: 1,
        maxFileSizeBytes: 10 * 1024 * 1024,
        allowedMimeTypes: ["image/jpeg", "image/png", "image/webp", "image/gif"]
    }),
    commandController.uploadBackgroundImage
);

/**
 * @swagger
 * /api/banners/{id}/video:
 *   post:
 *     summary: Subir vídeo para un banner
 *     description: |
 *       Sube un archivo de vídeo a Firebase Storage y actualiza el campo `videoUrl` del banner con la URL resultante.
 *       El vídeo puede ser usado como fondo animado o contenido multimedia en el banner.
 *     tags: [Banners]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         description: ID del banner
 *         schema:
 *           type: string
 *           example: "banner_abc123"
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               video:
 *                 type: string
 *                 format: binary
 *                 description: Archivo de vídeo (MP4, MOV, AVI, máximo 50MB)
 *     responses:
 *       200:
 *         description: Vídeo subido exitosamente
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     url:
 *                       type: string
 *                       format: uri
 *                       example: "https://storage.googleapis.com/.../banners/abc123/video_123456.mp4"
 *       400:
 *         description: No se envió vídeo o formato inválido
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         $ref: '#/components/responses/401Unauthorized'
 *       403:
 *         $ref: '#/components/responses/403Forbidden'
 *       404:
 *         $ref: '#/components/responses/404NotFound'
 *       500:
 *         $ref: '#/components/responses/500ServerError'
 */
router.post(
    "/:id/video",
    authMiddleware,
    requireAdmin,
    validateParams(idParamSchema),
    parseMultipartImages({
        fieldName: "video",
        maxFiles: 1,
        maxFileSizeBytes: 500 * 1024 * 1024, // 500 MB
        allowedMimeTypes: ["video/mp4", "video/quicktime", "video/x-msvideo", "video/webm"]
    }),
    commandController.uploadVideo
);

export default router;