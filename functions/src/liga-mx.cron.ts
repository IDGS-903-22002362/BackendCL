import { logger } from "firebase-functions";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { configuracionLigaMx } from "./config/liga-mx.config";
import ligaMxService from "./services/liga-mx";

export const syncLigaMxData = onSchedule(
  {
    schedule: configuracionLigaMx.programacion,
    timeZone: configuracionLigaMx.zonaHoraria,
    secrets: ["LMX_API_KEY"],
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