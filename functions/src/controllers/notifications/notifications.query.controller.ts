import { Request, Response } from "express";
import notificationPreferencesService from "../../services/notifications/notification-preferences.service";

export const getPreferences = async (req: Request, res: Response) => {
  try {
    if (!req.user?.uid) {
      return res.status(401).json({
        success: false,
        message: "No autenticado",
      });
    }

    const preferences = await notificationPreferencesService.getPreferences(
      req.user.uid,
    );

    return res.status(200).json({
      success: true,
      data: preferences,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Error al obtener preferencias de notificación",
      error: error instanceof Error ? error.message : "Error desconocido",
    });
  }
};
