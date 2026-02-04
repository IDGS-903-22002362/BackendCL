import { Request, Response } from "express";
import categoryService from "../../services/category.service";

/**
 * Crea una nueva categoría
 * POST /api/categorias
 */
export const create = async (req: Request, res: Response) => {
  try {
    // Body ya validado por middleware de Zod
    const categoriaData = req.body;

    const nuevaCategoria = await categoryService.createCategory(categoriaData);

    return res.status(201).json({
      success: true,
      message: "Categoría creada exitosamente",
      data: nuevaCategoria,
    });
  } catch (error) {
    console.error("Error en POST /api/categorias:", error);

    // Errores de validación de unicidad
    if (
      error instanceof Error &&
      error.message.includes("Ya existe una categoría")
    ) {
      return res.status(400).json({
        success: false,
        message: error.message,
      });
    }

    return res.status(500).json({
      success: false,
      message: "Error al crear la categoría",
      error: error instanceof Error ? error.message : "Error desconocido",
    });
  }
};

/**
 * Actualiza una categoría existente
 * PUT /api/categorias/:id
 */
export const update = async (req: Request, res: Response) => {
  try {
    // Params e ID ya validados por middleware de Zod
    const { id } = req.params;
    const updateData = req.body;

    const categoriaActualizada = await categoryService.updateCategory(
      id,
      updateData,
    );

    return res.status(200).json({
      success: true,
      message: "Categoría actualizada exitosamente",
      data: categoriaActualizada,
    });
  } catch (error) {
    console.error(`Error en PUT /api/categorias/${req.params.id}:`, error);

    // Errores de validación
    if (
      error instanceof Error &&
      (error.message.includes("no encontrada") ||
        error.message.includes("Ya existe otra categoría"))
    ) {
      return res
        .status(error.message.includes("no encontrada") ? 404 : 400)
        .json({
          success: false,
          message: error.message,
        });
    }

    return res.status(500).json({
      success: false,
      message: "Error al actualizar la categoría",
      error: error instanceof Error ? error.message : "Error desconocido",
    });
  }
};

/**
 * Elimina una categoría (soft delete)
 * DELETE /api/categorias/:id
 */
export const remove = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    await categoryService.deleteCategory(id);

    return res.status(200).json({
      success: true,
      message: "Categoría eliminada exitosamente",
    });
  } catch (error) {
    console.error(`Error en DELETE /api/categorias/${req.params.id}:`, error);

    // Errores de validación
    if (error instanceof Error && error.message.includes("no encontrada")) {
      return res.status(404).json({
        success: false,
        message: error.message,
      });
    }

    return res.status(500).json({
      success: false,
      message: "Error al eliminar la categoría",
      error: error instanceof Error ? error.message : "Error desconocido",
    });
  }
};
