import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { STORE_FIRESTORE_DATABASE } from "../../config/firestore.constants";
import logger from "../../utils/logger";
import notificationProcessingService from "./notification-processing.service";

const triggerLogger = logger.child({
  component: "notification-processor-trigger",
});

export const processNotificationEventTrigger = onDocumentCreated(
  {
    document: "notificacionEventos/{eventId}",
    database: STORE_FIRESTORE_DATABASE,
    region: process.env.GCP_REGION || "us-central1",
    timeoutSeconds: 180,
    memory: "512MiB",
    secrets: [
      "GEMINI_API_KEY",
      "GOOGLE_API_KEY",
      "GCP_PROJECT_ID",
      "GCP_REGION",
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
    ],
  },
  async (event) => {
    const eventId = event.params.eventId;
    triggerLogger.info("notification_trigger_received", {
      eventId,
      database: event.database,
      document: event.document,
    });

    await notificationProcessingService.processQueuedEvent(eventId);
  },
);

export default processNotificationEventTrigger;
