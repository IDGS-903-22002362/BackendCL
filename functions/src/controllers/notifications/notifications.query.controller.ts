import { Request, Response } from "express";
import notificationBroadcastService from "../../services/notifications/notification-broadcast.service";
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

export const getBroadcastStatus = async (req: Request, res: Response) => {
  try {
    const broadcast = await notificationBroadcastService.getBroadcast(
      req.params.broadcastId,
    );

    if (!broadcast) {
      return res.status(404).json({
        success: false,
        message: "Broadcast no encontrado",
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        broadcastId: broadcast.id,
        status: broadcast.status,
        title: broadcast.copy?.title,
        body: broadcast.copy?.body,
        targetedUsers: broadcast.targetedUsers,
        totalTokens: broadcast.totalTokens,
        totalChunks: broadcast.totalChunks,
        chunksCompleted: broadcast.chunksCompleted,
        sent: broadcast.sent,
        failed: broadcast.failed,
        invalidTokens: broadcast.invalidTokens,
        createdBy: broadcast.createdBy,
        createdAt: broadcast.createdAt,
        completedAt: broadcast.completedAt,
      },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Error al obtener el estado del broadcast",
      error: error instanceof Error ? error.message : "Error desconocido",
    });
  }
};
