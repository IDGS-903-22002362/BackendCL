import { Request, Response } from "express";
import ordenService from "../../services/orden.service";

const toStatusCode = (error: unknown): number => {
  const message = error instanceof Error ? error.message.toLowerCase() : "";

  if (message.includes("no existe")) {
    return 404;
  }
  if (
    message.includes("pago confirmado") ||
    message.includes("cancelada") ||
    message.includes("pickup") ||
    message.includes("no usa envio manual")
  ) {
    return 409;
  }
  if (message.includes("obligatorio")) {
    return 400;
  }

  return 500;
};

const sendError = (res: Response, error: unknown) => {
  const statusCode = toStatusCode(error);
  return res.status(statusCode).json({
    success: false,
    message:
      statusCode === 500
        ? "Error al actualizar envio manual"
        : error instanceof Error
          ? error.message
          : "Error al actualizar envio manual",
  });
};

const requireAdminId = (req: Request, res: Response): string | undefined => {
  if (!req.user?.uid) {
    res.status(401).json({
      success: false,
      message: "No autenticado",
    });
    return undefined;
  }

  return req.user.uid;
};

export const markPreparing = async (req: Request, res: Response) => {
  try {
    const adminId = requireAdminId(req, res);
    if (!adminId) return;

    const order = await ordenService.markManualShippingPreparing(
      req.params.orderId,
      adminId,
      req.body?.note,
    );

    return res.status(200).json({ success: true, data: order });
  } catch (error) {
    return sendError(res, error);
  }
};

export const markReadyToShip = async (req: Request, res: Response) => {
  try {
    const adminId = requireAdminId(req, res);
    if (!adminId) return;

    const order = await ordenService.markManualShippingReadyToShip(
      req.params.orderId,
      adminId,
      req.body?.note,
    );

    return res.status(200).json({ success: true, data: order });
  } catch (error) {
    return sendError(res, error);
  }
};

export const captureTracking = async (req: Request, res: Response) => {
  try {
    const adminId = requireAdminId(req, res);
    if (!adminId) return;

    const order = await ordenService.captureManualFedexTracking(
      req.params.orderId,
      adminId,
      req.body,
    );

    return res.status(200).json({ success: true, data: order });
  } catch (error) {
    return sendError(res, error);
  }
};

export const updateStatus = async (req: Request, res: Response) => {
  try {
    const adminId = requireAdminId(req, res);
    if (!adminId) return;

    const order = await ordenService.updateManualShippingStatus(
      req.params.orderId,
      adminId,
      req.body,
    );

    return res.status(200).json({ success: true, data: order });
  } catch (error) {
    return sendError(res, error);
  }
};
