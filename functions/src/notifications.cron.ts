import * as functions from "firebase-functions/v1";
import { NOTIFICATION_SCHEDULER_SECRETS } from "./config/runtime-secrets";
import notificationSchedulerService from "./services/notifications/notification-scheduler.service";

const schedulerRuntime = functions.runWith({
  secrets: [...NOTIFICATION_SCHEDULER_SECRETS],
});

export const enqueueAbandonedCartNotifications = schedulerRuntime.pubsub
  .schedule("every 60 minutes")
  .timeZone("America/Mexico_City")
  .onRun(async () => {
    await notificationSchedulerService.enqueueAbandonedCarts();
    return null;
  });

export const enqueueInactiveUserNotifications = schedulerRuntime.pubsub
  .schedule("every day 10:00")
  .timeZone("America/Mexico_City")
  .onRun(async () => {
    await notificationSchedulerService.enqueueInactiveUsers();
    return null;
  });

export const enqueueCampaignNotifications = schedulerRuntime.pubsub
  .schedule("every 15 minutes")
  .timeZone("America/Mexico_City")
  .onRun(async () => {
    await notificationSchedulerService.enqueueActiveCampaigns();
    return null;
  });

export const enqueueProbableRepurchaseNotifications = schedulerRuntime.pubsub
  .schedule("every day 11:00")
  .timeZone("America/Mexico_City")
  .onRun(async () => {
    await notificationSchedulerService.enqueueProbableRepurchases();
    return null;
  });

export const enqueueProductRatingReminderNotifications = schedulerRuntime.pubsub
  .schedule("every day 12:00")
  .timeZone("America/Mexico_City")
  .onRun(async () => {
    await notificationSchedulerService.enqueueProductRatingReminders();
    return null;
  });
