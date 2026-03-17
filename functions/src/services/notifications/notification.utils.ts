import crypto from "crypto";
import {
  NotificationCategory,
  NotificationEntityType,
  NotificationEventType,
  NotificationPriority,
} from "../../models/notificacion.model";

export const buildNotificationFingerprint = (...parts: Array<unknown>): string =>
  crypto
    .createHash("sha256")
    .update(
      parts
        .map((part) =>
          typeof part === "string" ? part.trim() : JSON.stringify(part ?? null),
        )
        .join("|"),
    )
    .digest("hex");

export const resolveNotificationCategory = (
  eventType: NotificationEventType,
): NotificationCategory => {
  switch (eventType) {
    case "order_created":
    case "order_confirmed":
    case "order_shipped":
    case "order_delivered":
      return "order";
    case "cart_abandoned":
      return "cart";
    case "product_restocked":
      return "restock";
    case "price_drop":
      return "price_drop";
    case "promo_campaign":
      return "promo";
    case "matchday_campaign":
      return "matchday";
    case "inactive_user":
      return "reactivation";
    case "probable_repurchase":
      return "recommendation";
    case "manual_test":
      return "test";
    default:
      return "promo";
  }
};

export const resolveNotificationPriority = (
  eventType: NotificationEventType,
): NotificationPriority => {
  switch (eventType) {
    case "order_confirmed":
    case "order_shipped":
    case "order_delivered":
      return "high";
    default:
      return "normal";
  }
};

export const resolveNotificationEntity = (
  eventType: NotificationEventType,
  input: {
    orderId?: string;
    productId?: string;
    cartId?: string;
    campaignId?: string;
    promoId?: string;
    userId: string;
  },
): { entityType: NotificationEntityType; entityId: string } => {
  switch (eventType) {
    case "order_created":
    case "order_confirmed":
    case "order_shipped":
    case "order_delivered":
      if (!input.orderId) {
        throw new Error("orderId es requerido para eventos de orden");
      }
      return { entityType: "order", entityId: input.orderId };
    case "product_restocked":
    case "price_drop":
      if (!input.productId) {
        throw new Error("productId es requerido para eventos de producto");
      }
      return { entityType: "product", entityId: input.productId };
    case "cart_abandoned":
      if (!input.cartId) {
        throw new Error("cartId es requerido para cart_abandoned");
      }
      return { entityType: "cart", entityId: input.cartId };
    case "promo_campaign":
      return {
        entityType: input.promoId ? "promo" : "campaign",
        entityId: input.promoId || input.campaignId || "promo_campaign",
      };
    case "matchday_campaign":
      return {
        entityType: "campaign",
        entityId: input.campaignId || "matchday_campaign",
      };
    case "inactive_user":
    case "probable_repurchase":
    case "manual_test":
      return { entityType: "user", entityId: input.userId };
    default:
      return { entityType: "notification", entityId: input.userId };
  }
};

export const buildNotificationDeepLink = (
  entityType: NotificationEntityType,
  entityId: string,
): { deeplink: string; screen: string } => {
  switch (entityType) {
    case "product":
      return {
        deeplink: `clubleon://shop/product/${entityId}`,
        screen: "product_detail",
      };
    case "order":
      return {
        deeplink: `clubleon://shop/order/${entityId}`,
        screen: "order_detail",
      };
    case "cart":
      return {
        deeplink: "clubleon://shop/cart",
        screen: "cart",
      };
    case "promo":
      return {
        deeplink: `clubleon://shop/promo/${entityId}`,
        screen: "promo_detail",
      };
    case "campaign":
      return {
        deeplink: `clubleon://shop/campaign/${entityId}`,
        screen: "campaign_detail",
      };
    case "user":
      return {
        deeplink: "clubleon://shop/home",
        screen: "home",
      };
    default:
      return {
        deeplink: "clubleon://shop/home",
        screen: "home",
      };
  }
};

const getLocalDateParts = (
  date: Date,
  timezone: string,
): { year: string; month: string; day: string; hour: number } => {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  const getPart = (type: string) =>
    parts.find((item) => item.type === type)?.value || "00";

  return {
    year: getPart("year"),
    month: getPart("month"),
    day: getPart("day"),
    hour: Number(getPart("hour")),
  };
};

export const getNotificationHourForTimezone = (
  date: Date,
  timezone: string,
): number => getLocalDateParts(date, timezone).hour;

export const getNotificationDayKey = (
  date: Date,
  timezone: string,
): string => {
  const parts = getLocalDateParts(date, timezone);
  return `${parts.year}-${parts.month}-${parts.day}`;
};

export const isWithinQuietHours = (
  date: Date,
  timezone: string,
  quietHours: { enabled: boolean; startHour: number; endHour: number },
): boolean => {
  if (!quietHours.enabled) {
    return false;
  }

  const hour = getNotificationHourForTimezone(date, timezone);
  const { startHour, endHour } = quietHours;

  if (startHour === endHour) {
    return true;
  }

  if (startHour < endHour) {
    return hour >= startHour && hour < endHour;
  }

  return hour >= startHour || hour < endHour;
};

export const isTransactionalNotification = (
  eventType: NotificationEventType,
): boolean =>
  eventType === "order_created" ||
  eventType === "order_confirmed" ||
  eventType === "order_shipped" ||
  eventType === "order_delivered";
