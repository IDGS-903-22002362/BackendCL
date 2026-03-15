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
import {
  enqueueAbandonedCartNotifications,
  enqueueCampaignNotifications,
  enqueueInactiveUserNotifications,
  enqueueProbableRepurchaseNotifications,
} from "./notifications.cron";
import { processNotificationEventTrigger } from "./services/notifications/notification-processor.trigger";

let apiAiConfigValidated = false;

const validateApiAiConfigOnce = (): void => {
  if (apiAiConfigValidated) {
    return;
  }

  assertAiConfig({ requireGemini: true, requireTryOn: true });
  console.log("AI runtime config validated:", getAiRuntimeSummary());
  apiAiConfigValidated = true;
};

// Exportar la API de Express como una Cloud Function HTTPS
// Los secrets se inyectan automáticamente como process.env.* en runtime
export const api = onRequest(
  {
    memory: "1GiB",
    secrets: [
      "STRIPE_SECRET_KEY",
      "STRIPE_WEBHOOK_SECRET",
      "STRIPE_PUBLISHABLE_KEY",
      "STRIPE_CURRENCY",
      "APP_URL",
      "JWT_SECRET",
      "WEB_API_KEY",
      "GEMINI_API_KEY",
      "GOOGLE_API_KEY",
      "GCP_PROJECT_ID",
      "GCP_REGION",
      "VERTEX_TRYON_MODEL",
      "AI_PREVIEW_MOCKUP_MODEL",
      "AI_PREVIEW_MOCKUP_API_VERSION",
      "AI_PREVIEW_MOCKUP_TIMEOUT_MS",
      "AI_PREVIEW_MOCKUP_FALLBACK_MODEL",
      "AI_PREVIEW_MOCKUP_FALLBACK_REGION",
      "AI_PREVIEW_MOCKUP_FALLBACK_API_VERSION",
      "AI_PUBLIC_CHAT_ENABLED",
      "AI_PUBLIC_CHAT_RATE_LIMIT_WINDOW_MS",
      "AI_PUBLIC_CHAT_RATE_LIMIT_MAX",
      "NOTIFICATIONS_DEFAULT_TIMEZONE",
      "NOTIFICATIONS_DEFAULT_LOCALE",
      "NOTIFICATIONS_QUIET_HOURS_ENABLED",
      "NOTIFICATIONS_QUIET_HOURS_START",
      "NOTIFICATIONS_QUIET_HOURS_END",
      "NOTIFICATIONS_MARKETING_MAX_PER_DAY",
      "NOTIFICATIONS_CART_ABANDONED_MINUTES",
      "NOTIFICATIONS_CART_COOLDOWN_HOURS",
      "NOTIFICATIONS_PRICE_DROP_COOLDOWN_DAYS",
      "NOTIFICATIONS_PRODUCT_INTEREST_LOOKBACK_DAYS",
      "NOTIFICATIONS_ORDER_LOOKBACK_DAYS",
      "NOTIFICATIONS_INACTIVE_USER_DAYS",
      "NOTIFICATIONS_PROBABLE_REPURCHASE_DAYS",
      "NOTIFICATIONS_CAMPAIGN_COOLDOWN_HOURS",
      "NOTIFICATIONS_ABANDONED_CART_BATCH_SIZE",
      "NOTIFICATIONS_INACTIVE_USERS_BATCH_SIZE",
      "NOTIFICATIONS_CAMPAIGN_BATCH_SIZE",
      "NOTIFICATIONS_REPURCHASE_BATCH_SIZE",
      "AI_NOTIFICATION_PROMPT_VERSION",
      "AI_STORAGE_BUCKET",
      "GCS_TRYON_BUCKET",
      "STORE_PUBLIC_BASE_URL",
      "STORE_PRODUCT_PATH_TEMPLATE",
      "AI_STORE_MAPS_URL",
    ],
    invoker: "public",
  },
  (req, res) => {
    validateApiAiConfigOnce();
    app(req, res);
  },
);

export const lowStockDailyDigest = sendLowStockDailyDigest;
//exportación de funcion
export const syncInstagramPostsFunction = syncInstagramPosts;
export const processTryOnJob = processTryOnJobTrigger;
export const processNotificationEvent = processNotificationEventTrigger;
export const abandonedCartNotifications = enqueueAbandonedCartNotifications;
export const inactiveUserNotifications = enqueueInactiveUserNotifications;
export const campaignNotifications = enqueueCampaignNotifications;
export const probableRepurchaseNotifications =
  enqueueProbableRepurchaseNotifications;
