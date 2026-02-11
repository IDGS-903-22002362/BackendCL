import { Request, Response } from "express";
import pagoService from "../../services/pago.service";
import { ApiError } from "../../utils/error-handler";

export const getById = async (req: Request, res: Response) => {
  try {
    if (!req.user?.uid) {
      return res.status(401).json({
        success: false,
        message: "No autorizado. Se requiere autenticación.",
      });
    }

    const result = await pagoService.getPagoById(req.params.id, {
      uid: req.user.uid,
      rol: req.user.rol as string | undefined,
    });

    return res.status(200).json({
      success: true,
      message: "Pago obtenido exitosamente",
      data: result,
    });
  } catch (error) {
    if (error instanceof ApiError) {
      return res.status(error.statusCode).json({
        success: false,
        message: error.message,
      });
    }

    return res.status(500).json({
      success: false,
      message: "Error interno al consultar el pago",
      error: error instanceof Error ? error.message : "Error desconocido",
    });
  }
};

export const getByOrdenId = async (req: Request, res: Response) => {
  try {
    if (!req.user?.uid) {
      return res.status(401).json({
        success: false,
        message: "No autorizado. Se requiere autenticación.",
      });
    }

    const result = await pagoService.getPagoByOrdenId(req.params.ordenId, {
      uid: req.user.uid,
      rol: req.user.rol as string | undefined,
    });

    return res.status(200).json({
      success: true,
      message: "Pago obtenido exitosamente",
      data: result,
    });
  } catch (error) {
    if (error instanceof ApiError) {
      return res.status(error.statusCode).json({
        success: false,
        message: error.message,
      });
    }

    return res.status(500).json({
      success: false,
      message: "Error interno al consultar el pago por orden",
      error: error instanceof Error ? error.message : "Error desconocido",
    });
  }
};
