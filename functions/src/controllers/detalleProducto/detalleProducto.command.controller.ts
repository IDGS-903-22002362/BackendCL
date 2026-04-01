import { Request, Response } from "express";
import logger from "../../utils/logger";
import detalleProductoService, {
  DetalleProductoServiceError,
} from "../../services/detalleProducto.service";

const detalleProductoCommandLogger = logger.child({
  component: "detalle-producto-command-controller",
});

const getStatusFromErrorCode = (code: string): number => {
  switch (code) {
    case "INVALID_ARGUMENT":
      return 400;
    case "NOT_FOUND":
      return 404;
    case "CONFLICT":
      return 409;
    default:
      return 500;
  }
};

const buildErrorResponse = (
  code: string,
  message: string,
  details?: Record<string, unknown>,
) => ({
  success: false,
  error: {
    code,
    message,
    ...(details ? { details } : {}),
  },
});

export const createDetalle = async (req: Request, res: Response) => {
  try {
    const { productoId } = req.params;
    const nuevoDetalle = await detalleProductoService.createDetalle(
      productoId,
      req.body,
    );

    return res.status(201).json({
      success: true,
      message: "Detalle creado exitosamente",
      data: nuevoDetalle,
    });
  } catch (error) {
    const errorCode =
      error instanceof DetalleProductoServiceError ? error.code : "INTERNAL";
    detalleProductoCommandLogger.error("detalle_create_failed", {
      requestId: req.requestId,
      productoId: req.params.productoId,
      route: req.originalUrl,
      errorCode,
      error: error instanceof Error ? error.message : "unknown_error",
    });

    if (error instanceof DetalleProductoServiceError) {
      return res
        .status(getStatusFromErrorCode(error.code))
        .json(buildErrorResponse(error.code, error.message));
    }

    return res
      .status(500)
      .json(buildErrorResponse("INTERNAL", "Error al crear el detalle"));
  }
};

export const updateDetalle = async (req: Request, res: Response) => {
  try {
    const { productoId, detalleId } = req.params;
    const detalleActualizado = await detalleProductoService.updateDetalle(
      productoId,
      detalleId,
      req.body,
    );

    return res.status(200).json({
      success: true,
      message: "Detalle actualizado exitosamente",
      data: detalleActualizado,
    });
  } catch (error) {
    const errorCode =
      error instanceof DetalleProductoServiceError ? error.code : "INTERNAL";
    detalleProductoCommandLogger.error("detalle_update_failed", {
      requestId: req.requestId,
      productoId: req.params.productoId,
      detalleId: req.params.detalleId,
      route: req.originalUrl,
      errorCode,
      error: error instanceof Error ? error.message : "unknown_error",
    });

    if (error instanceof DetalleProductoServiceError) {
      return res
        .status(getStatusFromErrorCode(error.code))
        .json(buildErrorResponse(error.code, error.message));
    }

    return res
      .status(500)
      .json(buildErrorResponse("INTERNAL", "Error al actualizar el detalle"));
  }
};

export const deleteDetalle = async (req: Request, res: Response) => {
  try {
    const { productoId, detalleId } = req.params;

    await detalleProductoService.deleteDetalle(productoId, detalleId);

    return res.status(200).json({
      success: true,
      message: "Detalle eliminado exitosamente",
    });
  } catch (error) {
    const errorCode =
      error instanceof DetalleProductoServiceError ? error.code : "INTERNAL";
    detalleProductoCommandLogger.error("detalle_delete_failed", {
      requestId: req.requestId,
      productoId: req.params.productoId,
      detalleId: req.params.detalleId,
      route: req.originalUrl,
      errorCode,
      error: error instanceof Error ? error.message : "unknown_error",
    });

    if (error instanceof DetalleProductoServiceError) {
      return res
        .status(getStatusFromErrorCode(error.code))
        .json(buildErrorResponse(error.code, error.message));
    }

    return res
      .status(500)
      .json(buildErrorResponse("INTERNAL", "Error al eliminar el detalle"));
  }
};
