import { onSchedule } from "firebase-functions/v2/scheduler";
import inventoryReservationService from "./services/inventory-reservation.service";
import checkoutAttemptService from "./services/checkout/checkout-attempt.service";
import { API_RUNTIME_SECRETS } from "./config/runtime-secrets";

/**
 * Expira reservas de inventario, intentos de checkout obsoletos y reconcilia
 * inconsistencias entre reservas, intentos y órdenes pagadas.
 */
export const expireInventoryReservations = onSchedule(
  {
    schedule: "every 5 minutes",
    timeZone: "America/Mexico_City",
    region: process.env.GCP_REGION || "us-central1",
    timeoutSeconds: 300,
    memory: "512MiB",
    secrets: [...API_RUNTIME_SECRETS],
  },
  async () => {
    const expiredReservations =
      await inventoryReservationService.expireDueReservations(200);
    const expiredAttempts = await checkoutAttemptService.expireStaleAttempts();
    const stalePaymentPending =
      await checkoutAttemptService.reconcileStalePaymentPendingAttempts(50);
    const orphanReservations =
      await inventoryReservationService.repairOrphanActiveReservations(100);
    const reconciled =
      await inventoryReservationService.reconcilePaidOrdersWithoutSale(25);

    console.log(
      `[inventory-cron] reservas vencidas: ${expiredReservations.reservations} ` +
        `(checkout: ${expiredReservations.checkoutAttempts}, órdenes: ${expiredReservations.orders}), ` +
        `intentos checkout expirados: ${expiredAttempts}, ` +
        `payment_pending obsoletos: ${stalePaymentPending}, ` +
        `reservas huérfanas detectadas: ${orphanReservations.detected}, ` +
        `reservas huérfanas reparadas: ${orphanReservations.repaired}, ` +
        `órdenes reconciliadas: ${reconciled}`,
    );
  },
);
