import { Request, Response } from "express";
import patrocinadorService from "../../services/patrocinador.service";

export const getAll = async (_req: Request, res: Response) => {
  try {
    const patrocinadores = await patrocinadorService.getAllPatrocinadores();

    return res.status(200).json({
      success: true,
      count: patrocinadores.length,
      data: patrocinadores.map((item) =>
        patrocinadorService.serializePatrocinadorForApi(item),
      ),
    });
  } catch (error) {
    console.error("Error en GET /api/patrocinadores:", error);
    return res.status(500).json({
      success: false,
      message: "Error al obtener los patrocinadores",
      error: error instanceof Error ? error.message : "Error desconocido",
    });
  }
};

export const getById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const patrocinador = await patrocinadorService.getPatrocinadorById(id);

    if (!patrocinador) {
      return res.status(404).json({
        success: false,
        message: `Patrocinador con ID ${id} no encontrado`,
      });
    }

    return res.status(200).json({
      success: true,
      data: patrocinadorService.serializePatrocinadorForApi(patrocinador),
    });
  } catch (error) {
    console.error("Error en GET /api/patrocinadores/:id:", error);
    return res.status(500).json({
      success: false,
      message: "Error al obtener el patrocinador",
      error: error instanceof Error ? error.message : "Error desconocido",
    });
  }
};
