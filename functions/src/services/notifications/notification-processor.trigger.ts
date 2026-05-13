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
