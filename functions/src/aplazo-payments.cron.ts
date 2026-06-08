import { onSchedule } from "firebase-functions/v2/scheduler";
import paymentReconciliationService from "./services/payments/payment-reconciliation.service";
import { PAYMENT_EVENT_SECRETS } from "./config/runtime-secrets";

export const reconcileAplazoPayments = onSchedule(
  {
    schedule: "every 5 minutes",
    timeZone: "America/Mexico_City",
    region: process.env.GCP_REGION || "us-central1",
    timeoutSeconds: 300,
    memory: "512MiB",
    secrets: [...PAYMENT_EVENT_SECRETS],
  },
  async () => {
    await paymentReconciliationService.runScheduledReconciliation();
  },
);
