import "./config/env.bootstrap";
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
import { assertAiConfig, getAiRuntimeSummary } from "./config/ai.config";
import { sendLowStockDailyDigest } from "./stock-alert.cron";
import { syncInstagramPosts } from "./social.cron";
import { processTryOnJobTrigger } from "./services/ai/jobs/tryon-processor.trigger";

assertAiConfig({ requireTryOn: true });
console.log("AI runtime config validated:", getAiRuntimeSummary());

// Exportar la API de Express como una Cloud Function HTTPS
// Los secrets se inyectan automáticamente como process.env.* en runtime
export const api = onRequest(
  {
    secrets: [
      "STRIPE_SECRET_KEY",
      "STRIPE_WEBHOOK_SECRET",
      "STRIPE_PUBLISHABLE_KEY",
      "STRIPE_CURRENCY",
      "APP_URL",
      "JWT_SECRET",
      "GEMINI_API_KEY",
      "GOOGLE_API_KEY",
      "GCP_PROJECT_ID",
      "GCP_REGION",
      "VERTEX_TRYON_MODEL",
      "AI_STORAGE_BUCKET",
      "GCS_TRYON_BUCKET",
      "STORE_PUBLIC_BASE_URL",
      "STORE_PRODUCT_PATH_TEMPLATE",
    ],
    invoker: "public",
  },
  app,
);

export const lowStockDailyDigest = sendLowStockDailyDigest;
//exportación de funcion
export const syncInstagramPostsFunction = syncInstagramPosts;
export const processTryOnJob = processTryOnJobTrigger;
