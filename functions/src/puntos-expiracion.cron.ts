import { logger } from "firebase-functions";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { configuracionExpiracionPuntos } from "./config/puntos-expiracion.config";
import pointsService from "./services/puntos.service";

export const processPointsExpiration = onSchedule(
  {
    schedule: configuracionExpiracionPuntos.programacion,
    timeZone: configuracionExpiracionPuntos.zonaHoraria,
  },
  async (): Promise<void> => {
    try {
      const resumen = await pointsService.procesarExpiracionesVencidas();
      logger.info("Expiración anual de puntos finalizada", resumen);
    } catch (error) {
      logger.error("Error en expiración anual de puntos", error);
      throw error;
    }
  },
);