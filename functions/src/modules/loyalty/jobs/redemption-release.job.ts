import { logger } from "firebase-functions";
import { onSchedule } from "firebase-functions/v2/scheduler";
import loyaltyEngineService from "../services/loyalty-engine.service";

export const loyaltyRedemptionReleaseJob = onSchedule(
  {
    schedule: "every 15 minutes",
    timeZone: "America/Mexico_City",
    secrets: ["SERVICE_ACCOUNT_APP_OFICIAL"],
  },
  async (): Promise<void> => {
    try {
      const processed = await loyaltyEngineService.releaseExpiredRedemptions(100);
      logger.info("loyalty_redemption_release_job_completed", { processed });
    } catch (error) {
      logger.error("loyalty_redemption_release_job_failed", {
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  },
);
