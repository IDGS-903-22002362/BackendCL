import { Request, Response } from "express";
import lineService from "../../services/line.service";

/**
 * Controller: Products Command (Escritura)
 * Responsabilidad: Manejar operaciones de mutación de datos (POST, PUT, DELETE)
 */

export const create = async (req: Request, res: Response) => {
  try {
    // Body ya validado por middleware de Zod
    const lineaData = req.body;

    const nuevaLinea = await lineService.createLine(lineaData);

    return res.status(201).json({
      success: true,
      message: "Linea creado exitosamente",
      data: nuevaLinea,
    });
  } catch (error) {
    console.error("Error en POST /api/lineas:", error);
    return res.status(500).json({
      success: false,
      message: "Error al crear la linea",
      error: error instanceof Error ? error.message : "Error desconocido",
    });
  }
};

export const update = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const updateData = req.body;
    const lineaActualizada = await lineService.updateLine(id, updateData);

    return res.status(200).json({
      success: true,
      message: "linea actualizada exitosamente",
      data: lineaActualizada,
    });
  } catch (error) {
    console.error("Error en PUT /api/lines/:id:", error);
    const statusCode =
      error instanceof Error && error.message.includes("no encontrado")
        ? 404
        : 500;
    return res.status(statusCode).json({
      success: false,
      message: "Error al actualizar la linea",
      error: error instanceof Error ? error.message : "Error desconocido",
    });
  }
};

export const remove = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await lineService.deleteLine(id);
    return res.status(200).json({
      success: true,
      message: "Line eliminado exitosamente",
    });
  } catch (error) {
    console.error("Error en DELETE /api/lineas/:id:", error);
    const statusCode =
      error instanceof Error && error.message.includes("no encontrado")
        ? 404
        : 500;
    return res.status(statusCode).json({
      success: false,
      message: "Error al eliminar la linea",
      error: error instanceof Error ? error.message : "Error desconocido",
    });
  }
};
