import { Request, Response } from "express";
import rachaService from "../../services/racha.service";
import { mapFirebaseError } from "../../utils/firebase-error.util";

type AuthedRequest = Request & { user?: { uid?: string } };

export const checkInRacha = async (req: Request, res: Response) => {
  try {
    const uid = (req as AuthedRequest).user?.uid;

    if (typeof uid !== "string" || !uid) {
      return res.status(401).json({
        success: false,
        message: "No autorizado",
      });
    }

    const result = await rachaService.checkIn(uid, "America/Mexico_City");

    return res.status(200).json({
      success: true,
      message: result.alreadyCheckedIn
        ? "Ya hiciste check-in hoy"
        : "¡Nuevo día de racha!",
      data: result,
    });
  } catch (error) {
    const mapped = mapFirebaseError(error, {
      unauthorizedMessage: "No autorizado",
      forbiddenMessage: "Sin permisos para actualizar la racha",
      notFoundMessage: "Usuario no encontrado",
      internalMessage: "Error al actualizar racha",
    });

    console.error("Error en POST /api/usuarios/me/racha/checkin:", {
      code: mapped.code,
      status: mapped.status,
    });

    return res.status(mapped.status).json({
      success: false,
      message: mapped.message,
    });
  }
};

export const getRacha = async (req: Request, res: Response) => {
  try {
    const uid = (req as AuthedRequest).user?.uid;

    if (typeof uid !== "string" || !uid) {
      return res.status(401).json({
        success: false,
        message: "No autorizado",
      });
    }

    const data = await rachaService.getRacha(uid);

    if (!data) {
      return res.status(404).json({
        success: false,
        message: "Usuario no encontrado",
      });
    }

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    console.error("Error en GET /api/usuarios/me/racha:", error);
    return res.status(500).json({
      success: false,
      message: "Error al obtener la racha",
    });
  }
};