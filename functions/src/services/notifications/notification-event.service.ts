import { Timestamp } from "firebase-admin/firestore";
import { firestoreTienda } from "../../config/firebase";
import {
  NotificationDeliveryMode,
  NotificationEvent,
  NotificationEventType,
  NotificationPriority,
} from "../../models/notificacion.model";
import logger from "../../utils/logger";
import notificationAudienceService from "./notification-audience.service";
import { notificationCollections } from "./collections";
import {
  buildNotificationFingerprint,
  resolveNotificationCategory,
  resolveNotificationEntity,
  resolveNotificationPriority,
} from "./notification.utils";

export interface EnqueueNotificationEventInput {
  eventType: NotificationEventType;
  userId: string;
  productId?: string;
  orderId?: string;
  cartId?: string;
  campaignId?: string;
  promoId?: string;
  priority?: NotificationPriority;
  deliveryMode?: NotificationDeliveryMode;
  topic?: string;
  sourceData?: Record<string, unknown>;
  triggerSource?: string;
  fingerprintParts?: Array<unknown>;
}

class NotificationEventService {
  private readonly baseLogger = logger.child({
    component: "notification-event-service",
  });

  private buildEventFingerprint(input: EnqueueNotificationEventInput): string {
    if (Array.isArray(input.fingerprintParts) && input.fingerprintParts.length) {
      return buildNotificationFingerprint(...input.fingerprintParts);
    }

    switch (input.eventType) {
      case "order_created":
      case "order_confirmed":
      case "order_shipped":
      case "order_delivered":
        return buildNotificationFingerprint(
          input.eventType,
          input.userId,
          input.orderId,
        );
      case "cart_abandoned":
        return buildNotificationFingerprint(
          input.eventType,
          input.userId,
          input.cartId,
          input.sourceData?.cartUpdatedAt,
        );
      case "product_restocked":
        return buildNotificationFingerprint(
          input.eventType,
          input.userId,
          input.productId,
          input.sourceData?.restockedAt || input.sourceData?.stockTransition,
        );
      case "price_drop":
        return buildNotificationFingerprint(
          input.eventType,
          input.userId,
          input.productId,
          input.sourceData?.precioAnterior,
          input.sourceData?.precioNuevo,
        );
      case "product_rating_reminder":
        return buildNotificationFingerprint(
          input.eventType,
          input.userId,
          input.productId,
          input.orderId || input.sourceData?.eligibleOrderId,
        );
      case "inactive_user":
        return buildNotificationFingerprint(
          input.eventType,
          input.userId,
          input.sourceData?.cutoffKey || input.sourceData?.dayKey || "default",
        );
      case "promo_campaign":
      case "matchday_campaign":
        return buildNotificationFingerprint(
          input.eventType,
          input.userId,
          input.campaignId || input.promoId || "campaign",
        );
      case "probable_repurchase":
        return buildNotificationFingerprint(
          input.eventType,
          input.userId,
          input.sourceData?.referenceOrderId || "repurchase",
        );
      case "manual_test":
        return buildNotificationFingerprint(
          input.eventType,
          input.userId,
          input.sourceData?.requestKey ||
            input.sourceData?.title ||
            input.sourceData?.sentAt ||
            Date.now(),
        );
      default:
        return buildNotificationFingerprint(
          input.eventType,
          input.userId,
          input.orderId,
          input.productId,
          input.cartId,
          input.campaignId,
        );
    }
  }

  async enqueueEvent(
    input: EnqueueNotificationEventInput,
  ): Promise<{ event: NotificationEvent; created: boolean }> {
    const category = resolveNotificationCategory(input.eventType);
    const priority =
      input.priority || resolveNotificationPriority(input.eventType);
    const entity = resolveNotificationEntity(input.eventType, {
      userId: input.userId,
      orderId: input.orderId,
      productId: input.productId,
      cartId: input.cartId,
      campaignId: input.campaignId,
      promoId: input.promoId,
    });
    const fingerprint = this.buildEventFingerprint(input);
    const now = Timestamp.now();
    const eventRef = firestoreTienda
      .collection(notificationCollections.events)
      .doc(fingerprint);
    const payload: Omit<NotificationEvent, "id"> = {
      eventType: input.eventType,
      category,
      userId: input.userId,
      productId: input.productId,
      orderId: input.orderId,
      cartId: input.cartId,
      campaignId: input.campaignId,
      promoId: input.promoId,
      entityType: entity.entityType,
      entityId: entity.entityId,
      fingerprint,
      deliveryMode: input.deliveryMode || "token",
      topic: input.topic,
      priority,
      status: "queued",
      sourceData: input.sourceData || {},
      triggerSource: input.triggerSource,
      createdAt: now,
      updatedAt: now,
    };

    try {
      await eventRef.create(payload);

      const event: NotificationEvent = {
        id: eventRef.id,
        ...payload,
      };

      this.baseLogger.info("notification_event_enqueued", {
        eventId: event.id,
        eventType: event.eventType,
        userId: event.userId,
        entityId: event.entityId,
      });

      return { event, created: true };
    } catch (error) {
      const firestoreError = error as { code?: string | number };

      if (String(firestoreError?.code) !== "6") {
        throw error;
      }

      const existingSnapshot = await eventRef.get();
      if (!existingSnapshot.exists) {
        throw error;
      }

      return {
        created: false,
        event: {
          id: existingSnapshot.id,
          ...(existingSnapshot.data() as NotificationEvent),
        },
      };
    }
  }

  async enqueueProductAudienceEvents(
    input: Omit<EnqueueNotificationEventInput, "userId"> & {
      eventType: "product_restocked" | "price_drop";
      productId: string;
    },
  ): Promise<NotificationEvent[]> {
    const interestedUserIds =
      await notificationAudienceService.getInterestedUserIdsForProduct(
        input.productId,
      );
    const results: NotificationEvent[] = [];

    for (const userId of interestedUserIds) {
      const result = await this.enqueueEvent({
        ...input,
        userId,
      });
      results.push(result.event);
    }

    return results;
  }

  async getEvent(eventId: string): Promise<NotificationEvent | null> {
    const snapshot = await firestoreTienda
      .collection(notificationCollections.events)
      .doc(eventId)
      .get();

    if (!snapshot.exists) {
      return null;
    }

    return {
      id: snapshot.id,
      ...(snapshot.data() as NotificationEvent),
    };
  }

  async markProcessing(eventId: string): Promise<NotificationEvent | null> {
    const eventRef = firestoreTienda
      .collection(notificationCollections.events)
      .doc(eventId);
    let capturedEvent: NotificationEvent | null = null;

    await firestoreTienda.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(eventRef);

      if (!snapshot.exists) {
        return;
      }

      const event = snapshot.data() as NotificationEvent;
      if (event.status !== "queued" && event.status !== "failed") {
        capturedEvent = {
          id: snapshot.id,
          ...event,
        };
        return;
      }

      const now = Timestamp.now();
      transaction.update(eventRef, {
        status: "processing",
        updatedAt: now,
        skipReason: null,
        lastError: null,
      });

      capturedEvent = {
        id: snapshot.id,
        ...event,
        status: "processing",
        updatedAt: now,
      };
    });

    return capturedEvent;
  }

  async markProcessed(eventId: string): Promise<void> {
    await firestoreTienda
      .collection(notificationCollections.events)
      .doc(eventId)
      .set(
        {
          status: "processed",
          processedAt: Timestamp.now(),
          updatedAt: Timestamp.now(),
        },
        { merge: true },
      );
  }

  async markSkipped(eventId: string, reason: string): Promise<void> {
    await firestoreTienda
      .collection(notificationCollections.events)
      .doc(eventId)
      .set(
        {
          status: "skipped",
          skipReason: reason,
          processedAt: Timestamp.now(),
          updatedAt: Timestamp.now(),
        },
        { merge: true },
      );
  }

  async markFailed(eventId: string, errorMessage: string): Promise<void> {
    await firestoreTienda
      .collection(notificationCollections.events)
      .doc(eventId)
      .set(
        {
          status: "failed",
          lastError: errorMessage,
          updatedAt: Timestamp.now(),
        },
        { merge: true },
      );
  }
}

export const notificationEventService = new NotificationEventService();
export default notificationEventService;
