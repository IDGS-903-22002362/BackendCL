import { Request, Response } from "express";
import productService from "../../services/product.service";

/**
 * Controller: Products Query (Lectura)
 * Responsabilidad: Manejar operaciones de lectura de datos (GET)
 */
export const getAll = async (_req: Request, res: Response) => {
  try {
    const productos = await productService.getAllProducts();
    res.status(200).json({
      success: true,
      count: productos.length,
      data: productos,
    });
  } catch (error) {
    console.error("Error en GET /api/productos:", error);
    res.status(500).json({
      success: false,
      message: "Error al obtener los productos",
      error: error instanceof Error ? error.message : "Error desconocido",
    });
  }
};

export const getById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const producto = await productService.getProductById(id);

    if (!producto) {
      return res.status(404).json({
        success: false,
        message: `Producto con ID ${id} no encontrado`,
      });
    }

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
};

export const getByCategory = async (req: Request, res: Response) => {
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
};

export const getByLine = async (req: Request, res: Response) => {
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
};

export const search = async (req: Request, res: Response) => {
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
};
