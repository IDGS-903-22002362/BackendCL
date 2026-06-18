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
import { reconcileAplazoPayments } from "./aplazo-payments.cron";
import { expirePickupOrders } from "./pickup-orders.cron";
import {
  enqueueAbandonedCartNotifications,
  enqueueCampaignNotifications,
  enqueueInactiveUserNotifications,
  enqueueProductRatingReminderNotifications,
  enqueueProbableRepurchaseNotifications,
} from "./notifications.cron";
import { processNotificationEventTrigger } from "./services/notifications/notification-processor.trigger";
import { processPaymentEventTrigger } from "./services/payments/payment-event.trigger";
import { API_RUNTIME_SECRETS } from "./config/runtime-secrets";
import { scheduledAccountDeletion } from "./deletion-scheduler.function";
import { syncLigaMxData } from "./liga-mx.cron";
import { syncUserLevelOnPointsChange } from "./puntos-nivel.trigger";

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
    invoker: "public",
    secrets: [...API_RUNTIME_SECRETS],
  },
  (req, res) => {
    validateApiAiConfigOnce();
    app(req, res);
  },
);

export const lowStockDailyDigest = sendLowStockDailyDigest;
//exportación de funcion
export const syncInstagramPostsFunction = syncInstagramPosts;
export const scheduledAccountDeletionFunction = scheduledAccountDeletion;
export const processTryOnJob = processTryOnJobTrigger;
export const processNotificationEvent = processNotificationEventTrigger;
export const processPaymentEvent = processPaymentEventTrigger;
export const reconcileAplazoPaymentsFunction = reconcileAplazoPayments;
export const expirePickupOrdersFunction = expirePickupOrders;
export const abandonedCartNotifications = enqueueAbandonedCartNotifications;
export const inactiveUserNotifications = enqueueInactiveUserNotifications;
export const campaignNotifications = enqueueCampaignNotifications;
export const probableRepurchaseNotifications =
  enqueueProbableRepurchaseNotifications;
export const productRatingReminderNotifications =
  enqueueProductRatingReminderNotifications;
export const userLevelSyncFunction = syncUserLevelOnPointsChange;
export const syncLigaMxDataFunction = syncLigaMxData;
