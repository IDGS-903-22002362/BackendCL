import { onSchedule } from "firebase-functions/v2/scheduler";
import deletionScheduler from "./services/deletionScheduler.service";
import { logger } from "firebase-functions";

// Programación diaria a las 2:00 AM UTC
export const scheduledAccountDeletion = onSchedule(
    {
        schedule: "0 2 * * *",
        timeZone: "America/Mexico_City",
        memory: "512MiB",
        retryCount: 3,
        maxRetrySeconds: 300,
    },
    async (event) => {
        logger.info("Ejecutando limpieza de cuentas programada...");
        try {
            await deletionScheduler.processPendingDeletions();
            logger.info("Limpieza de cuentas finalizada correctamente");
        } catch (error) {
            logger.error("Error en el proceso de eliminación programada:", error);
            throw error; // Firebase reintentará si está configurado
        }
    }
);