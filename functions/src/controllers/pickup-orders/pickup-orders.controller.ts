import { Request, Response } from "express";
import pickupOrderService from "../../services/pickup-order.service";

const getActor = (req: Request): { uid?: string; actorType: "admin" | "staff" } => ({
  uid: req.user?.uid,
  actorType: req.user?.rol === "ADMIN" ? "admin" : "staff",
});

const statusFromError = (error: unknown): number => {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (message.includes("no encontrada") || message.includes("no encontrado")) {
    return 404;
  }
  if (
    message.includes("no es de tipo pickup") ||
    message.includes("solo") ||
    message.includes("no está listo") ||
    message.includes("ya fue") ||
    message.includes("inválido") ||
    message.includes("otra sucursal")
  ) {
    return 409;
  }
  return 500;
};

const respondError = (res: Response, error: unknown, fallback: string) => {
  const status = statusFromError(error);
  return res.status(status).json({
    success: false,
    message: status === 500 ? fallback : error instanceof Error ? error.message : fallback,
    error: status === 500 && error instanceof Error ? error.message : undefined,
  });
};

export const list = async (req: Request, res: Response) => {
  try {
    const orders = await pickupOrderService.listPickupOrders(req.query as never);
    return res.status(200).json({
      success: true,
      count: orders.length,
      data: orders,
    });
  } catch (error) {
    return respondError(res, error, "Error al listar pedidos pickup");
  }
};

export const getById = async (req: Request, res: Response) => {
  try {
    const order = await pickupOrderService.getPickupOrder(req.params.id);
    return res.status(200).json({ success: true, data: order });
  } catch (error) {
    return respondError(res, error, "Error al obtener pedido pickup");
  }
};

export const prepare = async (req: Request, res: Response) => {
  try {
    const order = await pickupOrderService.markPreparing(req.params.id, getActor(req));
    return res.status(200).json({
      success: true,
      message: "Pedido pickup marcado en preparación",
      data: order,
    });
  } catch (error) {
    return respondError(res, error, "Error al preparar pedido pickup");
  }
};

export const ready = async (req: Request, res: Response) => {
  try {
    const order = await pickupOrderService.markReady(req.params.id, getActor(req));
    return res.status(200).json({
      success: true,
      message: "Pedido pickup marcado listo para recoger",
      data: order,
    });
  } catch (error) {
    return respondError(res, error, "Error al marcar pedido pickup listo");
  }
};

export const verifyCode = async (req: Request, res: Response) => {
  try {
    const result = await pickupOrderService.verifyCode(
      req.params.id,
      req.body.code,
      getActor(req),
      req.body.pickupLocationId,
    );
    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    return respondError(res, error, "Error al verificar código pickup");
  }
};

export const complete = async (req: Request, res: Response) => {
  try {
    const order = await pickupOrderService.completePickup({
      orderId: req.params.id,
      code: req.body.code,
      pickupLocationId: req.body.pickupLocationId,
      pickedUpBy: req.body.pickedUpBy,
      actor: getActor(req),
    });
    return res.status(200).json({
      success: true,
      message: "Pedido pickup entregado exitosamente",
      data: order,
    });
  } catch (error) {
    return respondError(res, error, "Error al completar pickup");
  }
};

export const expire = async (req: Request, res: Response) => {
  try {
    const order = await pickupOrderService.expirePickup(req.params.id, getActor(req));
    return res.status(200).json({
      success: true,
      message: "Pedido pickup expirado exitosamente",
      data: order,
    });
  } catch (error) {
    return respondError(res, error, "Error al expirar pedido pickup");
  }
};
