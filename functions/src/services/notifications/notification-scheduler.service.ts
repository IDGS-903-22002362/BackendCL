import { Timestamp } from "firebase-admin/firestore";
import notificationConfig from "../../config/notification.config";
import { firestoreApp } from "../../config/app.firebase";
import { firestoreTienda } from "../../config/firebase";
import {
  NotificationCampaignDocument,
  NotificationEvent,
} from "../../models/notificacion.model";
import { Orden } from "../../models/orden.model";
import { Producto } from "../../models/producto.model";
import logger from "../../utils/logger";
import notificationAudienceService from "./notification-audience.service";
import { notificationCollections } from "./collections";
import notificationEventService from "./notification-event.service";
import productRatingService from "../product-rating.service";

const CARRITOS_COLLECTION = "carritos";
const ORDENES_COLLECTION = "ordenes";
const PRODUCTOS_COLLECTION = "productos";

class NotificationSchedulerService {
  private readonly baseLogger = logger.child({
    component: "notification-scheduler-service",
  });

  private toTimestampFromMinutesAgo(minutes: number): Timestamp {
    return Timestamp.fromDate(new Date(Date.now() - minutes * 60 * 1000));
  }

  private toTimestampFromDaysAgo(days: number): Timestamp {
    return Timestamp.fromDate(
      new Date(Date.now() - days * 24 * 60 * 60 * 1000),
    );
  }

  private toTimestampFromHoursAgo(hours: number): Timestamp {
    return Timestamp.fromDate(new Date(Date.now() - hours * 60 * 60 * 1000));
  }

  async enqueueAbandonedCarts(): Promise<NotificationEvent[]> {
    const cutoff = this.toTimestampFromMinutesAgo(
      notificationConfig.windows.cartAbandonedMinutes,
    );
    const snapshot = await firestoreTienda
      .collection(CARRITOS_COLLECTION)
      .where("updatedAt", "<=", cutoff)
      .limit(notificationConfig.scheduler.abandonedCartBatchSize)
      .get();
    const results: NotificationEvent[] = [];

    for (const doc of snapshot.docs) {
      const cart = doc.data() as {
        usuarioId?: string;
        items?: Array<{ productoId?: string }>;
        updatedAt?: Timestamp;
      };

      if (!cart.usuarioId || !Array.isArray(cart.items) || cart.items.length === 0) {
        continue;
      }

      const event = await notificationEventService.enqueueEvent({
        eventType: "cart_abandoned",
        userId: cart.usuarioId,
        cartId: doc.id,
        sourceData: {
          cartUpdatedAt: cart.updatedAt?.toDate?.().toISOString(),
          itemCount: cart.items.length,
          productIds: cart.items
            .map((item) => item.productoId)
            .filter((value): value is string => typeof value === "string"),
        },
        triggerSource: "scheduler_abandoned_carts",
      });

      results.push(event.event);
    }

    this.baseLogger.info("notification_scheduler_abandoned_carts", {
      totalCandidates: snapshot.size,
      enqueued: results.length,
    });

    return results;
  }

  async enqueueInactiveUsers(): Promise<NotificationEvent[]> {
    const userCutoff = this.toTimestampFromDaysAgo(
      notificationConfig.windows.inactiveUserDays,
    );
    const recentOrdersSnapshot = await firestoreTienda
      .collection(ORDENES_COLLECTION)
      .where("createdAt", ">=", userCutoff)
      .get();
    const recentlyActiveUsers = new Set<string>();

    for (const orderDoc of recentOrdersSnapshot.docs) {
      const order = orderDoc.data() as Orden;
      if (order.usuarioId) {
        recentlyActiveUsers.add(String(order.usuarioId));
      }
    }

    const usersSnapshot = await firestoreApp
      .collection(notificationCollections.users)
      .where("activo", "==", true)
      .limit(notificationConfig.scheduler.inactiveUsersBatchSize * 3)
      .get();
    const results: NotificationEvent[] = [];

    for (const userDoc of usersSnapshot.docs) {
      const userData = userDoc.data() as {
        uid?: string;
        rol?: string;
        updatedAt?: Timestamp;
      };
      const userId = String(userData.uid || userDoc.id).trim();

      if (
        !userId ||
        userData.rol === "ADMIN" ||
        userData.rol === "EMPLEADO" ||
        recentlyActiveUsers.has(userId)
      ) {
        continue;
      }

      if ((userData.updatedAt?.toMillis?.() || 0) > userCutoff.toMillis()) {
        continue;
      }

      const event = await notificationEventService.enqueueEvent({
        eventType: "inactive_user",
        userId,
        sourceData: {
          cutoffKey: userCutoff.toDate().toISOString().slice(0, 10),
        },
        triggerSource: "scheduler_inactive_users",
      });

      results.push(event.event);

      if (results.length >= notificationConfig.scheduler.inactiveUsersBatchSize) {
        break;
      }
    }

    this.baseLogger.info("notification_scheduler_inactive_users", {
      totalUsersChecked: usersSnapshot.size,
      enqueued: results.length,
    });

    return results;
  }

  async enqueueProbableRepurchases(): Promise<NotificationEvent[]> {
    const candidates =
      await notificationAudienceService.listProbableRepurchaseCandidates();
    const results: NotificationEvent[] = [];

    for (const candidate of candidates) {
      const event = await notificationEventService.enqueueEvent({
        eventType: "probable_repurchase",
        userId: candidate.userId,
        sourceData: {
          referenceOrderId: candidate.orderId,
          productIds: candidate.productIds,
        },
        triggerSource: "scheduler_probable_repurchase",
      });
      results.push(event.event);
    }

    this.baseLogger.info("notification_scheduler_probable_repurchase", {
      candidates: candidates.length,
      enqueued: results.length,
    });

    return results;
  }

  async enqueueProductRatingReminders(): Promise<NotificationEvent[]> {
    const deliveredBefore = this.toTimestampFromHoursAgo(
      notificationConfig.windows.ratingReminderDelayHours,
    );
    const deliveredAfter = this.toTimestampFromDaysAgo(
      notificationConfig.windows.ratingReminderLookbackDays,
    );
    const snapshot = await firestoreTienda
      .collection(ORDENES_COLLECTION)
      .where("estado", "==", "ENTREGADA")
      .where("deliveredAt", ">=", deliveredAfter)
      .where("deliveredAt", "<=", deliveredBefore)
      .limit(notificationConfig.scheduler.ratingReminderBatchSize)
      .get();
    const results: NotificationEvent[] = [];

    for (const doc of snapshot.docs) {
      const order = doc.data() as Orden;
      const userId = String(order.usuarioId || "").trim();

      if (!userId || !Array.isArray(order.items) || order.items.length === 0) {
        continue;
      }

      const uniqueProductIds = Array.from(
        new Set(
          order.items
            .map((item) => item.productoId)
            .filter((value): value is string => typeof value === "string"),
        ),
      );

      for (const productId of uniqueProductIds) {
        const alreadyRated = await productRatingService.hasUserRatedProduct(
          productId,
          userId,
        );

        if (alreadyRated) {
          continue;
        }

        const productSnapshot = await firestoreTienda
          .collection(PRODUCTOS_COLLECTION)
          .doc(productId)
          .get();
        const product = productSnapshot.exists
          ? (productSnapshot.data() as Producto)
          : null;

        const result = await notificationEventService.enqueueEvent({
          eventType: "product_rating_reminder",
          userId,
          productId,
          orderId: doc.id,
          sourceData: {
            eligibleOrderId: doc.id,
            deliveredAt: order.deliveredAt?.toDate?.().toISOString(),
            productName: product?.descripcion,
          },
          triggerSource: "scheduler_product_rating_reminder",
        });
        results.push(result.event);

        if (results.length >= notificationConfig.scheduler.ratingReminderBatchSize) {
          this.baseLogger.info("notification_scheduler_rating_reminders", {
            candidateOrders: snapshot.size,
            enqueued: results.length,
          });

          return results;
        }
      }
    }

    this.baseLogger.info("notification_scheduler_rating_reminders", {
      candidateOrders: snapshot.size,
      enqueued: results.length,
    });

    return results;
  }

  async enqueueActiveCampaigns(): Promise<NotificationEvent[]> {
    const snapshot = await firestoreTienda
      .collection(notificationCollections.campaigns)
      .where("active", "==", true)
      .limit(notificationConfig.scheduler.campaignBatchSize)
      .get();
    const now = Timestamp.now();
    const results: NotificationEvent[] = [];

    for (const campaignDoc of snapshot.docs) {
      const campaign = {
        id: campaignDoc.id,
        ...(campaignDoc.data() as NotificationCampaignDocument),
      };
      const startMillis = campaign.startsAt?.toMillis?.() || 0;
      const endMillis = campaign.endsAt?.toMillis?.() || Number.MAX_SAFE_INTEGER;
      const lastEnqueuedMillis = campaign.lastEnqueuedAt?.toMillis?.() || 0;

      if (startMillis > now.toMillis() || endMillis < now.toMillis()) {
        continue;
      }

      if (
        now.toMillis() - lastEnqueuedMillis <
        notificationConfig.windows.campaignCooldownHours * 60 * 60 * 1000
      ) {
        continue;
      }

      const userIds = await notificationAudienceService.listUsersForCampaign(
        campaign,
      );

      for (const userId of userIds) {
        const result = await notificationEventService.enqueueEvent({
          eventType: campaign.type,
          userId,
          campaignId: campaign.id,
          promoId:
            typeof campaign.sourceData?.promoId === "string"
              ? campaign.sourceData.promoId
              : undefined,
          deliveryMode: campaign.deliveryMode || "token",
          topic: campaign.topic,
          sourceData: {
            ...(campaign.sourceData || {}),
            campaignTitle: campaign.title,
            campaignDescription: campaign.description,
          },
          triggerSource: "scheduler_campaigns",
        });

        results.push(result.event);
      }

      await campaignDoc.ref.set(
        {
          lastEnqueuedAt: now,
          updatedAt: now,
        },
        { merge: true },
      );
    }

    this.baseLogger.info("notification_scheduler_campaigns", {
      campaigns: snapshot.size,
      enqueued: results.length,
    });

    return results;
  }
}

export const notificationSchedulerService = new NotificationSchedulerService();
export default notificationSchedulerService;
