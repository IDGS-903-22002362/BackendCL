import { firestoreApp } from "../../config/app.firebase";
import {
  NotificationBroadcastTarget,
  NotificationPreferenceDocument,
} from "../../models/notificacion.model";
import logger from "../../utils/logger";
import { notificationCollections } from "./collections";
import deviceTokenService from "./device-token.service";

export interface BroadcastAudience {
  targets: NotificationBroadcastTarget[];
  targetedUsers: number;
  optedOutUsers: number;
  duplicateTokens: number;
}

class NotificationBroadcastAudienceService {
  private readonly baseLogger = logger.child({
    component: "notification-broadcast-audience-service",
  });

  /**
   * Usuarios que apagaron el push por completo. Se resuelve con una sola
   * consulta collection group en lugar de una lectura de preferencias por
   * usuario.
   */
  private async loadOptedOutUserIds(): Promise<Set<string>> {
    const snapshot = await firestoreApp
      .collectionGroup(notificationCollections.userPreferences)
      .where("pushEnabled", "==", false)
      .get();

    const optedOut = new Set<string>();

    for (const doc of snapshot.docs) {
      const preference = doc.data() as Partial<NotificationPreferenceDocument>;
      const userId =
        typeof preference.userId === "string"
          ? preference.userId.trim()
          : doc.ref.parent.parent?.id?.trim();

      if (userId) {
        optedOut.add(userId);
      }
    }

    return optedOut;
  }

  async resolve(requestedUserIds: string[]): Promise<BroadcastAudience> {
    const [devices, optedOutUserIds] = await Promise.all([
      deviceTokenService.listActiveDevices(
        requestedUserIds.length > 0 ? requestedUserIds : undefined,
      ),
      this.loadOptedOutUserIds(),
    ]);

    const seenTokens = new Set<string>();
    const uniqueUsers = new Set<string>();
    const targets: NotificationBroadcastTarget[] = [];
    let optedOutCount = 0;
    let duplicateTokens = 0;

    for (const device of devices) {
      const userId = device.userId?.trim();
      const token = device.token?.trim();

      if (!userId || !token) {
        continue;
      }

      if (optedOutUserIds.has(userId)) {
        optedOutCount += 1;
        continue;
      }

      // El mismo token puede estar registrado bajo varios deviceId; enviarlo
      // dos veces duplica la notificacion en el dispositivo.
      if (seenTokens.has(token)) {
        duplicateTokens += 1;
        continue;
      }

      seenTokens.add(token);
      uniqueUsers.add(userId);
      targets.push({
        userId,
        deviceId: device.deviceId?.trim() || device.id || "unknown",
        token,
      });
    }

    this.baseLogger.info("notification_broadcast_audience_resolved", {
      requestedUsers: requestedUserIds.length,
      activeDevices: devices.length,
      targets: targets.length,
      targetedUsers: uniqueUsers.size,
      optedOutDevices: optedOutCount,
      duplicateTokens,
    });

    return {
      targets,
      targetedUsers: uniqueUsers.size,
      optedOutUsers: optedOutCount,
      duplicateTokens,
    };
  }
}

export const notificationBroadcastAudienceService =
  new NotificationBroadcastAudienceService();
export default notificationBroadcastAudienceService;
