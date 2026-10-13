import { Request, Response } from "express";
import beneficioService from "../../services/beneficio.service";
import minijuegoService from "../../services/minijuego.service";
import { viewerFromRequest } from "../../services/minijuego.logic";

function setCatalogCacheHeaders(res: Response): void {
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("Vary", "Authorization");
  if (process.env.IS_LOCAL !== "true") return;
  res.setHeader("X-Backend-Environment", "local");
  res.setHeader("X-Backend-Version", "minigames-uid-local-v1");
}

export const getAll = async (req: Request, res: Response) => {
  setCatalogCacheHeaders(res);
  try {
    const beneficios = await beneficioService.getAllBeneficios();
    const data = await minijuegoService.presentCatalog(
      beneficios,
      viewerFromRequest(req),
      (item) => beneficioService.serializeBeneficioForApi(item),
    );

    return res.status(200).json({
      success: true,
      count: data.length,
      data,
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

export const getMyReclamados = async (req: Request, res: Response) => {
  try {
    const memberId = req.user!.uid;
    const reclamados = await beneficioService.listReclamadosByMember(memberId);

    return res.status(200).json({
      success: true,
      data: {
        reclamados,
      },
    });
  } catch (error) {
    console.error("Error en GET /api/beneficios/me/reclamados:", error);
    return res.status(500).json({
      success: false,
      message: "Error al obtener beneficios reclamados",
      error: error instanceof Error ? error.message : "Error desconocido",
    });
  }
};

export const getById = async (req: Request, res: Response) => {
  setCatalogCacheHeaders(res);
  try {
    const { id } = req.params;
    const beneficio = await beneficioService.getBeneficioById(id);

    if (!beneficio) {
      return res.status(404).json({
        success: false,
        message: `Beneficio con ID ${id} no encontrado`,
      });
    }

    const data = await minijuegoService.presentOne(
      beneficio,
      viewerFromRequest(req),
      (item) => beneficioService.serializeBeneficioForApi(item),
    );

    if (!data) {
      return res.status(404).json({
        success: false,
        message: `Beneficio con ID ${id} no encontrado`,
      });
    }

    return res.status(200).json({
      success: true,
      data,
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
