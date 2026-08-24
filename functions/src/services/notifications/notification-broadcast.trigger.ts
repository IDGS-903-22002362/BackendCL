import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { STORE_FIRESTORE_DATABASE } from "../../config/firestore.constants";
import { NOTIFICATION_SCHEDULER_SECRETS } from "../../config/runtime-secrets";
import logger from "../../utils/logger";
import notificationBroadcastWorkerService from "./notification-broadcast-worker.service";

const triggerLogger = logger.child({
  component: "notification-broadcast-trigger",
});

export const processBroadcastChunkTrigger = onDocumentCreated(
  {
    document: "notificacionBroadcastLotes/{chunkId}",
    database: STORE_FIRESTORE_DATABASE,
    region: process.env.GCP_REGION || "us-central1",
    timeoutSeconds: 300,
    memory: "512MiB",
    secrets: [...NOTIFICATION_SCHEDULER_SECRETS],
  },
  async (event) => {
    const chunkId = event.params.chunkId;

    triggerLogger.info("notification_broadcast_chunk_received", {
      chunkId,
      database: event.database,
    });

    await notificationBroadcastWorkerService.processChunk(chunkId);
  },
);

export default processBroadcastChunkTrigger;
