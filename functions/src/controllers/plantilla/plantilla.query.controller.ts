import { Request, Response } from "express";
import plantillaService from "../../services/plantilla.service";

/**
 * Obtiene todas las fotos de un jugador desde Firebase Storage
 * GET /api/plantilla/:jugador
 */
export const getFotosPorJugador = async (req: Request, res: Response) => {
  try {
    const { jugador } = req.params;
    const fotosAgrupadas = await plantillaService.getFotosPorJugador(jugador);

    return res.status(200).json({
      success: true,
      data: fotosAgrupadas,
    });
  } catch (error) {
    console.error(`Error en GET /api/plantilla/${req.params.jugador}:`, error);
    return res.status(500).json({
      success: false,
      message: "Error al obtener las fotos de la plantilla",
      error: error instanceof Error ? error.message : "Error desconocido",
    });
  }
};
