import { Request, Response } from "express";
import productService from "../../services/product.service";
import storageService from "../../services/storage.service";

/**
 * Controller: Products Command (Escritura)
 * Responsabilidad: Manejar operaciones de mutación de datos (POST, PUT, DELETE)
 */

export const create = async (req: Request, res: Response) => {
  try {
    // Body ya validado por middleware de Zod
    const productoData = req.body;

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
};

export const update = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const updateData = req.body;
    const productoActualizado = await productService.updateProduct(
      id,
      updateData,
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
};

export const remove = async (req: Request, res: Response) => {
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
};

export const uploadImages = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const files = req.files as Express.Multer.File[];

    if (!files || files.length === 0) {
      return res
        .status(400)
        .json({ success: false, message: "No se enviaron archivos" });
    }

    const producto = await productService.getProductById(id);
    if (!producto) {
      return res.status(404).json({
        success: false,
        message: `Producto con ID ${id} no encontrado`,
      });
    }

    const imagenesData = files.map((file) => ({
      buffer: file.buffer,
      originalName: file.originalname,
    }));

    const urls = await storageService.uploadMultipleFiles(
      imagenesData,
      "productos",
    );
    const imagenesActuales = producto.imagenes || [];
    const imagenesActualizadas = [...imagenesActuales, ...urls];

    await productService.updateProduct(id, { imagenes: imagenesActualizadas });

    return res.status(200).json({
      success: true,
      message: `${urls.length} imagen(es) subida(s) exitosamente`,
      data: { urls, totalImagenes: imagenesActualizadas.length },
    });
  } catch (error) {
    console.error("Error en POST /api/productos/:id/imagenes:", error);
    return res.status(500).json({
      success: false,
      message: "Error al subir las imágenes",
      error: error instanceof Error ? error.message : "Error desconocido",
    });
  }
};

export const deleteImage = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { imageUrl } = req.body;

    if (!imageUrl) {
      return res.status(400).json({
        success: false,
        message: "Se requiere la URL de la imagen a eliminar",
      });
    }

    const producto = await productService.getProductById(id);
    if (!producto) {
      return res.status(404).json({
        success: false,
        message: `Producto con ID ${id} no encontrado`,
      });
    }

    const imagenes = producto.imagenes || [];
    if (!imagenes.includes(imageUrl)) {
      return res.status(404).json({
        success: false,
        message: "La imagen no existe en este producto",
      });
    }

    await storageService.deleteFile(imageUrl);
    const imagenesActualizadas = imagenes.filter((url) => url !== imageUrl);
    await productService.updateProduct(id, { imagenes: imagenesActualizadas });

    return res.status(200).json({
      success: true,
      message: "Imagen eliminada exitosamente",
      data: { imagenesRestantes: imagenesActualizadas.length },
    });
  } catch (error) {
    console.error("Error en DELETE /api/productos/:id/imagenes:", error);
    return res.status(500).json({
      success: false,
      message: "Error al eliminar la imagen",
      error: error instanceof Error ? error.message : "Error desconocido",
    });
  }
};

export const updateStock = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { cantidadNueva, tallaId, tipo, motivo, referencia } = req.body;

    const result = await productService.updateStock(id, {
      cantidadNueva,
      tallaId,
      tipo,
      motivo,
      referencia,
      usuarioId: req.user?.uid,
    });

    return res.status(200).json({
      success: true,
      message: "Stock actualizado exitosamente",
      data: result,
    });
  } catch (error) {
    console.error("Error en PUT /api/productos/:id/stock:", error);

    let statusCode = 500;

    if (error instanceof Error) {
      const msg = error.message.toLowerCase();

      if (msg.includes("no encontrado")) {
        statusCode = 404;
      } else if (
        msg.includes("no puede ser negativa") ||
        msg.includes("se requiere tallaid") ||
        msg.includes("no maneja inventario por talla") ||
        msg.includes("no pertenece al producto")
      ) {
        statusCode = 400;
      }
    }

    return res.status(statusCode).json({
      success: false,
      message:
        statusCode === 400
          ? error instanceof Error
            ? error.message
            : "Error de validación"
          : statusCode === 404
            ? "Producto no encontrado"
            : "Error al actualizar stock del producto",
      error:
        statusCode === 500 && error instanceof Error
          ? error.message
          : undefined,
    });
  }
};
