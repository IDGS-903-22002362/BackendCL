import { logger } from "firebase-functions";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { configuracionLigaMx } from "./config/liga-mx.config";
import { LIGA_MX_SECRETS } from "./config/runtime-secrets";
import ligaMxService from "./services/liga-mx";

export const syncLigaMxData = onSchedule(
  {
    schedule: configuracionLigaMx.programacion,
    timeZone: configuracionLigaMx.zonaHoraria,
    secrets: [...LIGA_MX_SECRETS],
  },
  async (): Promise<void> => {
    try {
      const summary = await ligaMxService.runScheduledSync();

      logger.info("Sincronización Liga MX finalizada", summary);
    } catch (error) {
      logger.error("Error en sincronización Liga MX", error);
      throw error;
    }
  },
);
