import { onSchedule } from "firebase-functions/v2/scheduler";
import { logger } from "firebase-functions";
import { firestore } from "firebase-admin";

import instagramService from "./services/instagram.service";
import newService from "./services/new.service";

const SCHEDULE_CONFIG = {
  schedule: "every 1 hours",
  timeZone: "America/Mexico_City",
} as const;

export const syncInstagramPosts = onSchedule(
  SCHEDULE_CONFIG,
  async (): Promise<void> => {
    const db = firestore();

    try {
      logger.info("🔄 Iniciando sincronización de Instagram");

      const posts = await instagramService.obtenerPublicaciones();

      if (!posts.length) {
        logger.info("No se encontraron publicaciones nuevas");
        return;
      }

      for (const post of posts) {
        const docId = `ig_${post.id}`;
        const ref = db.collection("noticias").doc(docId);

        const snapshot = await ref.get();

        if (snapshot.exists) {
          continue;
        }

        const noticia = {
          id: docId,
          titulo:
            post.caption?.slice(0, 80) ??
            "Publicación de Instagram",
          descripcion: "Publicación de Instagram",
          contenido: post.caption ?? "",
          imagenes: post.mediaUrl ? [post.mediaUrl] : [],
          enlaceExterno: post.permalink,
          origen: "instagram",
          estatus: true,
          createdAt: post.timestamp,
          updatedAt: new Date().toISOString(),
        };

        await ref.set(noticia);

        // Generación IA desacoplada del insert principal
        await newService.generarIAParaNoticia(docId);
      }

      logger.info("✅ Sincronización finalizada correctamente", {
        totalProcesados: posts.length,
      });
    } catch (error) {
      logger.error("❌ Error sincronizando publicaciones de Instagram", error);
      throw error;
    }
  },
);