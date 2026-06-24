import * as functions from "firebase-functions/v1";
import inventoryReservationService from "./services/inventory-reservation.service";
import checkoutAttemptService from "./services/checkout/checkout-attempt.service";

export const expireInventoryReservations = functions.pubsub
  .schedule("every 5 minutes")
  .timeZone("America/Mexico_City")
  .onRun(async () => {
    const expiredOrders = await inventoryReservationService.expireDueReservations(
      200,
    );
    const expiredAttempts = await checkoutAttemptService.expireStaleAttempts();
    const reconciled =
      await inventoryReservationService.reconcilePaidOrdersWithoutSale(25);

    console.log(
      `[inventory-cron] reservas expiradas: ${expiredOrders}, intentos checkout expirados: ${expiredAttempts}, órdenes reconciliadas: ${reconciled}`,
    );
    return null;
  });
