import { onDocumentCreated } from "firebase-functions/v2/firestore";
import tryOnWorkflowService from "./tryon-workflow.service";

export const processTryOnJobTrigger = onDocumentCreated(
  {
    document: "tryon_jobs/{jobId}",
    region: process.env.GCP_REGION || "us-central1",
    timeoutSeconds: 300,
    memory: "1GiB",
    serviceAccount: "vertex-tryon-sa@e-comerce-leon.iam.gserviceaccount.com",
  },
  async (event) => {
    const jobId = event.params.jobId;
    await tryOnWorkflowService.processQueuedJob(jobId);
  },
);
