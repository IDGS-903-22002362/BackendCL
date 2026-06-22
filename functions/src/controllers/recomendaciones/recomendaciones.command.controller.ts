import { Request, Response } from "express";
import logger from "../../utils/logger";
import configService from "../../services/recomendaciones/config.service";
import aggregatesService from "../../services/recomendaciones/aggregates.service";
import eventService from "../../services/recomendaciones/event.service";
import cacheService from "../../services/recomendaciones/cache.service";
import visitorService from "../../services/recomendaciones/visitor.service";
import invalidationService from "../../services/recomendaciones/invalidation.service";

const log = logger.child({ component: "recomendaciones-command-controller" });

export const mergeIdentity = async (req: Request, res: Response) => {
  try {
    if (!req.user?.uid) {
      return res.status(401).json({
        success: false,
        error: { code: "UNAUTHENTICATED", message: "Autenticación requerida" },
      });
    }

    const { sessionId } = req.body as { sessionId: string };
    await visitorService.mergeAnonymousToUser({
      sessionId,
      usuarioId: req.user.uid,
    });

    return res.status(200).json({ success: true, message: "Identidad unificada" });
  } catch (error) {
    log.error("merge_identity_failed", { error, requestId: req.requestId });
    return res.status(500).json({
      success: false,
      error: { code: "MERGE_IDENTITY_FAILED", message: "No se pudo unificar la identidad" },
    });
  }
};

export const updateAdminConfig = async (req: Request, res: Response) => {
  try {
    const data = await configService.updateConfig(req.body, req.user?.uid);
    await invalidationService.invalidateForConfigChange();
    return res.status(200).json({ success: true, data });
  } catch (error) {
    log.error("update_admin_config_failed", { error, requestId: req.requestId });
    return res.status(500).json({
      success: false,
      error: { code: "UPDATE_CONFIG_FAILED", message: "No se pudo actualizar la configuración" },
    });
  }
};

export const rebuildAggregates = async (_req: Request, res: Response) => {
  try {
    await Promise.all([
      aggregatesService.recalculateBestSellers(),
      aggregatesService.recalculateTrending(),
      aggregatesService.recalculateDestacados(),
      aggregatesService.recalculatePopularity(),
      aggregatesService.recalculateFrequentlyBoughtTogether(),
    ]);

    return res.status(200).json({ success: true, message: "Agregados recalculados" });
  } catch (error) {
    log.error("rebuild_aggregates_failed", { error });
    return res.status(500).json({
      success: false,
      error: { code: "REBUILD_AGGREGATES_FAILED", message: "No se pudieron recalcular agregados" },
    });
  }
};

export const cleanupRecommendationData = async (_req: Request, res: Response) => {
  try {
    const [eventsDeleted, cacheDeleted] = await Promise.all([
      eventService.cleanupExpiredEvents(),
      cacheService.cleanupExpired(),
    ]);

    return res.status(200).json({
      success: true,
      data: { eventsDeleted, cacheDeleted },
    });
  } catch (error) {
    log.error("cleanup_recommendation_data_failed", { error });
    return res.status(500).json({
      success: false,
      error: { code: "CLEANUP_FAILED", message: "No se pudo ejecutar la limpieza" },
    });
  }
};

export const clearViewHistory = async (req: Request, res: Response) => {
  try {
    const sessionIdHeader = req.headers["x-session-id"];
    const sessionId = typeof sessionIdHeader === "string" ? sessionIdHeader : undefined;

    const result = await eventService.clearViewHistory({
      usuarioId: req.user?.uid ?? null,
      sessionId,
    });

    await invalidationService.invalidateForViewHistoryChange(req.user?.uid);

    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    log.error("clear_view_history_failed", { error, requestId: req.requestId });
    return res.status(500).json({
      success: false,
      error: {
        code: "CLEAR_VIEW_HISTORY_FAILED",
        message: "No se pudo limpiar el historial de vistos",
      },
    });
  }
};
