import { Timestamp } from "firebase-admin/firestore";
import notificationConfig from "../../config/notification.config";
import { firestoreTienda } from "../../config/firebase";
import {
  NotificationDeliveryRecord,
  NotificationEligibilityResult,
  NotificationEvent,
} from "../../models/notificacion.model";
import { EstadoOrden, Orden } from "../../models/orden.model";
import { Producto } from "../../models/producto.model";
import logger from "../../utils/logger";
import { notificationCollections } from "./collections";
import deviceTokenService from "./device-token.service";
import notificationPreferencesService from "./notification-preferences.service";
import notificationUserContextService from "./user-context.service";
import {
  getNotificationDayKey,
  isTransactionalNotification,
  isWithinQuietHours,
} from "./notification.utils";

const PRODUCTOS_COLLECTION = "productos";
const ORDENES_COLLECTION = "ordenes";
const CARRITOS_COLLECTION = "carritos";

class NotificationEligibilityService {
  private readonly baseLogger = logger.child({
    component: "notification-eligibility-service",
  });

  private isMarketingLikeEvent(event: NotificationEvent): boolean {
    return (
      event.eventType === "promo_campaign" ||
      event.eventType === "matchday_campaign" ||
      event.eventType === "inactive_user" ||
      event.eventType === "probable_repurchase"
    );
  }

  private async loadUserDeliveries(
    userId: string,
  ): Promise<NotificationDeliveryRecord[]> {
    const snapshot = await firestoreTienda
      .collection(notificationCollections.deliveries)
      .where("userId", "==", userId)
      .get();

    return snapshot.docs.map((doc) => ({
      id: doc.id,
      ...(doc.data() as NotificationDeliveryRecord),
    }));
  }

  private findLatestDelivery(
    deliveries: NotificationDeliveryRecord[],
    matcher: (delivery: NotificationDeliveryRecord) => boolean,
  ): NotificationDeliveryRecord | null {
    return deliveries
      .filter(matcher)
      .sort(
        (left, right) =>
          (right.sentAt?.toMillis?.() || right.createdAt?.toMillis?.() || 0) -
          (left.sentAt?.toMillis?.() || left.createdAt?.toMillis?.() || 0),
      )[0] || null;
  }

  private async validateEventRelevance(
    event: NotificationEvent,
  ): Promise<{ allowed: boolean; reason?: string }> {
    switch (event.eventType) {
      case "order_created":
      case "order_confirmed":
      case "order_shipped":
      case "order_delivered": {
        const orderSnapshot = await firestoreTienda
          .collection(ORDENES_COLLECTION)
          .doc(event.orderId || "")
          .get();

        if (!orderSnapshot.exists) {
          return { allowed: false, reason: "order_not_found" };
        }

        const order = orderSnapshot.data() as Orden;
        if (order.estado === EstadoOrden.CANCELADA) {
          return { allowed: false, reason: "order_cancelled" };
        }

        if (
          event.eventType === "order_confirmed" &&
          ![
            EstadoOrden.CONFIRMADA,
            EstadoOrden.EN_PROCESO,
            EstadoOrden.ENVIADA,
            EstadoOrden.ENTREGADA,
          ].includes(order.estado)
        ) {
          return { allowed: false, reason: "order_not_confirmed" };
        }

        if (
          event.eventType === "order_shipped" &&
          ![EstadoOrden.ENVIADA, EstadoOrden.ENTREGADA].includes(order.estado)
        ) {
          return { allowed: false, reason: "order_not_shipped" };
        }

        if (
          event.eventType === "order_delivered" &&
          order.estado !== EstadoOrden.ENTREGADA
        ) {
          return { allowed: false, reason: "order_not_delivered" };
        }

        return { allowed: true };
      }
      case "product_restocked":
      case "price_drop": {
        const productSnapshot = await firestoreTienda
          .collection(PRODUCTOS_COLLECTION)
          .doc(event.productId || "")
          .get();

        if (!productSnapshot.exists) {
          return { allowed: false, reason: "product_not_found" };
        }

        const product = productSnapshot.data() as Producto;
        if (!product.activo) {
          return { allowed: false, reason: "product_inactive" };
        }

        if (event.eventType === "product_restocked" && product.existencias <= 0) {
          return { allowed: false, reason: "product_out_of_stock" };
        }

        if (event.eventType === "price_drop") {
          const expectedPrice = Number(event.sourceData?.precioNuevo);
          if (Number.isFinite(expectedPrice) && product.precioPublico > expectedPrice) {
            return { allowed: false, reason: "price_not_current" };
          }
        }

        return { allowed: true };
      }
      case "cart_abandoned": {
        const cartSnapshot = await firestoreTienda
          .collection(CARRITOS_COLLECTION)
          .doc(event.cartId || "")
          .get();

        if (!cartSnapshot.exists) {
          return { allowed: false, reason: "cart_not_found" };
        }

        const cart = cartSnapshot.data() as {
          usuarioId?: string;
          items?: unknown[];
          updatedAt?: Timestamp;
        };

        if (!cart.usuarioId || cart.usuarioId !== event.userId) {
          return { allowed: false, reason: "cart_not_owned" };
        }

        if (!Array.isArray(cart.items) || cart.items.length === 0) {
          return { allowed: false, reason: "cart_empty" };
        }

        const cutoff = Date.now() -
          notificationConfig.windows.cartAbandonedMinutes * 60 * 1000;
        if ((cart.updatedAt?.toMillis?.() || 0) > cutoff) {
          return { allowed: false, reason: "cart_recently_updated" };
        }

        return { allowed: true };
      }
      case "inactive_user": {
        const userData = await notificationUserContextService.getUserData(
          event.userId,
        );
        if (!userData || userData.activo === false) {
          return { allowed: false, reason: "user_inactive_or_missing" };
        }

        const cutoff = Date.now() -
          notificationConfig.windows.inactiveUserDays * 24 * 60 * 60 * 1000;
        const updatedAtMillis =
          userData.updatedAt instanceof Timestamp
            ? userData.updatedAt.toMillis()
            : 0;

        if (updatedAtMillis > cutoff) {
          return { allowed: false, reason: "user_recently_active" };
        }

        return { allowed: true };
      }
      case "promo_campaign":
      case "matchday_campaign": {
        if (!event.campaignId) {
          return { allowed: true };
        }

        const campaignSnapshot = await firestoreTienda
          .collection(notificationCollections.campaigns)
          .doc(event.campaignId)
          .get();

        if (!campaignSnapshot.exists) {
          return { allowed: false, reason: "campaign_not_found" };
        }

        const campaign = campaignSnapshot.data() as {
          active?: boolean;
          startsAt?: Timestamp;
          endsAt?: Timestamp;
        };
        const now = Date.now();

        if (campaign.active === false) {
          return { allowed: false, reason: "campaign_inactive" };
        }

        if (campaign.startsAt?.toMillis?.() && campaign.startsAt.toMillis() > now) {
          return { allowed: false, reason: "campaign_not_started" };
        }

        if (campaign.endsAt?.toMillis?.() && campaign.endsAt.toMillis() < now) {
          return { allowed: false, reason: "campaign_expired" };
        }

        return { allowed: true };
      }
      case "probable_repurchase":
        return { allowed: true };
      case "manual_test":
      default:
        return { allowed: true };
    }
  }

  async evaluate(event: NotificationEvent): Promise<NotificationEligibilityResult> {
    const preference = await notificationPreferencesService.getPreferences(
      event.userId,
    );

    if (!notificationPreferencesService.isEventEnabled(preference, event.eventType)) {
      return {
        allowed: false,
        reason: "preferences_disabled",
        devices: [],
        preference,
        localDayKey: getNotificationDayKey(
          new Date(),
          preference.timezone || notificationConfig.defaults.timezone,
        ),
        timezone: preference.timezone || notificationConfig.defaults.timezone,
      };
    }

    const devices = await deviceTokenService.getActiveTokens(event.userId);
    if (devices.length === 0) {
      return {
        allowed: false,
        reason: "no_active_tokens",
        devices: [],
        preference,
        localDayKey: getNotificationDayKey(
          new Date(),
          preference.timezone || notificationConfig.defaults.timezone,
        ),
        timezone: preference.timezone || notificationConfig.defaults.timezone,
      };
    }

    const timezone =
      preference.timezone ||
      devices[0]?.timezone ||
      notificationConfig.defaults.timezone;
    const now = new Date();
    const localDayKey = getNotificationDayKey(now, timezone);

    if (
      !isTransactionalNotification(event.eventType) &&
      isWithinQuietHours(now, timezone, preference.quietHours)
    ) {
      return {
        allowed: false,
        reason: "quiet_hours",
        devices,
        preference,
        localDayKey,
        timezone,
      };
    }

    const duplicateSnapshot = await firestoreTienda
      .collection(notificationCollections.deliveries)
      .where("fingerprint", "==", event.fingerprint)
      .get();

    if (
      duplicateSnapshot.docs.some((doc) => {
        const delivery = doc.data() as NotificationDeliveryRecord;
        return delivery.status === "sent";
      })
    ) {
      return {
        allowed: false,
        reason: "duplicate_delivery",
        devices,
        preference,
        localDayKey,
        timezone,
      };
    }

    const userDeliveries = await this.loadUserDeliveries(event.userId);

    if (this.isMarketingLikeEvent(event)) {
      const sentToday = userDeliveries.filter((delivery) => {
        return (
          delivery.channel === "push" &&
          delivery.status === "sent" &&
          delivery.localDayKey === localDayKey &&
          ["promo", "matchday", "reactivation", "recommendation"].includes(
            delivery.category,
          )
        );
      }).length;

      if (sentToday >= preference.maxMarketingPerDay) {
        return {
          allowed: false,
          reason: "marketing_cap_reached",
          devices,
          preference,
          localDayKey,
          timezone,
        };
      }
    }

    if (event.eventType === "cart_abandoned") {
      const latestCartReminder = this.findLatestDelivery(
        userDeliveries,
        (delivery) =>
          delivery.eventType === "cart_abandoned" &&
          delivery.status === "sent" &&
          delivery.entityId === event.entityId,
      );

      if (
        latestCartReminder &&
        Date.now() - (latestCartReminder.sentAt?.toMillis?.() || 0) <
          notificationConfig.windows.cartCooldownHours * 60 * 60 * 1000
      ) {
        return {
          allowed: false,
          reason: "cart_cooldown_active",
          devices,
          preference,
          localDayKey,
          timezone,
        };
      }
    }

    if (event.eventType === "price_drop") {
      const latestPriceDrop = this.findLatestDelivery(
        userDeliveries,
        (delivery) =>
          delivery.eventType === "price_drop" &&
          delivery.status === "sent" &&
          delivery.entityId === event.entityId,
      );

      if (
        latestPriceDrop &&
        Date.now() - (latestPriceDrop.sentAt?.toMillis?.() || 0) <
          notificationConfig.windows.priceDropCooldownDays *
            24 *
            60 *
            60 *
            1000
      ) {
        return {
          allowed: false,
          reason: "price_drop_cooldown_active",
          devices,
          preference,
          localDayKey,
          timezone,
        };
      }
    }

    if (event.eventType === "promo_campaign" || event.eventType === "matchday_campaign") {
      const latestCampaignDelivery = this.findLatestDelivery(
        userDeliveries,
        (delivery) =>
          delivery.status === "sent" &&
          delivery.eventType === event.eventType &&
          delivery.entityId === event.entityId,
      );

      if (
        latestCampaignDelivery &&
        Date.now() - (latestCampaignDelivery.sentAt?.toMillis?.() || 0) <
          notificationConfig.windows.campaignCooldownHours * 60 * 60 * 1000
      ) {
        return {
          allowed: false,
          reason: "campaign_cooldown_active",
          devices,
          preference,
          localDayKey,
          timezone,
        };
      }
    }

    const relevance = await this.validateEventRelevance(event);
    if (!relevance.allowed) {
      this.baseLogger.info("notification_event_not_relevant", {
        eventId: event.id,
        eventType: event.eventType,
        userId: event.userId,
        reason: relevance.reason,
      });

      return {
        allowed: false,
        reason: relevance.reason,
        devices,
        preference,
        localDayKey,
        timezone,
      };
    }

    return {
      allowed: true,
      devices,
      preference,
      localDayKey,
      timezone,
    };
  }
}

export const notificationEligibilityService =
  new NotificationEligibilityService();
export default notificationEligibilityService;
