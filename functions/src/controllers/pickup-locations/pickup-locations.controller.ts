import { Request, Response } from "express";
import pickupLocationService from "../../services/pickup-location.service";

const mapErrorStatus = (error: unknown): number => {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (message.includes("no encontrada") || message.includes("no encontrado")) {
    return 404;
  }
  if (
    message.includes("inactiva") ||
    message.includes("no permite") ||
    message.includes("carrito está vacío")
  ) {
    return 400;
  }
  return 500;
};

const errorResponse = (res: Response, error: unknown, fallback: string) => {
  const status = mapErrorStatus(error);
  return res.status(status).json({
    success: false,
    message: status === 500 ? fallback : error instanceof Error ? error.message : fallback,
    error: status === 500 && error instanceof Error ? error.message : undefined,
  });
};

export const listPublic = async (_req: Request, res: Response) => {
  try {
    const locations = await pickupLocationService.listPublic();
    return res.status(200).json({
      success: true,
      count: locations.length,
      data: locations,
    });
  } catch (error) {
    return errorResponse(res, error, "Error al listar sucursales pickup");
  }
};

export const getPublicById = async (req: Request, res: Response) => {
  try {
    const location = await pickupLocationService.requireActivePickupLocation(req.params.id);
    return res.status(200).json({ success: true, data: location });
  } catch (error) {
    return errorResponse(res, error, "Error al obtener sucursal pickup");
  }
};

export const validateAvailability = async (req: Request, res: Response) => {
  try {
    const result = await pickupLocationService.validateCartAvailability(
      req.params.id,
      req.body.cartId,
    );
    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    return errorResponse(res, error, "Error al validar disponibilidad pickup");
  }
};

export const create = async (req: Request, res: Response) => {
  try {
    const location = await pickupLocationService.create(req.body);
    return res.status(201).json({
      success: true,
      message: "Sucursal pickup creada exitosamente",
      data: location,
    });
  } catch (error) {
    return errorResponse(res, error, "Error al crear sucursal pickup");
  }
};

export const update = async (req: Request, res: Response) => {
  try {
    const location = await pickupLocationService.update(req.params.id, req.body);
    return res.status(200).json({
      success: true,
      message: "Sucursal pickup actualizada exitosamente",
      data: location,
    });
  } catch (error) {
    return errorResponse(res, error, "Error al actualizar sucursal pickup");
  }
};

export const deactivate = async (req: Request, res: Response) => {
  try {
    const location = await pickupLocationService.deactivate(req.params.id);
    return res.status(200).json({
      success: true,
      message: "Sucursal pickup desactivada exitosamente",
      data: location,
    });
  } catch (error) {
    return errorResponse(res, error, "Error al desactivar sucursal pickup");
  }
};
