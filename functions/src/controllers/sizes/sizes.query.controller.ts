/**
 * Controlador de Queries para Tallas
 * Maneja operaciones de lectura (GET)
 */

import { Request, Response } from "express";
import {
  getAllSizes,
  getSizeById,
  getSizeInventory,
} from "../../services/size.service";

/**
 * GET /api/tallas
 * Obtener todas las tallas
 */
export async function getAll(req: Request, res: Response): Promise<void> {
  try {
    const sizes = await getAllSizes();

    res.status(200).json({
      success: true,
      count: sizes.length,
      data: sizes,
    });
  } catch (error) {
    console.error("Error en getAll sizes:", error);
    res.status(500).json({
      success: false,
      message:
        error instanceof Error ? error.message : "Error al obtener tallas",
    });
  }
}

/**
 * GET /api/tallas/:id
 * Obtener talla por ID
 */
export async function getById(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params;

    const size = await getSizeById(id);

    if (!size) {
      res.status(404).json({
        success: false,
        message: `Talla con ID "${id}" no encontrada`,
      });
      return;
    }

    res.status(200).json({
      success: true,
      data: size,
    });
  } catch (error) {
    console.error("Error en getById size:", error);
    res.status(500).json({
      success: false,
      message:
        error instanceof Error ? error.message : "Error al obtener talla",
    });
  }
}

/**
 * GET /api/tallas/:id/inventario
 * Obtener inventario de productos para una talla específica
 */
export async function getInventory(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const result = await getSizeInventory(id);

    res.status(200).json({
      success: true,
      count: result.productos.length,
      data: result,
    });
  } catch (error) {
    console.error("Error en getInventory size:", error);

    if (error instanceof Error && error.message.includes("no encontrada")) {
      res.status(404).json({
        success: false,
        message: error.message,
      });
      return;
    }

    res.status(500).json({
      success: false,
      message:
        error instanceof Error
          ? error.message
          : "Error al obtener inventario por talla",
    });
  }
}
