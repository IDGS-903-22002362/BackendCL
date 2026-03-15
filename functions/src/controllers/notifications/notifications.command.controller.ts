import { Request, Response } from "express";
import deviceTokenService from "../../services/notifications/device-token.service";
import notificationEventService from "../../services/notifications/notification-event.service";
import notificationPreferencesService from "../../services/notifications/notification-preferences.service";
import notificationProcessingService from "../../services/notifications/notification-processing.service";

export const registerDevice = async (req: Request, res: Response) => {
  try {
    if (!req.user?.uid) {
      return res.status(401).json({
        success: false,
        message: "No autenticado",
      });
    }

    const device = await deviceTokenService.registerToken(req.user.uid, req.body);

    return res.status(201).json({
      success: true,
      message: "Dispositivo push registrado exitosamente",
      data: device,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Error al registrar el dispositivo push",
      error: error instanceof Error ? error.message : "Error desconocido",
    });
  }
};

export const updateDevice = async (req: Request, res: Response) => {
  try {
    if (!req.user?.uid) {
      return res.status(401).json({
        success: false,
        message: "No autenticado",
      });
    }

    const device = await deviceTokenService.updateToken(
      req.user.uid,
      req.params.deviceId,
      req.body,
    );

    return res.status(200).json({
      success: true,
      message: "Dispositivo push actualizado exitosamente",
      data: device,
    });
  } catch (error) {
    const statusCode =
      error instanceof Error && error.message.includes("no encontrado")
        ? 404
        : 500;

    return res.status(statusCode).json({
      success: false,
      message:
        statusCode === 404
          ? "Dispositivo no encontrado"
          : "Error al actualizar el dispositivo push",
      error: error instanceof Error ? error.message : "Error desconocido",
    });
  }
};

export const deactivateDevice = async (req: Request, res: Response) => {
  try {
    if (!req.user?.uid) {
      return res.status(401).json({
        success: false,
        message: "No autenticado",
      });
    }

    await deviceTokenService.disableToken(req.user.uid, req.params.deviceId);

    return res.status(200).json({
      success: true,
      message: "Dispositivo push desactivado",
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Error al desactivar el dispositivo push",
      error: error instanceof Error ? error.message : "Error desconocido",
    });
  }
};

export const updatePreferences = async (req: Request, res: Response) => {
  try {
    if (!req.user?.uid) {
      return res.status(401).json({
        success: false,
        message: "No autenticado",
      });
    }

    const preferences = await notificationPreferencesService.updatePreferences(
      req.user.uid,
      req.body,
    );

    return res.status(200).json({
      success: true,
      message: "Preferencias de notificación actualizadas",
      data: preferences,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Error al actualizar preferencias de notificación",
      error: error instanceof Error ? error.message : "Error desconocido",
    });
  }
};

export const sendTestNotification = async (req: Request, res: Response) => {
  try {
    const { userId, title, body, deeplink, screen, priority } = req.body as {
      userId: string;
      title: string;
      body: string;
      deeplink?: string;
      screen?: string;
      priority?: "normal" | "high";
    };
    const requestKey = `${userId}:${req.requestId || Date.now()}`;
    const enqueued = await notificationEventService.enqueueEvent({
      eventType: "manual_test",
      userId,
      priority,
      sourceData: {
        title,
        body,
        deeplink,
        screen,
        priority,
        requestKey,
      },
      fingerprintParts: ["manual_test", requestKey],
      triggerSource: "manual_test_endpoint",
    });
    const processingResult = await notificationProcessingService.processQueuedEvent(
      enqueued.event.id || enqueued.event.fingerprint,
    );

    return res.status(200).json({
      success: true,
      message: "Prueba de notificación procesada",
      data: processingResult,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Error al procesar la notificación de prueba",
      error: error instanceof Error ? error.message : "Error desconocido",
    });
  }
};

export const enqueueEvent = async (req: Request, res: Response) => {
  try {
    const result = await notificationEventService.enqueueEvent(req.body);

    return res.status(result.created ? 201 : 200).json({
      success: true,
      message: result.created
        ? "Evento de notificación encolado"
        : "Evento de notificación ya existía",
      data: result,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Error al encolar el evento de notificación",
      error: error instanceof Error ? error.message : "Error desconocido",
    });
  }
};
