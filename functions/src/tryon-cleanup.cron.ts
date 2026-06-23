import * as functions from "firebase-functions/v1";
import tryOnWorkflowService from "./services/ai/jobs/tryon-workflow.service";
import logger from "./utils/logger";

const cronLogger = logger.child({ component: "tryon-cleanup-cron" });

export const cleanupTryOnAssets = functions.pubsub
  .schedule("every 6 hours")
  .timeZone("America/Mexico_City")
  .onRun(async () => {
    cronLogger.info("tryon_cleanup_start");
    let totalDeleted = 0;

    for (let pass = 0; pass < 5; pass += 1) {
      const { deleted } = await tryOnWorkflowService.cleanupExpiredAssets(100);
      totalDeleted += deleted;
      if (deleted < 100) {
        break;
      }
    }

    cronLogger.info("tryon_cleanup_done", { totalDeleted });
    return null;
  });