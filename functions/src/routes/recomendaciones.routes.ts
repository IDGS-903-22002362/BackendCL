import { Router } from "express";
import { authMiddleware, optionalAuthMiddleware, requireAdmin } from "../utils/middlewares";
import { createSimpleRateLimiter } from "../middleware/rate-limit.middleware";
import {
  validateBody,
  validateParams,
  validateQuery,
} from "../middleware/validation.middleware";
import {
  adminConfigUpdateSchema,
  adminMetricsQuerySchema,
  homeRecommendationsQuerySchema,
  mergeIdentitySchema,
  productoIdParamSchema,
  recommendationsQuerySchema,
  trackEventSchema,
  trackEventsBatchSchema,
} from "../middleware/validators/recomendaciones.validator";
import * as queryController from "../controllers/recomendaciones/recomendaciones.query.controller";
import * as commandController from "../controllers/recomendaciones/recomendaciones.command.controller";

const router = Router();

const recommendationsRateLimit = createSimpleRateLimiter({
  keyPrefix: "recommendations",
  windowMs: 60_000,
  maxRequests: 120,
});

router.use(recommendationsRateLimit);

router.post(
  "/eventos",
  optionalAuthMiddleware,
  validateBody(trackEventSchema),
  queryController.trackEvent,
);

router.post(
  "/eventos/batch",
  optionalAuthMiddleware,
  validateBody(trackEventsBatchSchema),
  queryController.trackEventsBatch,
);

router.post(
  "/identidad/unir",
  authMiddleware,
  validateBody(mergeIdentitySchema),
  commandController.mergeIdentity,
);

router.get(
  "/",
  optionalAuthMiddleware,
  validateQuery(recommendationsQuerySchema),
  queryController.getRecommendations,
);

router.get(
  "/home",
  optionalAuthMiddleware,
  validateQuery(homeRecommendationsQuerySchema),
  queryController.getHomeRecommendations,
);

router.get(
  "/producto/:productoId",
  optionalAuthMiddleware,
  validateParams(productoIdParamSchema),
  queryController.getProductRecommendations,
);

router.get("/carrito", optionalAuthMiddleware, queryController.getCartRecommendations);
router.get("/vistos-recientemente", optionalAuthMiddleware, queryController.getRecentlyViewed);
router.get("/recompra", authMiddleware, queryController.getBuyAgain);

router.delete(
  "/historial/vistos",
  optionalAuthMiddleware,
  commandController.clearViewHistory,
);

router.get(
  "/admin/config",
  authMiddleware,
  requireAdmin,
  queryController.getAdminConfig,
);

router.put(
  "/admin/config",
  authMiddleware,
  requireAdmin,
  validateBody(adminConfigUpdateSchema),
  commandController.updateAdminConfig,
);

router.get(
  "/admin/metricas",
  authMiddleware,
  requireAdmin,
  validateQuery(adminMetricsQuerySchema),
  queryController.getAdminMetrics,
);

router.post(
  "/admin/rebuild",
  authMiddleware,
  requireAdmin,
  commandController.rebuildAggregates,
);

router.post(
  "/admin/cleanup",
  authMiddleware,
  requireAdmin,
  commandController.cleanupRecommendationData,
);

export default router;
