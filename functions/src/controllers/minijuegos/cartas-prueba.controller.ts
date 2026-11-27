import { NextFunction, Request, Response } from "express";
import cartasPruebaService, {
  testPrizeCardsEnabled,
} from "../../services/cartas-prueba.service";

/**
 * Va antes de authMiddleware. Con las cartas de prueba apagadas, la ruta se
 * salta sin pedir token ni leer usuariosApp, y la petición acaba en el 404
 * global, igual que una ruta que no existe.
 */
export const soloConCartasDePrueba = (
  _req: Request,
  _res: Response,
  next: NextFunction,
) => (testPrizeCardsEnabled() ? next() : next("route"));

/**
 * GET /api/minijuegos/me/cartas-prueba
 *
 * Cartas de prueba de la cuenta del token, y de nadie más.
 */
export const getMisCartasPrueba = async (req: Request, res: Response) => {
  // Segunda barrera por si el controlador se monta sin soloConCartasDePrueba.
  if (!testPrizeCardsEnabled()) {
    return res.status(404).json({
      success: false,
      message: "Ruta no encontrada",
    });
  }

  try {
    const data = await cartasPruebaService.listCartasPrueba(req.user!.uid);
    return res.status(200).json({ success: true, count: data.length, data });
  } catch (error) {
    console.error("Error en GET /api/minijuegos/me/cartas-prueba:", error);
    return res.status(500).json({
      success: false,
      message: "No se pudieron cargar las cartas de prueba",
    });
  }
};
