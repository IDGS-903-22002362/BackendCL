/**
 * FIREBASE FUNCTIONS ENTRY POINTOteooooooooo
 * ---------------------------------------------------------------------
 * Este es el ÚNICO archivo que Firebase lee directamente al iniciar.
 * Su responsabilidad es exportar los triggers de Cloud Functions.
 *
 * NOTA DE ARQUITECTURA:
 * Mantenemos este archivo minimalista. La lógica de la aplicación Express
 * vive en "app.ts", permitiendo que sea testeable independientemente
 * del entorno de Firebase.
 */

import { onRequest } from "firebase-functions/v2/https";
import app from "./app";
import { sendLowStockDailyDigest } from "./stock-alert.cron";
import { syncInstagramPosts } from "./social.cron";

// Exportar la API de Express como una Cloud Function HTTPS
// Los secrets se inyectan automáticamente como process.env.* en runtime
export const api = onRequest(
  {
    secrets: ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "GEMINI_API_KEY"],
    invoker: "public",
  },
  app,
);

export const lowStockDailyDigest = sendLowStockDailyDigest;
//exportación de funcion
export const syncInstagramPostsFunction = syncInstagramPosts;
