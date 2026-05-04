import { onSchedule } from "firebase-functions/v2/scheduler";
import paymentReconciliationService from "./services/payments/payment-reconciliation.service";

const APLAZO_PAYMENT_SECRETS = [
  "APLAZO_ENABLED",
  "APLAZO_ENV",
  "APLAZO_INTEGRATION_VERSION",
  "APLAZO_ONLINE_ENABLED",
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
  "APLAZO_ONLINE_CANCEL_PATH",
  "APLAZO_ONLINE_REFUND_PATH",
  "APLAZO_ONLINE_REFUND_STATUS_PATH",
] as const;

export const reconcileAplazoPayments = onSchedule(
  {
    schedule: "every 5 minutes",
    timeZone: "America/Mexico_City",
    region: process.env.GCP_REGION || "us-central1",
    timeoutSeconds: 300,
    memory: "512MiB",
    secrets: [...APLAZO_PAYMENT_SECRETS],
  },
  async () => {
    await paymentReconciliationService.runScheduledReconciliation();
  },
);
