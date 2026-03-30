import { onSchedule } from "firebase-functions/v2/scheduler";
import { logger } from "firebase-functions";

import instagramService from "./services/instagram.service";
import { firestoreApp } from "./config/app.firebase";

const SCHEDULE_CONFIG = {
  schedule: "every 1 hours",
  timeZone: "America/Mexico_City",
} as const;

export const syncInstagramPosts = onSchedule(
  SCHEDULE_CONFIG,
  async (): Promise<void> => {
    const db = firestoreApp;

    try {
      logger.info("Iniciando sincronización de Instagram");

      const posts = await instagramService.obtenerPublicaciones();

      if (!posts.length) {
        logger.info("No se encontraron publicaciones");
        return;
      }

      const batch = db.batch();

      for (const post of posts) {
        const ref = db.collection("noticias").doc(post.id);

        batch.set(ref, post, { merge: true });
      }

      await batch.commit();

      logger.info("✅ Sincronización finalizada", {
        totalProcesados: posts.length,
      });

    } catch (error) {
      logger.error("Error sincronizando Instagram", error);
      throw error;
    }
  }
);