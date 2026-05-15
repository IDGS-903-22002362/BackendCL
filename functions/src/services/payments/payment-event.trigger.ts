import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { STORE_FIRESTORE_DATABASE } from "../../config/firestore.constants";
import { PAYMENT_EVENT_SECRETS } from "../../config/runtime-secrets";
import logger from "../../utils/logger";
import paymentEventProcessingService from "./payment-event-processing.service";

const triggerLogger = logger.child({
  component: "payment-event-trigger",
  database: STORE_FIRESTORE_DATABASE,
});

export const processPaymentEventTrigger = onDocumentCreated(
  {
    document: "paymentEventLogs/{eventId}",
    database: STORE_FIRESTORE_DATABASE,
    region: process.env.GCP_REGION || "us-central1",
    timeoutSeconds: 180,
    memory: "512MiB",
    secrets: [...PAYMENT_EVENT_SECRETS],
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
