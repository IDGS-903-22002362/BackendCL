/**
 * Rutas para el módulo de Productos
 * Define los endpoints REST para gestión de productos
 */

import { Router, Request, Response } from "express";
import multer from "multer";
import productService from "../services/product.service";
import storageService from "../services/storage.service";

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

/**
 * GET /api/productos
 * Obtiene todos los productos activos
 *
 * @returns {200} Array de productos
 * @returns {500} Error del servidor
 */
router.get("/", async (_req: Request, res: Response) => {
  try {
    // Llamar al servicio para obtener productos
    const productos = await productService.getAllProducts();

    // Responder con los productos
    res.status(200).json({
      success: true,
      count: productos.length,
      data: productos,
    });
  } catch (error) {
    console.error("Error en GET /api/productos:", error);

    // Responder con error 500
    res.status(500).json({
      success: false,
      message: "Error al obtener los productos",
      error: error instanceof Error ? error.message : "Error desconocido",
    });
  }
});

/**
 * GET /api/productos/:id
 * Obtiene un producto específico por ID
 *
 * @param {string} id - ID del producto
 * @returns {200} Producto encontrado
 * @returns {404} Producto no encontrado
 * @returns {500} Error del servidor
 */
router.get("/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // Obtener producto por ID
    const producto = await productService.getProductById(id);

    // Si no existe, retornar 404
    if (!producto) {
      return res.status(404).json({
        success: false,
        message: `Producto con ID ${id} no encontrado`,
      });
    }

    // Responder con el producto
    return res.status(200).json({
      success: true,
      data: producto,
    });
  } catch (error) {
    console.error("Error en GET /api/productos/:id:", error);

    return res.status(500).json({
      success: false,
      message: "Error al obtener el producto",
      error: error instanceof Error ? error.message : "Error desconocido",
    });
  }
});

/**
 * GET /api/productos/categoria/:categoriaId
 * Obtiene productos por categoría
 *
 * @param {string} categoriaId - ID de la categoría
 * @returns {200} Array de productos de la categoría
 * @returns {500} Error del servidor
 */
router.get("/categoria/:categoriaId", async (req: Request, res: Response) => {
  try {
    const { categoriaId } = req.params;

    const productos = await productService.getProductsByCategory(categoriaId);

    res.status(200).json({
      success: true,
      count: productos.length,
      data: productos,
    });
  } catch (error) {
    console.error("Error en GET /api/productos/categoria/:categoriaId:", error);

    res.status(500).json({
      success: false,
      message: "Error al obtener productos por categoría",
      error: error instanceof Error ? error.message : "Error desconocido",
    });
  }
});

/**
 * GET /api/productos/linea/:lineaId
 * Obtiene productos por línea
 *
 * @param {string} lineaId - ID de la línea
 * @returns {200} Array de productos de la línea
 * @returns {500} Error del servidor
 */
router.get("/linea/:lineaId", async (req: Request, res: Response) => {
  try {
    const { lineaId } = req.params;

    const productos = await productService.getProductsByLine(lineaId);

    res.status(200).json({
      success: true,
      count: productos.length,
      data: productos,
    });
  } catch (error) {
    console.error("Error en GET /api/productos/linea/:lineaId:", error);

    res.status(500).json({
      success: false,
      message: "Error al obtener productos por línea",
      error: error instanceof Error ? error.message : "Error desconocido",
    });
  }
});

/**
 * GET /api/productos/buscar/:termino
 * Busca productos por término (descripción o clave)
 *
 * @param {string} termino - Término de búsqueda
 * @returns {200} Array de productos que coinciden
 * @returns {500} Error del servidor
 */
router.get("/buscar/:termino", async (req: Request, res: Response) => {
  try {
    const { termino } = req.params;

    const productos = await productService.searchProducts(termino);

    res.status(200).json({
      success: true,
      count: productos.length,
      data: productos,
    });
  } catch (error) {
    console.error("Error en GET /api/productos/buscar/:termino:", error);

    res.status(500).json({
      success: false,
      message: "Error al buscar productos",
      error: error instanceof Error ? error.message : "Error desconocido",
    });
  }
});

/**
 * POST /api/productos
 * Crea un nuevo producto
 *
 * @body Datos del producto a crear
 * @returns {201} Producto creado
 * @returns {400} Datos inválidos
 * @returns {500} Error del servidor
 */
router.post("/", async (req: Request, res: Response) => {
  try {
    const productoData = req.body;

    // Validación básica de campos requeridos
    const camposRequeridos = [
      "clave",
      "descripcion",
      "lineaId",
      "categoriaId",
      "precioPublico",
      "precioCompra",
      "existencias",
      "proveedorId",
    ];

    const camposFaltantes = camposRequeridos.filter(
      (campo) => !productoData[campo] && productoData[campo] !== 0
    );

    if (camposFaltantes.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Faltan campos requeridos",
        camposFaltantes,
      });
    }

    // Valores por defecto
    productoData.tallaIds = productoData.tallaIds || [];
    productoData.imagenes = productoData.imagenes || [];
    productoData.activo =
      productoData.activo !== undefined ? productoData.activo : true;

    const nuevoProducto = await productService.createProduct(productoData);

    return res.status(201).json({
      success: true,
      message: "Producto creado exitosamente",
      data: nuevoProducto,
    });
  } catch (error) {
    console.error("Error en POST /api/productos:", error);

    return res.status(500).json({
      success: false,
      message: "Error al crear el producto",
      error: error instanceof Error ? error.message : "Error desconocido",
    });
  }
});

/**
 * PUT /api/productos/:id
 * Actualiza un producto existente
 *
 * @param {string} id - ID del producto
 * @body Datos del producto a actualizar
 * @returns {200} Producto actualizado
 * @returns {404} Producto no encontrado
 * @returns {500} Error del servidor
 */
router.put("/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const updateData = req.body;

    const productoActualizado = await productService.updateProduct(
      id,
      updateData
    );

    return res.status(200).json({
      success: true,
      message: "Producto actualizado exitosamente",
      data: productoActualizado,
    });
  } catch (error) {
    console.error("Error en PUT /api/productos/:id:", error);

    const statusCode =
      error instanceof Error && error.message.includes("no encontrado")
        ? 404
        : 500;

    return res.status(statusCode).json({
      success: false,
      message: "Error al actualizar el producto",
      error: error instanceof Error ? error.message : "Error desconocido",
    });
  }
});

/**
 * DELETE /api/productos/:id
 * Elimina un producto (soft delete)
 *
 * @param {string} id - ID del producto
 * @returns {200} Producto eliminado
 * @returns {404} Producto no encontrado
 * @returns {500} Error del servidor
 */
router.delete("/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    await productService.deleteProduct(id);

    return res.status(200).json({
      success: true,
      message: "Producto eliminado exitosamente",
    });
  } catch (error) {
    console.error("Error en DELETE /api/productos/:id:", error);

    const statusCode =
      error instanceof Error && error.message.includes("no encontrado")
        ? 404
        : 500;

    return res.status(statusCode).json({
      success: false,
      message: "Error al eliminar el producto",
      error: error instanceof Error ? error.message : "Error desconocido",
    });
  }
});

/**
 * POST /api/productos/:id/imagenes
 * Sube una o varias imágenes para un producto
 *
 * @param {string} id - ID del producto
 * @body {file[]} imagenes - Archivos de imagen (multipart/form-data)
 * @returns {200} URLs de las imágenes subidas
 * @returns {400} No se enviaron archivos
 * @returns {404} Producto no encontrado
 * @returns {500} Error del servidor
 */
router.post(
  "/:id/imagenes",
  upload.array("imagenes", 5), // Máximo 5 imágenes
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const files = req.files as Express.Multer.File[];

      // Verificar que se enviaron archivos
      if (!files || files.length === 0) {
        return res.status(400).json({
          success: false,
          message: "No se enviaron archivos",
        });
      }

      // Verificar que el producto existe
      const producto = await productService.getProductById(id);
      if (!producto) {
        return res.status(404).json({
          success: false,
          message: `Producto con ID ${id} no encontrado`,
        });
      }

      // Subir las imágenes a Storage
      const imagenesData = files.map((file) => ({
        buffer: file.buffer,
        originalName: file.originalname,
      }));

      const urls = await storageService.uploadMultipleFiles(
        imagenesData,
        "productos"
      );

      // Actualizar el producto con las nuevas URLs
      const imagenesActuales = producto.imagenes || [];
      const imagenesActualizadas = [...imagenesActuales, ...urls];

      await productService.updateProduct(id, {
        imagenes: imagenesActualizadas,
      });

      return res.status(200).json({
        success: true,
        message: `${urls.length} imagen(es) subida(s) exitosamente`,
        data: {
          urls: urls,
          totalImagenes: imagenesActualizadas.length,
        },
      });
    } catch (error) {
      console.error("Error en POST /api/productos/:id/imagenes:", error);

      return res.status(500).json({
        success: false,
        message: "Error al subir las imágenes",
        error: error instanceof Error ? error.message : "Error desconocido",
      });
    }
  }
);

/**
 * DELETE /api/productos/:id/imagenes
 * Elimina una imagen específica de un producto
 *
 * @param {string} id - ID del producto
 * @body {string} imageUrl - URL de la imagen a eliminar
 * @returns {200} Imagen eliminada
 * @returns {400} URL no proporcionada
 * @returns {404} Producto no encontrado o imagen no existe
 * @returns {500} Error del servidor
 */
router.delete("/:id/imagenes", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { imageUrl } = req.body;

    // Validar que se envió la URL
    if (!imageUrl) {
      return res.status(400).json({
        success: false,
        message: "Se requiere la URL de la imagen a eliminar",
      });
    }

    // Verificar que el producto existe
    const producto = await productService.getProductById(id);
    if (!producto) {
      return res.status(404).json({
        success: false,
        message: `Producto con ID ${id} no encontrado`,
      });
    }

    // Verificar que la imagen existe en el producto
    const imagenes = producto.imagenes || [];
    if (!imagenes.includes(imageUrl)) {
      return res.status(404).json({
        success: false,
        message: "La imagen no existe en este producto",
      });
    }

    // Eliminar la imagen de Storage
    await storageService.deleteFile(imageUrl);

    // Actualizar el producto eliminando la URL
    const imagenesActualizadas = imagenes.filter((url) => url !== imageUrl);
    await productService.updateProduct(id, {
      imagenes: imagenesActualizadas,
    });

    return res.status(200).json({
      success: true,
      message: "Imagen eliminada exitosamente",
      data: {
        imagenesRestantes: imagenesActualizadas.length,
      },
    });
  } catch (error) {
    console.error("Error en DELETE /api/productos/:id/imagenes:", error);

    return res.status(500).json({
      success: false,
      message: "Error al eliminar la imagen",
      error: error instanceof Error ? error.message : "Error desconocido",
    });
  }
});

export default router;
