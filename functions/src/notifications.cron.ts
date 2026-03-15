import * as functions from "firebase-functions/v1";
import notificationSchedulerService from "./services/notifications/notification-scheduler.service";

export const enqueueAbandonedCartNotifications = functions.pubsub
  .schedule("every 60 minutes")
  .timeZone("America/Mexico_City")
  .onRun(async () => {
    await notificationSchedulerService.enqueueAbandonedCarts();
    return null;
  });

export const enqueueInactiveUserNotifications = functions.pubsub
  .schedule("every day 10:00")
  .timeZone("America/Mexico_City")
  .onRun(async () => {
    await notificationSchedulerService.enqueueInactiveUsers();
    return null;
  });

export const enqueueCampaignNotifications = functions.pubsub
  .schedule("every 15 minutes")
  .timeZone("America/Mexico_City")
  .onRun(async () => {
    await notificationSchedulerService.enqueueActiveCampaigns();
    return null;
  });

export const enqueueProbableRepurchaseNotifications = functions.pubsub
  .schedule("every day 11:00")
  .timeZone("America/Mexico_City")
  .onRun(async () => {
    await notificationSchedulerService.enqueueProbableRepurchases();
    return null;
  });
