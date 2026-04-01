import { Request, Response } from "express";
import logger from "../../utils/logger";
import detalleProductoService, {
  DetalleProductoServiceError,
} from "../../services/detalleProducto.service";

const detalleProductoQueryLogger = logger.child({
  component: "detalle-producto-query-controller",
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

export const getDetallesByProducto = async (req: Request, res: Response) => {
  try {
    const { productoId } = req.params;
    const detalles = await detalleProductoService.getDetallesByProducto(productoId);

    return res.status(200).json({
      success: true,
      count: detalles.length,
      data: detalles,
    });
  } catch (error) {
    const errorCode =
      error instanceof DetalleProductoServiceError ? error.code : "INTERNAL";
    detalleProductoQueryLogger.error("detalle_list_failed", {
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
      .json(buildErrorResponse("INTERNAL", "Error al obtener los detalles del producto"));
  }
};

export const getDetalleById = async (req: Request, res: Response) => {
  try {
    const { productoId, detalleId } = req.params;
    const detalle = await detalleProductoService.getDetalleById(
      productoId,
      detalleId,
    );

    if (!detalle) {
      return res.status(404).json({
        success: false,
        error: {
          code: "NOT_FOUND",
          message: `Detalle con ID ${detalleId} no encontrado en el producto ${productoId}`,
        },
      });
    }

    return res.status(200).json({
      success: true,
      data: detalle,
    });
  } catch (error) {
    const errorCode =
      error instanceof DetalleProductoServiceError ? error.code : "INTERNAL";
    detalleProductoQueryLogger.error("detalle_get_failed", {
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
      .json(buildErrorResponse("INTERNAL", "Error al obtener el detalle"));
  }
};
