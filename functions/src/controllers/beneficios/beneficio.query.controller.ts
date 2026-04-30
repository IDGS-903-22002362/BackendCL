import { Request, Response } from "express";
import beneficioService from "../../services/beneficio.service";

export const getAll = async (_req: Request, res: Response) => {
  try {
    const beneficios = await beneficioService.getAllBeneficios();

    return res.status(200).json({
      success: true,
      count: beneficios.length,
      data: beneficios,
    });
  } catch (error) {
    console.error("Error en GET /api/beneficios:", error);
    return res.status(500).json({
      success: false,
      message: "Error al obtener los beneficios",
      error: error instanceof Error ? error.message : "Error desconocido",
    });
  }
};

export const getById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const beneficio = await beneficioService.getBeneficioById(id);

    if (!beneficio) {
      return res.status(404).json({
        success: false,
        message: `Beneficio con ID ${id} no encontrado`,
      });
    }

    return res.status(200).json({
      success: true,
      data: beneficio,
    });
  } catch (error) {
    console.error("Error en GET /api/beneficios/:id:", error);
    return res.status(500).json({
      success: false,
      message: "Error al obtener el beneficio",
      error: error instanceof Error ? error.message : "Error desconocido",
    });
  }
};