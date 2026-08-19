import { randomUUID } from "crypto";
import logger from "../../utils/logger";
import deviceTokenService from "./device-token.service";
import notificationEventService from "./notification-event.service";
import notificationProcessingService from "./notification-processing.service";

export type BroadcastNotificationInput = {
  title: string;
  body: string;
  deeplink?: string;
  screen?: string;
  priority?: "normal" | "high";
  userIds?: string[];
};

export type BroadcastNotificationResult = {
  broadcastId: string;
  targetedUsers: number;
  sent: number;
  failed: number;
  skipped: number;
  results: Array<{
    userId: string;
    status: "processed" | "failed" | "skipped";
    skipReason?: string;
    eventId?: string;
  }>;
};

class NotificationBroadcastService {
  private readonly baseLogger = logger.child({
    component: "notification-broadcast-service",
  });

  async broadcast(
    input: BroadcastNotificationInput,
  ): Promise<BroadcastNotificationResult> {
    const broadcastId = randomUUID();
    const requestedUserIds = [
      ...new Set(
        (input.userIds || [])
          .map((userId) => userId.trim())
          .filter((userId) => userId.length > 0),
      ),
    ];

    const activeDevices = await deviceTokenService.listActiveDevices(
      requestedUserIds.length > 0 ? requestedUserIds : undefined,
    );

    const targetUserIds = [
      ...new Set(
        activeDevices
          .map((device) => device.userId?.trim())
          .filter((userId): userId is string => Boolean(userId)),
      ),
    ];

    this.baseLogger.info("notification_broadcast_started", {
      broadcastId,
      targetedUsers: targetUserIds.length,
      requestedUsers: requestedUserIds.length,
      title: input.title,
    });

    const results: BroadcastNotificationResult["results"] = [];
    let sent = 0;
    let failed = 0;
    let skipped = 0;

    for (const userId of targetUserIds) {
      const requestKey = `${broadcastId}:${userId}`;

      try {
        const enqueued = await notificationEventService.enqueueEvent({
          eventType: "manual_broadcast",
          userId,
          priority: input.priority,
          sourceData: {
            title: input.title,
            body: input.body,
            deeplink: input.deeplink,
            screen: input.screen,
            priority: input.priority,
            requestKey,
            broadcastId,
          },
          fingerprintParts: ["manual_broadcast", broadcastId, userId],
          triggerSource: "manual_broadcast_endpoint",
        });

        const processingResult =
          await notificationProcessingService.processQueuedEvent(
            enqueued.event.id || enqueued.event.fingerprint,
          );

        const status =
          processingResult.status === "processed"
            ? "processed"
            : processingResult.status === "failed"
              ? "failed"
              : "skipped";

        if (status === "processed") {
          sent += 1;
        } else if (status === "failed") {
          failed += 1;
        } else {
          skipped += 1;
        }

        results.push({
          userId,
          status,
          skipReason: processingResult.skipReason,
          eventId: processingResult.eventId,
        });
      } catch (error) {
        failed += 1;
        const message =
          error instanceof Error ? error.message : "Error desconocido";

        this.baseLogger.error("notification_broadcast_user_failed", {
          broadcastId,
          userId,
          message,
        });

        results.push({
          userId,
          status: "failed",
          skipReason: message,
        });
      }
    }

    this.baseLogger.info("notification_broadcast_finished", {
      broadcastId,
      targetedUsers: targetUserIds.length,
      sent,
      failed,
      skipped,
    });

    return {
      broadcastId,
      targetedUsers: targetUserIds.length,
      sent,
      failed,
      skipped,
      results,
    };
  }
}

export const notificationBroadcastService = new NotificationBroadcastService();
export default notificationBroadcastService;
