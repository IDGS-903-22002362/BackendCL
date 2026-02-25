import { Request, Response } from "express";
import plantillaService from "../../services/plantilla.service";

/**
 * Obtiene todas las fotos de un jugador desde Firebase Storage
 * GET /api/plantilla/:id
 */
export const getFotosPorId = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const fotosAgrupadas = await plantillaService.getFotosPorId(id);

    return res.status(200).json({
      success: true,
      data: fotosAgrupadas,
    });
  } catch (error) {
    console.error(`Error en GET /api/plantilla/${req.params.id}:`, error);
    return res.status(500).json({
      success: false,
      message: "Error al obtener las fotos de la plantilla",
      error: error instanceof Error ? error.message : "Error desconocido",
    });
  }
};
