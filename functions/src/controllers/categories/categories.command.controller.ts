import { Request, Response } from "express";
import categoryService from "../../services/category.service";

/**
 * Crea una nueva categoría
 * POST /api/categorias
 */
export const create = async (req: Request, res: Response) => {
  try {
    const categoriaData = req.body;

    // Validar campos requeridos
    const camposRequeridos = ["nombre"];
    const camposFaltantes = camposRequeridos.filter(
      (campo) => !categoriaData[campo],
    );

    if (camposFaltantes.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Faltan campos requeridos",
        camposFaltantes,
      });
    }

    // Validar que nombre no esté vacío
    if (categoriaData.nombre.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: "El nombre de la categoría no puede estar vacío",
      });
    }

    const nuevaCategoria = await categoryService.createCategory({
      nombre: categoriaData.nombre.trim(),
      lineaId: categoriaData.lineaId,
      orden: categoriaData.orden,
    });

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
    const { id } = req.params;
    const updateData = req.body;

    // Validar que haya al menos un campo para actualizar
    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({
        success: false,
        message: "No se proporcionaron campos para actualizar",
      });
    }

    // Validar que nombre no esté vacío si se proporciona
    if (
      updateData.nombre !== undefined &&
      updateData.nombre.trim().length === 0
    ) {
      return res.status(400).json({
        success: false,
        message: "El nombre de la categoría no puede estar vacío",
      });
    }

    // Preparar datos a actualizar
    const dataToUpdate: any = {};
    if (updateData.nombre !== undefined) {
      dataToUpdate.nombre = updateData.nombre.trim();
    }
    if (updateData.lineaId !== undefined) {
      dataToUpdate.lineaId = updateData.lineaId;
    }
    if (updateData.orden !== undefined) {
      dataToUpdate.orden = updateData.orden;
    }

    const categoriaActualizada = await categoryService.updateCategory(
      id,
      dataToUpdate,
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
