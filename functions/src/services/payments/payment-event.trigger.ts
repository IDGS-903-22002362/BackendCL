import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { STORE_FIRESTORE_DATABASE } from "../../config/firestore.constants";
import logger from "../../utils/logger";
import paymentEventProcessingService from "./payment-event-processing.service";

const triggerLogger = logger.child({
  component: "payment-event-trigger",
  database: STORE_FIRESTORE_DATABASE,
});

const APLAZO_PAYMENT_SECRETS = [
  "APLAZO_ENABLED",
  "APLAZO_ENV",
  "APLAZO_INTEGRATION_VERSION",
  "APLAZO_ONLINE_ENABLED",
  "APLAZO_INSTORE_ENABLED",
  "APLAZO_REFUNDS_ENABLED",
  "APLAZO_RECONCILE_ENABLED",
  "APLAZO_ONLINE_BASE_URL",
  "APLAZO_ONLINE_MERCHANT_BASE_URL",
  "APLAZO_ONLINE_REFUNDS_BASE_URL",
  "APLAZO_ONLINE_MERCHANT_ID",
  "APLAZO_ONLINE_API_TOKEN",
  "APLAZO_ONLINE_WEBHOOK_SECRET",
  "APLAZO_ONLINE_WEBHOOK_AUTH_SCHEME",
  "APLAZO_ONLINE_TIMEOUT_MS",
  "APLAZO_ONLINE_AUTH_PATH",
  "APLAZO_ONLINE_CREATE_PATH",
  "APLAZO_ONLINE_STATUS_PATH",
  "APLAZO_ONLINE_REFUND_PATH",
  "APLAZO_ONLINE_REFUND_STATUS_PATH",
  "APLAZO_INSTORE_BASE_URL",
  "APLAZO_INSTORE_MERCHANT_BASE_URL",
  "APLAZO_INSTORE_MERCHANT_ID",
  "APLAZO_INSTORE_API_TOKEN",
  "APLAZO_INSTORE_WEBHOOK_SECRET",
  "APLAZO_INSTORE_WEBHOOK_AUTH_SCHEME",
  "APLAZO_INSTORE_TIMEOUT_MS",
  "APLAZO_INSTORE_CREATE_PATH",
  "APLAZO_INSTORE_STATUS_PATH",
  "APLAZO_INSTORE_CANCEL_PATH",
  "APLAZO_INSTORE_REFUND_PATH",
  "APLAZO_INSTORE_REFUND_STATUS_PATH",
  "APLAZO_INSTORE_REGISTER_BRANCH_PATH",
  "APLAZO_INSTORE_DEFAULT_COMM_CHANNEL",
] as const;

export const processPaymentEventTrigger = onDocumentCreated(
  {
    document: "paymentEventLogs/{eventId}",
    database: STORE_FIRESTORE_DATABASE,
    region: process.env.GCP_REGION || "us-central1",
    timeoutSeconds: 180,
    memory: "512MiB",
    secrets: [...APLAZO_PAYMENT_SECRETS],
  },
  async (event) => {
    const eventId = event.params.eventId;
    triggerLogger.info("payment_event_trigger_received", {
      eventId,
      document: event.document,
    });

    await paymentEventProcessingService.processQueuedEvent(eventId);
  },
);

export default processPaymentEventTrigger;
