import { logger } from "firebase-functions";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { configuracionExpiracionPuntos } from "../../../config/puntos-expiracion.config";
import loyaltyEngineService from "../services/loyalty-engine.service";

export const loyaltyPointsExpirationJob = onSchedule(
  {
    schedule: configuracionExpiracionPuntos.programacion,
    timeZone: configuracionExpiracionPuntos.zonaHoraria,
    secrets: ["SERVICE_ACCOUNT_APP_OFICIAL"],
  },
  async (): Promise<void> => {
    try {
      const resumen = await loyaltyEngineService.processExpirationsVencidas();
      logger.info("loyalty_points_expiration_job_completed", resumen);
    } catch (error) {
      logger.error("loyalty_points_expiration_job_failed", {
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  },
);
