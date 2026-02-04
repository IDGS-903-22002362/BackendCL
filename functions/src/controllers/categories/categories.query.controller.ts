import { Request, Response } from "express";
import categoryService from "../../services/category.service";

/**
 * Obtiene todas las categorías activas
 * GET /api/categorias
 */
export const getAll = async (_req: Request, res: Response) => {
  try {
    const categorias = await categoryService.getAllCategories();

    return res.status(200).json({
      success: true,
      count: categorias.length,
      data: categorias,
    });
  } catch (error) {
    console.error("Error en GET /api/categorias:", error);
    return res.status(500).json({
      success: false,
      message: "Error al obtener las categorías",
      error: error instanceof Error ? error.message : "Error desconocido",
    });
  }
};

/**
 * Obtiene una categoría por ID
 * GET /api/categorias/:id
 */
export const getById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const categoria = await categoryService.getCategoryById(id);

    if (!categoria) {
      return res.status(404).json({
        success: false,
        message: `Categoría con ID "${id}" no encontrada`,
      });
    }

    return res.status(200).json({
      success: true,
      data: categoria,
    });
  } catch (error) {
    console.error(`Error en GET /api/categorias/${req.params.id}:`, error);
    return res.status(500).json({
      success: false,
      message: "Error al obtener la categoría",
      error: error instanceof Error ? error.message : "Error desconocido",
    });
  }
};

/**
 * Busca categorías por término en el nombre
 * GET /api/categorias/buscar/:termino
 */
export const search = async (req: Request, res: Response) => {
  try {
    const { termino } = req.params;

    if (!termino || termino.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: "El término de búsqueda no puede estar vacío",
      });
    }

    const categorias = await categoryService.searchCategories(termino);

    return res.status(200).json({
      success: true,
      count: categorias.length,
      data: categorias,
    });
  } catch (error) {
    console.error(
      `Error en GET /api/categorias/buscar/${req.params.termino}:`,
      error,
    );
    return res.status(500).json({
      success: false,
      message: "Error al buscar categorías",
      error: error instanceof Error ? error.message : "Error desconocido",
    });
  }
};

/**
 * Obtiene categorías por línea
 * GET /api/categorias/linea/:lineaId
 */
export const getByLine = async (req: Request, res: Response) => {
  try {
    const { lineaId } = req.params;
    const categorias = await categoryService.getCategoriesByLineId(lineaId);

    return res.status(200).json({
      success: true,
      count: categorias.length,
      data: categorias,
    });
  } catch (error) {
    console.error(
      `Error en GET /api/categorias/linea/${req.params.lineaId}:`,
      error,
    );
    return res.status(500).json({
      success: false,
      message: "Error al obtener categorías por línea",
      error: error instanceof Error ? error.message : "Error desconocido",
    });
  }
};
