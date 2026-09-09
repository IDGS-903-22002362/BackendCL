import { logger } from "firebase-functions";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { configuracionOpta } from "./config/opta.config";
import { APP_OFICIAL_SECRETS, OPTA_SECRETS } from "./config/runtime-secrets";
import optaService from "./services/opta";

export const syncOptaMatchStats = onSchedule(
  {
    schedule: configuracionOpta.programacion,
    timeZone: configuracionOpta.zonaHoraria,
    secrets: [...OPTA_SECRETS, ...APP_OFICIAL_SECRETS],
  },
  async (): Promise<void> => {
    try {
      const summary = await optaService.runScheduledSync();

      if (summary.omitido) {
        logger.warn("Sincronización Opta omitida", summary);
        return;
      }

      logger.info("Sincronización Opta finalizada", summary);
    } catch (error) {
      logger.error("Error en sincronización Opta", error);
      throw error;
    }
  },
);
