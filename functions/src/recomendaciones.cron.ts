import * as functions from "firebase-functions/v1";
import aggregatesService from "./services/recomendaciones/aggregates.service";
import eventService from "./services/recomendaciones/event.service";
import cacheService from "./services/recomendaciones/cache.service";
import logger from "./utils/logger";

const cronLogger = logger.child({ component: "recomendaciones-cron" });

export const recalculateRecommendationAggregates = functions.pubsub
  .schedule("every 6 hours")
  .timeZone("America/Mexico_City")
  .onRun(async () => {
    cronLogger.info("recommendations_aggregates_start");
    await Promise.all([
      aggregatesService.recalculateBestSellers(),
      aggregatesService.recalculateTrending(),
      aggregatesService.recalculateDestacados(),
      aggregatesService.recalculatePopularity(),
      aggregatesService.recalculateFrequentlyBoughtTogether(),
    ]);
    cronLogger.info("recommendations_aggregates_done");
    return null;
  });

export const cleanupRecommendationEvents = functions.pubsub
  .schedule("every day 03:30")
  .timeZone("America/Mexico_City")
  .onRun(async () => {
    cronLogger.info("recommendations_cleanup_start");
    const [eventsDeleted, cacheDeleted] = await Promise.all([
      eventService.cleanupExpiredEvents(500),
      cacheService.cleanupExpired(300),
    ]);
    cronLogger.info("recommendations_cleanup_done", { eventsDeleted, cacheDeleted });
    return null;
  });
