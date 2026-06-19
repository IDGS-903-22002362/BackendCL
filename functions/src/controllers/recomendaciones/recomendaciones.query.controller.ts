import { Request, Response } from "express";
import logger from "../../utils/logger";
import eventService from "../../services/recomendaciones/event.service";
import recomendacionesService from "../../services/recomendaciones/recomendaciones.service";
import metricsService from "../../services/recomendaciones/metrics.service";
import configService from "../../services/recomendaciones/config.service";
import {
  RecomendacionEstrategia,
  RecomendacionSuperficie,
} from "../../models/recomendaciones.model";

const log = logger.child({ component: "recomendaciones-query-controller" });

const buildError = (status: number, code: string, message: string) => ({
  success: false,
  error: { code, message },
});

const getSessionId = (req: Request): string | undefined => {
  const header = req.headers["x-session-id"];
  return typeof header === "string" ? header : undefined;
};

export const trackEvent = async (req: Request, res: Response) => {
  try {
    const result = await eventService.trackEvent({
      ...req.body,
      usuarioId: req.user?.uid ?? null,
      sessionId: getSessionId(req),
    });

    return res.status(result.accepted ? 202 : 429).json({
      success: result.accepted,
      data: result,
    });
  } catch (error) {
    log.error("track_event_failed", { error, requestId: req.requestId });
    return res.status(500).json(buildError(500, "TRACK_EVENT_FAILED", "No se pudo registrar el evento"));
  }
};

export const trackEventsBatch = async (req: Request, res: Response) => {
  try {
    const payload = req.body as { events: Array<Record<string, unknown>> };
    const result = await eventService.trackEventsBatch(
      payload.events.map((event) => ({
        ...event,
        usuarioId: req.user?.uid ?? null,
        sessionId: getSessionId(req),
      })) as Parameters<typeof eventService.trackEventsBatch>[0],
    );

    return res.status(202).json({ success: true, data: result });
  } catch (error) {
    log.error("track_events_batch_failed", { error, requestId: req.requestId });
    return res.status(500).json(buildError(500, "TRACK_EVENTS_FAILED", "No se pudieron registrar los eventos"));
  }
};

export const getRecommendations = async (req: Request, res: Response) => {
  try {
    const estrategia = req.query.estrategia as RecomendacionEstrategia;
    const productoIdsCarritoRaw = req.query.productoIdsCarrito as string | undefined;

    const data = await recomendacionesService.getRecommendations({
      estrategia,
      context: {
        usuarioId: req.user?.uid ?? null,
        sessionId: getSessionId(req),
        superficie: (req.query.superficie as RecomendacionSuperficie) || RecomendacionSuperficie.HOME,
        limite: req.query.limite ? Number(req.query.limite) : undefined,
        productoId: req.query.productoId as string | undefined,
        productoIdsCarrito: productoIdsCarritoRaw
          ? productoIdsCarritoRaw.split(",").map((item) => item.trim()).filter(Boolean)
          : undefined,
        categoriaId: req.query.categoriaId as string | undefined,
        lineaId: req.query.lineaId as string | undefined,
        tallaId: req.query.tallaId as string | undefined,
        minPrice: req.query.minPrice ? Number(req.query.minPrice) : undefined,
        maxPrice: req.query.maxPrice ? Number(req.query.maxPrice) : undefined,
      },
    });

    return res.status(200).json({ success: true, data });
  } catch (error) {
    log.error("get_recommendations_failed", { error, requestId: req.requestId });
    return res.status(500).json(buildError(500, "RECOMMENDATIONS_FAILED", "No se pudieron obtener recomendaciones"));
  }
};

export const getHomeRecommendations = async (req: Request, res: Response) => {
  try {
    const data = await recomendacionesService.getHomeRecommendations({
      usuarioId: req.user?.uid ?? null,
      sessionId: getSessionId(req),
      superficie: RecomendacionSuperficie.HOME,
      limite: req.query.limite ? Number(req.query.limite) : undefined,
    });

    return res.status(200).json({ success: true, data });
  } catch (error) {
    log.error("get_home_recommendations_failed", { error, requestId: req.requestId });
    return res.status(500).json(buildError(500, "HOME_RECOMMENDATIONS_FAILED", "No se pudieron obtener recomendaciones de home"));
  }
};

export const getProductRecommendations = async (req: Request, res: Response) => {
  try {
    const productoId = req.params.productoId;
    const [similares, compradosJuntos] = await Promise.all([
      recomendacionesService.getRecommendations({
        estrategia: RecomendacionEstrategia.SIMILARES,
        context: {
          usuarioId: req.user?.uid ?? null,
          sessionId: getSessionId(req),
          superficie: RecomendacionSuperficie.PRODUCTO,
          productoId,
        },
      }),
      recomendacionesService.getRecommendations({
        estrategia: RecomendacionEstrategia.COMPRADOS_JUNTOS,
        context: {
          usuarioId: req.user?.uid ?? null,
          sessionId: getSessionId(req),
          superficie: RecomendacionSuperficie.PRODUCTO,
          productoId,
        },
      }),
    ]);

    return res.status(200).json({
      success: true,
      data: {
        similares,
        compradosJuntos,
      },
    });
  } catch (error) {
    log.error("get_product_recommendations_failed", { error, requestId: req.requestId });
    return res.status(500).json(buildError(500, "PRODUCT_RECOMMENDATIONS_FAILED", "No se pudieron obtener recomendaciones de producto"));
  }
};

export const getCartRecommendations = async (req: Request, res: Response) => {
  try {
    const productoIdsCarritoRaw = req.query.productoIdsCarrito as string | undefined;
    const productoIdsCarrito = productoIdsCarritoRaw
      ? productoIdsCarritoRaw.split(",").map((item) => item.trim()).filter(Boolean)
      : [];

    const data = await recomendacionesService.getRecommendations({
      estrategia: RecomendacionEstrategia.COMPLEMENTOS_CARRITO,
      context: {
        usuarioId: req.user?.uid ?? null,
        sessionId: getSessionId(req),
        superficie: RecomendacionSuperficie.CARRITO,
        productoIdsCarrito,
      },
    });

    return res.status(200).json({ success: true, data });
  } catch (error) {
    log.error("get_cart_recommendations_failed", { error, requestId: req.requestId });
    return res.status(500).json(buildError(500, "CART_RECOMMENDATIONS_FAILED", "No se pudieron obtener recomendaciones de carrito"));
  }
};

export const getRecentlyViewed = async (req: Request, res: Response) => {
  try {
    const data = await recomendacionesService.getRecommendations({
      estrategia: RecomendacionEstrategia.RECIENTEMENTE_VISTOS,
      context: {
        usuarioId: req.user?.uid ?? null,
        sessionId: getSessionId(req),
        superficie: RecomendacionSuperficie.CUENTA,
      },
    });

    return res.status(200).json({ success: true, data });
  } catch (error) {
    log.error("get_recently_viewed_failed", { error, requestId: req.requestId });
    return res.status(500).json(buildError(500, "RECENTLY_VIEWED_FAILED", "No se pudieron obtener productos vistos"));
  }
};

export const getBuyAgain = async (req: Request, res: Response) => {
  try {
    if (!req.user?.uid) {
      return res.status(401).json(buildError(401, "UNAUTHENTICATED", "Autenticación requerida"));
    }

    const data = await recomendacionesService.getRecommendations({
      estrategia: RecomendacionEstrategia.COMPRAR_NUEVAMENTE,
      context: {
        usuarioId: req.user.uid,
        sessionId: getSessionId(req),
        superficie: RecomendacionSuperficie.CUENTA,
      },
    });

    return res.status(200).json({ success: true, data });
  } catch (error) {
    log.error("get_buy_again_failed", { error, requestId: req.requestId });
    return res.status(500).json(buildError(500, "BUY_AGAIN_FAILED", "No se pudieron obtener recomendaciones de recompra"));
  }
};

export const getAdminConfig = async (_req: Request, res: Response) => {
  const data = await configService.getConfig();
  return res.status(200).json({ success: true, data });
};

export const getAdminMetrics = async (req: Request, res: Response) => {
  const days = req.query.days ? Number(req.query.days) : 30;
  const data = await metricsService.getMetricsRange(days);
  return res.status(200).json({ success: true, data });
};
