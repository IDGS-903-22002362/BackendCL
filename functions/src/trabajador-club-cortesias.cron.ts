import { logger } from "firebase-functions";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { syncCortesiasForAllTrabajadores } from "./services/trabajador-club/cortesias-trabajador-club.service";

export const TRABAJADOR_CLUB_CORTESIAS_SECRETS = [
  "SERVICE_ACCOUNT_APP_OFICIAL2",
  "REALTIME_DATABASE_URL_APP_OFICIAL2",
  "CORTESIAS_TORNEO_RTDB_PATH",
  "CORTESIAS_TORNEO_LABEL",
] as const;

export const syncTrabajadorClubCortesias = onSchedule(
  {
    schedule: "0 4 * * 1",
    timeZone: "America/Mexico_City",
    memory: "512MiB",
    retryCount: 2,
    secrets: [...TRABAJADOR_CLUB_CORTESIAS_SECRETS],
  },
  async () => {
    logger.info("Iniciando sync semanal de cortesías trabajador club");
    try {
      const summary = await syncCortesiasForAllTrabajadores();
      logger.info("Sync cortesías trabajador club finalizado", summary);
    } catch (error) {
      logger.error("Error en sync cortesías trabajador club", error);
      throw error;
    }
  },
);
