import * as functions from "firebase-functions/v1";
import inventoryService from "./services/inventory.service";
import stockAlertService from "./services/stock-alert.service";

export const sendLowStockDailyDigest = functions.pubsub
  .schedule("every day 08:00")
  .timeZone("America/Mexico_City")
  .onRun(async () => {
    const dashboard = await inventoryService.listLowStockAlerts({
      limit: 200,
      soloCriticas: false,
    });

    await stockAlertService.notifyDailyDigest(dashboard.alertas);
    return null;
  });
