import { Request, Response } from "express";
import providerService from "../../services/provider.service";

/**
 * GET /api/proveedores
 * Obtiene todos los proveedores activos
 */
export const getAll = async (_req: Request, res: Response) => {
  try {
    const proveedores = await providerService.getAllProviders();

    return res.status(200).json({
      success: true,
      count: proveedores.length,
      data: proveedores,
    });
  } catch (error) {
    console.error("Error en GET /api/proveedores:", error);
    return res.status(500).json({
      success: false,
      message: "Error al obtener los proveedores",
      error: error instanceof Error ? error.message : "Error desconocido",
    });
  }
};

/**
 * GET /api/proveedores/:id
 * Obtiene un proveedor específico por ID
 */
export const getById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({
        success: false,
        message: "El ID del proveedor es requerido",
      });
    }

    const proveedor = await providerService.getProviderById(id);

    if (!proveedor) {
      return res.status(404).json({
        success: false,
        message: `Proveedor con ID "${id}" no encontrado`,
      });
    }

    return res.status(200).json({
      success: true,
      data: proveedor,
    });
  } catch (error) {
    console.error(`Error en GET /api/proveedores/${req.params.id}:`, error);
    return res.status(500).json({
      success: false,
      message: "Error al obtener el proveedor",
      error: error instanceof Error ? error.message : "Error desconocido",
    });
  }
};

/**
 * GET /api/proveedores/buscar/:termino
 * Busca proveedores por término en el campo nombre
 */
export const search = async (req: Request, res: Response) => {
  try {
    const { termino } = req.params;

    if (!termino || termino.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: "El término de búsqueda es requerido",
      });
    }

    const proveedores = await providerService.searchProviders(termino);

    return res.status(200).json({
      success: true,
      count: proveedores.length,
      data: proveedores,
    });
  } catch (error) {
    console.error(
      `Error en GET /api/proveedores/buscar/${req.params.termino}:`,
      error,
    );
    return res.status(500).json({
      success: false,
      message: "Error al buscar proveedores",
      error: error instanceof Error ? error.message : "Error desconocido",
    });
  }
};
