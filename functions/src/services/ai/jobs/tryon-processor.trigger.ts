import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { assertAiConfig } from "../../../config/ai.config";
import { STORE_FIRESTORE_DATABASE } from "../../../config/firestore.constants";
import logger from "../../../utils/logger";
import tryOnWorkflowService from "./tryon-workflow.service";

const triggerLogger = logger.child({ component: "tryon-processor-trigger" });

export const processTryOnJobTrigger = onDocumentCreated(
  {
    document: "tryon_jobs/{jobId}",
    database: STORE_FIRESTORE_DATABASE,
    region: process.env.GCP_REGION || "us-central1",
    timeoutSeconds: 300,
    memory: "1GiB",
    serviceAccount: "vertex-tryon-sa@e-comerce-leon.iam.gserviceaccount.com",
  },
  async (event) => {
    assertAiConfig({
      requireGemini: false,
      requireTryOn: true,
      requirePreviewMockup: true,
    });
    const jobId = event.params.jobId;
    triggerLogger.info("tryon_trigger_received", {
      jobId,
      database: STORE_FIRESTORE_DATABASE,
      eventDatabase: event.database,
      document: event.document,
    });
    await tryOnWorkflowService.processQueuedJob(jobId);
  },
);
