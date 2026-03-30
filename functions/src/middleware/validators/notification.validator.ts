import { z } from "zod";
import {
  NotificationDeliveryMode,
  NotificationEventType,
} from "../../models/notificacion.model";

const notificationEventTypeEnum: [NotificationEventType, ...NotificationEventType[]] =
  [
    "order_created",
    "order_confirmed",
    "order_shipped",
    "order_delivered",
    "cart_abandoned",
    "product_restocked",
    "price_drop",
    "product_rating_reminder",
    "inactive_user",
    "promo_campaign",
    "matchday_campaign",
    "probable_repurchase",
    "manual_test",
  ];

const notificationDeliveryModeEnum: [
  NotificationDeliveryMode,
  ...NotificationDeliveryMode[],
] = ["token", "topic"];

export const deviceIdParamSchema = z
  .object({
    deviceId: z
      .string()
      .trim()
      .min(1, "deviceId es requerido")
      .max(120, "deviceId es demasiado largo"),
  })
  .strict();

const deviceTokenBaseSchema = z
  .object({
    deviceId: z.string().trim().min(1).max(120),
    token: z.string().trim().min(20).max(4096),
    platform: z.enum(["ios", "android", "web"]),
    locale: z.string().trim().min(2).max(20).optional(),
    timezone: z.string().trim().min(3).max(100).optional(),
    appVersion: z.string().trim().min(1).max(50).optional(),
    buildNumber: z.string().trim().min(1).max(50).optional(),
  })
  .strict();

export const registerDeviceTokenSchema = deviceTokenBaseSchema;

export const updateDeviceTokenSchema = deviceTokenBaseSchema
  .omit({ deviceId: true })
  .extend({
    enabled: z.boolean().optional(),
  })
  .strict();

export const updateNotificationPreferencesSchema = z
  .object({
    pushEnabled: z.boolean().optional(),
    transactionalEnabled: z.boolean().optional(),
    orderUpdatesEnabled: z.boolean().optional(),
    cartRemindersEnabled: z.boolean().optional(),
    restockEnabled: z.boolean().optional(),
    priceDropEnabled: z.boolean().optional(),
    ratingRemindersEnabled: z.boolean().optional(),
    marketingEnabled: z.boolean().optional(),
    matchdayEnabled: z.boolean().optional(),
    reactivationEnabled: z.boolean().optional(),
    recommendationsEnabled: z.boolean().optional(),
    timezone: z.string().trim().min(3).max(100).optional(),
    locale: z.string().trim().min(2).max(20).optional(),
    quietHours: z
      .object({
        enabled: z.boolean().optional(),
        startHour: z.number().int().min(0).max(23).optional(),
        endHour: z.number().int().min(0).max(23).optional(),
      })
      .strict()
      .optional(),
    maxMarketingPerDay: z.number().int().min(0).max(10).optional(),
  })
  .strict();

export const manualNotificationTestSchema = z
  .object({
    userId: z.string().trim().min(1).max(120),
    title: z.string().trim().min(1).max(80),
    body: z.string().trim().min(1).max(180),
    deeplink: z.string().trim().min(1).max(200).optional(),
    screen: z.string().trim().min(1).max(80).optional(),
    priority: z.enum(["normal", "high"]).optional(),
  })
  .strict();

export const enqueueNotificationEventSchema = z
  .object({
    eventType: z.enum(notificationEventTypeEnum),
    userId: z.string().trim().min(1).max(120),
    productId: z.string().trim().min(1).max(120).optional(),
    orderId: z.string().trim().min(1).max(120).optional(),
    cartId: z.string().trim().min(1).max(120).optional(),
    campaignId: z.string().trim().min(1).max(120).optional(),
    promoId: z.string().trim().min(1).max(120).optional(),
    deliveryMode: z.enum(notificationDeliveryModeEnum).optional(),
    topic: z.string().trim().min(1).max(120).optional(),
    priority: z.enum(["normal", "high"]).optional(),
    fingerprintParts: z.array(z.string().trim().min(1)).max(10).optional(),
    sourceData: z.record(z.unknown()).default({}),
    triggerSource: z.string().trim().min(1).max(120).optional(),
  })
  .strict();
