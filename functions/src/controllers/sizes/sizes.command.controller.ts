/**
 * Controlador de Commands para Tallas
 * Maneja operaciones de escritura (POST, PUT, DELETE)
 */

import { Request, Response } from "express";
import {
  createSize,
  updateSize,
  deleteSize,
} from "../../services/size.service";
import { CrearTallaDTO } from "../../models/catalogo.model";

/**
 * POST /api/tallas
 * Crear nueva talla
 */
export async function create(req: Request, res: Response): Promise<void> {
  try {
    const data: CrearTallaDTO = req.body;

    // Validar que se envíen los campos requeridos
    if (!data.codigo || !data.descripcion) {
      const camposFaltantes = [];
      if (!data.codigo) camposFaltantes.push("codigo");
      if (!data.descripcion) camposFaltantes.push("descripcion");

      res.status(400).json({
        success: false,
        message: "Faltan campos requeridos",
        camposFaltantes,
      });
      return;
    }

    const result = await createSize(data);

    res.status(201).json({
      success: true,
      message: "Talla creada exitosamente",
      data: result.talla,
    });
  } catch (error) {
    console.error("Error en create size:", error);

    if (error instanceof Error) {
      // Errores de validación o duplicados
      if (
        error.message.includes("Ya existe") ||
        error.message.includes("requeridos") ||
        error.message.includes("vacío")
      ) {
        res.status(400).json({
          success: false,
          message: error.message,
        });
        return;
      }
    }

    res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : "Error al crear talla",
    });
  }
}

/**
 * PUT /api/tallas/:id
 * Actualizar talla existente
 */
export async function update(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const data: Partial<CrearTallaDTO> = req.body;

    const updatedSize = await updateSize(id, data);

    res.status(200).json({
      success: true,
      message: "Talla actualizada exitosamente",
      data: updatedSize,
    });
  } catch (error) {
    console.error("Error en update size:", error);

    if (error instanceof Error) {
      // Error 404 si no existe
      if (error.message.includes("no encontrada")) {
        res.status(404).json({
          success: false,
          message: error.message,
        });
        return;
      }

      // Errores de validación
      if (
        error.message.includes("Ya existe") ||
        error.message.includes("vacío")
      ) {
        res.status(400).json({
          success: false,
          message: error.message,
        });
        return;
      }
    }

    res.status(500).json({
      success: false,
      message:
        error instanceof Error ? error.message : "Error al actualizar talla",
    });
  }
}

/**
 * DELETE /api/tallas/:id
 * Eliminar talla (eliminación física)
 */
export async function remove(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params;

    await deleteSize(id);

    res.status(200).json({
      success: true,
      message: "Talla eliminada exitosamente",
    });
  } catch (error) {
    console.error("Error en remove size:", error);

    if (error instanceof Error) {
      // Error 404 si no existe
      if (error.message.includes("no encontrada")) {
        res.status(404).json({
          success: false,
          message: error.message,
        });
        return;
      }
    }

    res.status(500).json({
      success: false,
      message:
        error instanceof Error ? error.message : "Error al eliminar talla",
    });
  }
}
