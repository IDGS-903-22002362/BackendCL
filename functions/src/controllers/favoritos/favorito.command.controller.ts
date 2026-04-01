import { Request, Response } from "express";
import logger from "../../utils/logger";
import favoritoService, {
  FavoritoServiceError,
} from "../../services/favorito.service";

const favoritoCommandLogger = logger.child({
  component: "favorito-command-controller",
});

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

const getStatusFromErrorCode = (code: string): number => {
  switch (code) {
    case "UNAUTHENTICATED":
      return 401;
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

export const createFavorito = async (req: Request, res: Response) => {
  try {
    const usuarioId = req.user?.uid;
    const { productoId } = req.body;

    if (!usuarioId) {
      return res
        .status(401)
        .json(buildErrorResponse("UNAUTHENTICATED", "No autenticado"));
    }

    const { favorito, created } = await favoritoService.createFavorito(
      usuarioId,
      productoId,
    );

    return res.status(created ? 201 : 200).json({
      success: true,
      message: created
        ? "Producto agregado a favoritos"
        : "Producto ya estaba en favoritos",
      data: favorito,
    });
  } catch (error) {
    const errorCode =
      error instanceof FavoritoServiceError ? error.code : "INTERNAL";
    favoritoCommandLogger.error("favorito_create_failed", {
      requestId: req.requestId,
      uid: req.user?.uid,
      route: req.originalUrl,
      productoId: req.body?.productoId,
      errorCode,
      error: error instanceof Error ? error.message : "unknown_error",
    });

    if (error instanceof FavoritoServiceError) {
      return res
        .status(getStatusFromErrorCode(error.code))
        .json(buildErrorResponse(error.code, error.message));
    }

    return res
      .status(500)
      .json(buildErrorResponse("INTERNAL", "Error al agregar favorito"));
  }
};

export const deleteFavorito = async (req: Request, res: Response) => {
  try {
    const usuarioId = req.user?.uid;
    const { productoId } = req.params;

    if (!usuarioId) {
      return res
        .status(401)
        .json(buildErrorResponse("UNAUTHENTICATED", "No autenticado"));
    }

    await favoritoService.deleteFavorito(usuarioId, productoId);

    return res.status(200).json({
      success: true,
      message: "Producto eliminado de favoritos",
    });
  } catch (error) {
    const errorCode =
      error instanceof FavoritoServiceError ? error.code : "INTERNAL";
    favoritoCommandLogger.error("favorito_delete_failed", {
      requestId: req.requestId,
      uid: req.user?.uid,
      route: req.originalUrl,
      productoId: req.params.productoId,
      errorCode,
      error: error instanceof Error ? error.message : "unknown_error",
    });

    if (error instanceof FavoritoServiceError) {
      return res
        .status(getStatusFromErrorCode(error.code))
        .json(buildErrorResponse(error.code, error.message));
    }

    return res
      .status(500)
      .json(buildErrorResponse("INTERNAL", "Error al eliminar favorito"));
  }
};
