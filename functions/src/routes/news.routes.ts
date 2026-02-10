/**
 * Rutas para el módulo de Productos
 * Define los endpoints REST para gestión de productos
 * Implementa patrón CQRS (Command Query Responsibility Segregation)
 */

import { Router } from "express";
import multer from "multer";
import * as queryController from "../controllers/noticias/news.query.controller";
import * as commandController from "../controllers/noticias/news.command.controller";
import * as debugController from "../controllers/noticias/news.debug.controller";
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
 * @swagger
 * /api/productos/debug:
 *   get:
 *     summary: Diagnóstico de Firestore
 *     description: Endpoint para verificar conexión a Firestore y mostrar información de diagnóstico. Solo para desarrollo.
 *     tags: [Debug]
 *     deprecated: true
 *     responses:
 *       200:
 *         description: Diagnóstico completado exitosamente
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
 *                   example: "Diagnóstico de Firestore completado"
 *                 diagnostico:
 *                   type: object
 *                   properties:
 *                     coleccion:
 *                       type: string
 *                       example: "productos"
 *                     totalDocumentos:
 *                       type: integer
 *                       example: 50
 *                     documentosActivos:
 *                       type: integer
 *                       example: 45
 *                     documentosInactivos:
 *                       type: integer
 *                       example: 5
 *       500:
 *         $ref: '#/components/responses/500ServerError'
 */
router.get("/debug", debugController.debugFirestore);

// ==========================================
// QUERIES (Lectura - Safe & Cacheable)
// ==========================================

/**
 * @swagger
 * /api/noticias:
 *   get:
 *     summary: Listar todas las noticias activas
 *     description: Obtiene la lista completa de noticias activas ordenados alfabéticamente por descripción
 *     tags: [News]
 *     responses:
 *       200:
 *         description: Lista de productos obtenida exitosamente
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 count:
 *                   type: integer
 *                   description: Número total de productos activos
 *                   example: 42
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Product'
 *       500:
 *         $ref: '#/components/responses/500ServerError'
 */
router.get("/", queryController.getAll);

/**
 * @swagger
 * /api/noticias/{id}:
 *   get:
 *     summary: Obtener producto por ID
 *     description: Retorna un producto específico buscado por su ID
 *     tags: [Products]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         description: ID del producto
 *         schema:
 *           type: string
 *           example: "prod_12345"
 *     responses:
 *       200:
 *         description: Producto encontrado
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/Product'
 *       404:
 *         $ref: '#/components/responses/404NotFound'
 *       500:
 *         $ref: '#/components/responses/500ServerError'
 */
router.get("/:id", validateParams(idParamSchema), queryController.getById);


/**
 * @swagger
 * /api/noticias/buscar/{termino}:
 *   get:
 *     summary: Buscar noticias por término
 *     description: Busca noticias por descripción o clave (SKU). Búsqueda case-insensitive.
 *     tags: [News]
 *     parameters:
 *       - in: path
 *         name: termino
 *         required: true
 *         description: Término de búsqueda (mínimo 1 carácter, máximo 100)
 *         schema:
 *           type: string
 *           minLength: 1
 *           maxLength: 100
 *           example: "jersey"
 *     responses:
 *       200:
 *         description: Resultados de búsqueda
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 count:
 *                   type: integer
 *                   example: 8
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Product'
 *       400:
 *         $ref: '#/components/responses/400BadRequest'
 *       500:
 *         $ref: '#/components/responses/500ServerError'
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
 * @swagger
 * /api/noticias:
 *   post:
 *     summary: Crear nuevo producto
 *     description: Crea un nuevo producto en el catálogo. Valida unicidad de clave (SKU).
 *     tags: [Products]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateProduct'
 *           example:
 *             clave: "JER-001"
 *             descripcion: "Jersey Oficial Local 2024"
 *             lineaId: "jersey"
 *             categoriaId: "jersey_hombre"
 *             precioPublico: 1299.99
 *             precioCompra: 650.00
 *             existencias: 50
 *             proveedorId: "proveedor_01"
 *             tallaIds: ["s", "m", "l", "xl"]
 *     responses:
 *       201:
 *         description: Producto creado exitosamente
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
 *                   example: "Producto creado exitosamente"
 *                 data:
 *                   $ref: '#/components/schemas/Product'
 *       400:
 *         description: Error de validación o clave duplicada
 *         content:
 *           application/json:
 *             schema:
 *               oneOf:
 *                 - $ref: '#/components/schemas/ValidationErrorResponse'
 *                 - type: object
 *                   properties:
 *                     success:
 *                       type: boolean
 *                       example: false
 *                     message:
 *                       type: string
 *                       example: 'Ya existe un producto con la clave "JER-001"'
 *       500:
 *         $ref: '#/components/responses/500ServerError'
 */
router.post("/", validateBody(createNewSchema), commandController.create);

/**
 * @swagger
 * /api/noticias/{id}:
 *   put:
 *     summary: Actualizar noticia existente
 *     description: Actualiza los campos de una noticia. Permite actualización parcial. Valida unicidad de clave si se modifica.
 *     tags: [News]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         description: ID de noticia a actualizar
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UpdateProduct'
 *           example:
 *             descripcion: "Jersey Oficial Local 2024 - Edición Especial"
 *             precioPublico: 1399.99
 *             existencias: 75
 *     responses:
 *       200:
 *         description: Noticia actualizado exitosamente
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
 *                   example: "Noticia actualizado exitosamente"
 *                 data:
 *                   $ref: '#/components/schemas/Product'
 *       400:
 *         $ref: '#/components/responses/400BadRequest'
 *       404:
 *         $ref: '#/components/responses/404NotFound'
 *       500:
 *         $ref: '#/components/responses/500ServerError'
 */
router.put(
    "/:id",
    validateParams(idParamSchema),
    validateBody(updateNewSchema),
    commandController.update,
);

/**
 * @swagger
 * /api/productos/{id}:
 *   delete:
 *     summary: Eliminar producto (soft delete)
 *     description: Marca un producto como inactivo en lugar de eliminarlo físicamente. El producto deja de aparecer en listados.
 *     tags: [Products]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         description: ID del producto a eliminar
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Producto eliminado exitosamente
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
 *                   example: "Producto eliminado exitosamente"
 *       404:
 *         $ref: '#/components/responses/404NotFound'
 *       500:
 *         $ref: '#/components/responses/500ServerError'
 */
router.delete("/:id", validateParams(idParamSchema), commandController.remove);

/**
 * @swagger
 * /api/noticias/{id}/imagenes:
 *   post:
 *     summary: Subir imágenes de noticias
 *     description: Sube hasta 5 imágenes al producto. Las imágenes se almacenan en Firebase Storage. Máximo 5MB por imagen.
 *     tags: [Products]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         description: ID del producto
 *         schema:
 *           type: string
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
 *                 description: Archivos de imagen (máximo 5, 5MB cada uno)
 *                 maxItems: 5
 *     responses:
 *       200:
 *         description: Imágenes subidas exitosamente
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
 *                   example: "3 imágenes subidas exitosamente"
 *                 data:
 *                   type: object
 *                   properties:
 *                     imagenes:
 *                       type: array
 *                       items:
 *                         type: string
 *                         format: uri
 *                       example: ["https://storage.googleapis.com/.../image1.jpg"]
 *                     totalImagenes:
 *                       type: integer
 *                       example: 3
 *       400:
 *         description: Error en la subida (archivo muy grande, formato inválido, etc.)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         $ref: '#/components/responses/404NotFound'
 *       500:
 *         $ref: '#/components/responses/500ServerError'
 */
router.post(
    "/:id/imagenes",
    validateParams(idParamSchema),
    upload.array("imagenes", 5),
    commandController.uploadImages,
);

/**
 * @swagger
 * /api/noticias/{id}/imagenes:
 *   delete:
 *     summary: Eliminar imagen de la noticia
 *     description: Elimina una imagen específica de la noticia de Firebase Storage y actualiza el registro
 *     tags: [News]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         description: ID de la noticia
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/DeleteImage'
 *           example:
 *             imageUrl: "https://storage.googleapis.com/.../noticia-12345.jpg"
 *     responses:
 *       200:
 *         description: Imagen eliminada exitosamente
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
 *                   example: "Imagen eliminada exitosamente"
 *                 data:
 *                   type: object
 *                   properties:
 *                     imagenesRestantes:
 *                       type: integer
 *                       example: 2
 *       400:
 *         description: URL de imagen inválida o imagen no encontrada en la noticia
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         $ref: '#/components/responses/404NotFound'
 *       500:
 *         $ref: '#/components/responses/500ServerError'
 */
router.delete(
    "/:id/imagenes",
    validateParams(idParamSchema),
    validateBody(deleteImageSchema),
    commandController.deleteImage,
);


router.post(
    "/:id/generar-ia",
    validateParams(idParamSchema),
    commandController.generarIA
);

export default router;
