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
  updateProductStockSchema,
} from "../middleware/validators/product.validator";
import {
  idParamSchema,
  searchTermSchema,
  categoriaIdParamSchema,
  lineaIdParamSchema,
} from "../middleware/validators/common.validator";
import { authMiddleware, requireAdmin } from "../utils/middlewares";

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
 * /api/productos:
 *   get:
 *     summary: Listar todos los productos activos
 *     description: Obtiene la lista completa de productos activos ordenados alfabéticamente por descripción
 *     tags: [Products]
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
 * /api/productos/{id}/stock:
 *   get:
 *     summary: Consultar stock por talla de un producto
 *     description: Retorna el inventario por talla y el stock total derivado del producto
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
 *         description: Stock por talla obtenido exitosamente
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/ProductStockBySize'
 *       404:
 *         $ref: '#/components/responses/404NotFound'
 *       500:
 *         $ref: '#/components/responses/500ServerError'
 */
router.get(
  "/:id/stock",
  validateParams(idParamSchema),
  queryController.getStockBySize,
);

/**
 * @swagger
 * /api/productos/{id}:
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
 * /api/productos/categoria/{categoriaId}:
 *   get:
 *     summary: Obtener productos por categoría
 *     description: Filtra y retorna productos que pertenecen a una categoría específica
 *     tags: [Products]
 *     parameters:
 *       - in: path
 *         name: categoriaId
 *         required: true
 *         description: ID de la categoría
 *         schema:
 *           type: string
 *           example: "jersey_hombre"
 *     responses:
 *       200:
 *         description: Lista de productos de la categoría
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
 *                   example: 15
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Product'
 *       500:
 *         $ref: '#/components/responses/500ServerError'
 */
router.get(
  "/categoria/:categoriaId",
  validateParams(categoriaIdParamSchema),
  queryController.getByCategory,
);

/**
 * @swagger
 * /api/productos/linea/{lineaId}:
 *   get:
 *     summary: Obtener productos por línea
 *     description: Filtra y retorna productos que pertenecen a una línea específica
 *     tags: [Products]
 *     parameters:
 *       - in: path
 *         name: lineaId
 *         required: true
 *         description: ID de la línea de producto
 *         schema:
 *           type: string
 *           example: "jersey"
 *     responses:
 *       200:
 *         description: Lista de productos de la línea
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
 *                   example: 20
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Product'
 *       500:
 *         $ref: '#/components/responses/500ServerError'
 */
router.get(
  "/linea/:lineaId",
  validateParams(lineaIdParamSchema),
  queryController.getByLine,
);

/**
 * @swagger
 * /api/productos/buscar/{termino}:
 *   get:
 *     summary: Buscar productos por término
 *     description: Busca productos por descripción o clave (SKU). Búsqueda case-insensitive.
 *     tags: [Products]
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
 * /api/productos:
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
 *             inventarioPorTalla:
 *               - tallaId: "s"
 *                 cantidad: 12
 *               - tallaId: "m"
 *                 cantidad: 20
 *               - tallaId: "l"
 *                 cantidad: 18
 *             stockMinimoGlobal: 10
 *             stockMinimoPorTalla:
 *               - tallaId: "s"
 *                 minimo: 4
 *               - tallaId: "m"
 *                 minimo: 8
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
router.post("/", validateBody(createProductSchema), commandController.create);

/**
 * @swagger
 * /api/productos/{id}:
 *   put:
 *     summary: Actualizar producto existente
 *     description: Actualiza los campos de un producto. Permite actualización parcial. Valida unicidad de clave si se modifica.
 *     tags: [Products]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         description: ID del producto a actualizar
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
 *         description: Producto actualizado exitosamente
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
 *                   example: "Producto actualizado exitosamente"
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
  validateBody(updateProductSchema),
  commandController.update,
);

/**
 * @swagger
 * /api/productos/{id}/stock:
 *   put:
 *     summary: Actualizar stock de producto
 *     description: |
 *       Actualiza stock general o stock por talla de un producto y registra movimiento de inventario.
 *
 *       **Reglas:**
 *       - Si el producto usa inventario por talla, `tallaId` es requerido.
 *       - Si no usa inventario por talla, se actualiza stock general (`existencias`).
 *       - La cantidad no puede ser negativa.
 *       - Solo administradores/empleados pueden ejecutar esta operación.
 *     tags: [Products]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         description: ID del producto
 *         schema:
 *           type: string
 *           example: "prod_12345"
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UpdateProductStock'
 *           example:
 *             cantidadNueva: 15
 *             tallaId: "m"
 *             tipo: "ajuste"
 *             motivo: "Conteo físico"
 *             referencia: "INV-2026-001"
 *     responses:
 *       200:
 *         description: Stock actualizado exitosamente
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
 *                   example: "Stock actualizado exitosamente"
 *                 data:
 *                   $ref: '#/components/schemas/ProductStockUpdateResult'
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
router.put(
  "/:id/stock",
  authMiddleware,
  requireAdmin,
  validateParams(idParamSchema),
  validateBody(updateProductStockSchema),
  commandController.updateStock,
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
 * /api/productos/{id}/imagenes:
 *   post:
 *     summary: Subir imágenes del producto
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
 * /api/productos/{id}/imagenes:
 *   delete:
 *     summary: Eliminar imagen del producto
 *     description: Elimina una imagen específica del producto de Firebase Storage y actualiza el registro
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
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/DeleteImage'
 *           example:
 *             imageUrl: "https://storage.googleapis.com/.../producto-12345.jpg"
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
 *         description: URL de imagen inválida o imagen no encontrada en el producto
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

export default router;
