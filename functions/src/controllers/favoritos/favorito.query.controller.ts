import { Request, Response } from "express";
import logger from "../../utils/logger";
import favoritoService, {
  FavoritoServiceError,
} from "../../services/favorito.service";

const favoritoQueryLogger = logger.child({ component: "favorito-query-controller" });

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

export const getFavoritos = async (req: Request, res: Response) => {
  try {
    const usuarioId = req.user?.uid;
    const limit = Number(req.query.limit ?? 20);
    const offset = Number(req.query.offset ?? 0);

    if (!usuarioId) {
      return res
        .status(401)
        .json(buildErrorResponse("UNAUTHENTICATED", "No autenticado"));
    }

    const favoritos = await favoritoService.getFavoritos(usuarioId, limit, offset);

    return res.status(200).json({
      success: true,
      count: favoritos.length,
      meta: {
        limit,
        offset,
        returned: favoritos.length,
      },
      data: favoritos,
    });
  } catch (error) {
    favoritoQueryLogger.error("favoritos_list_failed", {
      requestId: req.requestId,
      uid: req.user?.uid,
      route: req.originalUrl,
      errorCode:
        error instanceof FavoritoServiceError ? error.code : "INTERNAL",
      error: error instanceof Error ? error.message : "unknown_error",
    });

    if (error instanceof FavoritoServiceError) {
      const status = error.code === "INVALID_ARGUMENT" ? 400 : 500;
      return res.status(status).json(buildErrorResponse(error.code, error.message));
    }

    return res
      .status(500)
      .json(buildErrorResponse("INTERNAL", "Error al listar favoritos"));
  }
};

export const checkFavorito = async (req: Request, res: Response) => {
  try {
    const usuarioId = req.user?.uid;
    const { productoId } = req.params;

    if (!usuarioId) {
      return res
        .status(401)
        .json(buildErrorResponse("UNAUTHENTICATED", "No autenticado"));
    }

    const esFavorito = await favoritoService.isFavorito(usuarioId, productoId);

    return res.status(200).json({
      success: true,
      data: { esFavorito },
    });
  } catch (error) {
    favoritoQueryLogger.error("favorito_check_failed", {
      requestId: req.requestId,
      uid: req.user?.uid,
      route: req.originalUrl,
      productoId: req.params.productoId,
      errorCode:
        error instanceof FavoritoServiceError ? error.code : "INTERNAL",
      error: error instanceof Error ? error.message : "unknown_error",
    });

    if (error instanceof FavoritoServiceError) {
      const status = error.code === "INVALID_ARGUMENT" ? 400 : 500;
      return res.status(status).json(buildErrorResponse(error.code, error.message));
    }

    return res
      .status(500)
      .json(buildErrorResponse("INTERNAL", "Error al verificar favorito"));
  }
};
