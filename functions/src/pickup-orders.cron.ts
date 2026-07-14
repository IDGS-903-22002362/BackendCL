import { onSchedule } from "firebase-functions/v2/scheduler";
import { AUTH_SECRETS } from "./config/runtime-secrets";
import pickupOrderService from "./services/pickup-order.service";

export const expirePickupOrders = onSchedule(
  {
    schedule: "every 60 minutes",
    timeZone: "America/Mexico_City",
    region: process.env.GCP_REGION || "us-central1",
    timeoutSeconds: 300,
    memory: "256MiB",
    secrets: [...AUTH_SECRETS],
  },
  async () => {
    // Caducidad deshabilitada: expireOverduePickups es no-op.
    const result = await pickupOrderService.expireOverduePickups();
    console.info("pickup_expiration_skipped", result);
  },
);
