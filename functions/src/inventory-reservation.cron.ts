import * as functions from "firebase-functions/v1";
import inventoryReservationService from "./services/inventory-reservation.service";
import checkoutAttemptService from "./services/checkout/checkout-attempt.service";

export const expireInventoryReservations = functions.pubsub
  .schedule("every 5 minutes")
  .timeZone("America/Mexico_City")
  .onRun(async () => {
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
    return null;
  });
