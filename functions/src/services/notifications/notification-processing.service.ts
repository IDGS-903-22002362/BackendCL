import {
  NotificationEvent,
  NotificationProcessingResult,
} from "../../models/notificacion.model";
import logger from "../../utils/logger";
import notificationAiService from "./notification-ai.service";
import notificationDeliveryService from "./notification-delivery.service";
import notificationEligibilityService from "./notification-eligibility.service";
import notificationEventService from "./notification-event.service";
import { isTransactionalNotification } from "./notification.utils";

class NotificationProcessingService {
  private readonly baseLogger = logger.child({
    component: "notification-processing-service",
  });

  private buildNoopResult(
    eventId: string,
    status: NotificationProcessingResult["status"],
    skipReason?: string,
  ): NotificationProcessingResult {
    return {
      eventId,
      status,
      skipReason,
      deliveries: [],
    };
  }

  async processQueuedEvent(eventId: string): Promise<NotificationProcessingResult> {
    const lockedEvent = await notificationEventService.markProcessing(eventId);

    if (!lockedEvent) {
      return this.buildNoopResult(eventId, "failed", "event_not_found");
    }

    if (lockedEvent.status !== "processing") {
      return this.buildNoopResult(
        eventId,
        lockedEvent.status,
        lockedEvent.skipReason,
      );
    }

    return this.processLockedEvent(lockedEvent);
  }

  async processLockedEvent(
    event: NotificationEvent,
  ): Promise<NotificationProcessingResult> {
    try {
      const eligibility = await notificationEligibilityService.evaluate(event);

      if (!eligibility.allowed) {
        const skipReason = eligibility.reason || "not_eligible";
        const skippedDelivery = await notificationDeliveryService.recordSkipped(
          event,
          skipReason,
          eligibility.localDayKey,
        );
        await notificationEventService.markSkipped(event.id || event.fingerprint, skipReason);

        return {
          eventId: event.id || event.fingerprint,
          status: "skipped",
          skipReason,
          deliveries: [skippedDelivery],
        };
      }

      const copy = await notificationAiService.generateCopy(event);
      if (!copy.send && !isTransactionalNotification(event.eventType)) {
        const skipReason = "ai_opt_out";
        const skippedDelivery = await notificationDeliveryService.recordSkipped(
          event,
          skipReason,
          eligibility.localDayKey,
        );
        await notificationEventService.markSkipped(event.id || event.fingerprint, skipReason);

        return {
          eventId: event.id || event.fingerprint,
          status: "skipped",
          skipReason,
          copy,
          deliveries: [skippedDelivery],
        };
      }

      const deliveries = await notificationDeliveryService.deliver(
        event,
        copy,
        eligibility,
      );
      const hasSuccessfulDelivery = deliveries.some(
        (delivery) => delivery.status === "sent",
      );
      const hasProviderFailure = deliveries.some(
        (delivery) =>
          delivery.status === "failed" || delivery.status === "invalid_token",
      );

      if (hasSuccessfulDelivery) {
        await notificationEventService.markProcessed(event.id || event.fingerprint);

        return {
          eventId: event.id || event.fingerprint,
          status: "processed",
          deliveries,
          copy,
        };
      }

      if (hasProviderFailure) {
        await notificationEventService.markFailed(
          event.id || event.fingerprint,
          "push_delivery_failed",
        );

        return {
          eventId: event.id || event.fingerprint,
          status: "failed",
          deliveries,
          copy,
        };
      }

      await notificationEventService.markSkipped(
        event.id || event.fingerprint,
        "no_deliveries_generated",
      );

      return {
        eventId: event.id || event.fingerprint,
        status: "skipped",
        skipReason: "no_deliveries_generated",
        deliveries,
        copy,
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Error desconocido";

      this.baseLogger.error("notification_event_processing_failed", {
        eventId: event.id,
        eventType: event.eventType,
        userId: event.userId,
        message,
      });

      await notificationEventService.markFailed(
        event.id || event.fingerprint,
        message,
      );

      return {
        eventId: event.id || event.fingerprint,
        status: "failed",
        skipReason: message,
        deliveries: [],
      };
    }
  }
}

export const notificationProcessingService =
  new NotificationProcessingService();
export default notificationProcessingService;
