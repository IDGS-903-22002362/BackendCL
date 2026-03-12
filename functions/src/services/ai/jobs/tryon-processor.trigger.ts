import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { assertAiConfig } from "../../../config/ai.config";
import tryOnWorkflowService from "./tryon-workflow.service";

export const processTryOnJobTrigger = onDocumentCreated(
  {
    document: "tryon_jobs/{jobId}",
    region: process.env.GCP_REGION || "us-central1",
    secrets: [
      "GCP_PROJECT_ID",
      "GCP_REGION",
      "VERTEX_TRYON_MODEL",
      "AI_STORAGE_BUCKET",
      "GCS_TRYON_BUCKET",
    ],
    timeoutSeconds: 300,
    memory: "1GiB",
    serviceAccount: "vertex-tryon-sa@e-comerce-leon.iam.gserviceaccount.com",
  },
  async (event) => {
    assertAiConfig({ requireGemini: false, requireTryOn: true });
    const jobId = event.params.jobId;
    await tryOnWorkflowService.processQueuedJob(jobId);
  },
);
