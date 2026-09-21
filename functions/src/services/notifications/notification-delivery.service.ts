import { Timestamp } from "firebase-admin/firestore";
import { Message } from "firebase-admin/messaging";
import { firestoreApp, messagingAppOficial } from "../../config/app.firebase";
import { firestoreTienda } from "../../config/firebase";
import {
  GeneratedPushCopy,
  NotificationBroadcastChunk,
  NotificationBroadcastTarget,
  NotificationDeliveryRecord,
  NotificationDeliveryStatus,
  NotificationEligibilityResult,
  NotificationEvent,
} from "../../models/notificacion.model";
import logger from "../../utils/logger";
import { notificationCollections } from "./collections";
import deviceTokenService from "./device-token.service";

const INVALID_FCM_CODES = new Set([
  "messaging/invalid-registration-token",
  "messaging/registration-token-not-registered",
  "messaging/invalid-argument",
]);

export interface BroadcastChunkSendResult {
  sent: number;
  failed: number;
  invalidTargets: Array<{
    target: NotificationBroadcastTarget;
    reason: string;
  }>;
  perTarget?: Array<{
    target: NotificationBroadcastTarget;
    status: Extract<
      NotificationDeliveryStatus,
      "sent" | "failed" | "invalid_token"
    >;
    providerMessageId?: string;
    providerErrorCode?: string;
    providerErrorMessage?: string;
  }>;
}

class NotificationDeliveryService {
  private readonly baseLogger = logger.child({
    component: "notification-delivery-service",
  });

  private maskToken(token?: string): string | undefined {
    if (!token) {
      return undefined;
    }

    const normalized = token.trim();
    if (normalized.length <= 8) {
      return "***";
    }

    return `${normalized.slice(0, 4)}***${normalized.slice(-4)}`;
  }

  private buildDataPayload(
    event: NotificationEvent,
    copy: GeneratedPushCopy,
    notificationId: string,
    sentAt: string,
  ): Record<string, string> {
    return {
      notificationId,
      eventId: event.id || event.fingerprint,
      type: event.eventType,
      category: copy.category,
      entityType: event.entityType,
      entityId: event.entityId,
      deeplink: copy.deeplink,
      screen: copy.screen,
      priority: copy.priority,
      sentAt,
    };
  }

  private async persistDeliveryRecord(
    record: Omit<NotificationDeliveryRecord, "id">,
  ): Promise<NotificationDeliveryRecord> {
    const ref = await firestoreTienda
      .collection(notificationCollections.deliveries)
      .add(record);

    return {
      id: ref.id,
      ...record,
    };
  }

  async recordSkipped(
    event: NotificationEvent,
    reason: string,
    localDayKey?: string,
  ): Promise<NotificationDeliveryRecord> {
    return this.persistDeliveryRecord({
      eventId: event.id || event.fingerprint,
      fingerprint: event.fingerprint,
      userId: event.userId,
      eventType: event.eventType,
      category: event.category,
      status: "skipped",
      channel: "push",
      deliveryMode: event.deliveryMode,
      entityType: event.entityType,
      entityId: event.entityId,
      skipReason: reason,
      localDayKey,
      createdAt: Timestamp.now(),
    });
  }

  private async mirrorInAppNotification(
    event: NotificationEvent,
    copy: GeneratedPushCopy,
    notificationId: string,
  ): Promise<NotificationDeliveryRecord> {
    const now = Timestamp.now();
    await firestoreApp.collection(notificationCollections.systemNotifications).add({
      tipo: event.eventType,
      categoria: copy.category,
      canal: "in_app",
      destinatarioUid: event.userId,
      titulo: copy.title,
      mensaje: copy.body,
      leida: false,
      payload: {
        notificationId,
        eventId: event.id || event.fingerprint,
        type: event.eventType,
        category: copy.category,
        entityType: event.entityType,
        entityId: event.entityId,
        deeplink: copy.deeplink,
        screen: copy.screen,
        priority: copy.priority,
      },
      createdAt: now,
      updatedAt: now,
    });

    return this.persistDeliveryRecord({
      eventId: event.id || event.fingerprint,
      fingerprint: event.fingerprint,
      userId: event.userId,
      eventType: event.eventType,
      category: event.category,
      status: "sent",
      channel: "in_app",
      deliveryMode: event.deliveryMode,
      entityType: event.entityType,
      entityId: event.entityId,
      title: copy.title,
      body: copy.body,
      deeplink: copy.deeplink,
      screen: copy.screen,
      priority: copy.priority,
      localDayKey: undefined,
      createdAt: now,
      sentAt: now,
    });
  }

  private buildMessage(
    token: string,
    event: NotificationEvent,
    copy: GeneratedPushCopy,
    notificationId: string,
  ): Message {
    const sentAt = new Date().toISOString();

    return {
      token,
      notification: {
        title: copy.title,
        body: copy.body,
      },
      data: this.buildDataPayload(event, copy, notificationId, sentAt),
      android: {
        priority: copy.priority === "high" ? "high" : "normal",
      },
      apns: {
        headers: {
          "apns-priority": copy.priority === "high" ? "10" : "5",
        },
      },
    };
  }

  private buildBroadcastDataPayload(
    chunk: NotificationBroadcastChunk,
  ): Record<string, string> {
    return {
      notificationId: `${chunk.broadcastId}:${chunk.chunkIndex}`,
      eventId: chunk.broadcastId,
      type: "manual_broadcast",
      category: chunk.copy.category,
      entityType: "user",
      entityId: chunk.broadcastId,
      deeplink: chunk.copy.deeplink,
      screen: chunk.copy.screen,
      priority: chunk.copy.priority,
      sentAt: new Date().toISOString(),
    };
  }

  /**
   * Envia un lote de hasta 500 tokens con una sola llamada multicast.
   * `response.responses[i]` corresponde a `chunk.targets[i]`.
   */
  async sendBroadcastChunk(
    chunk: NotificationBroadcastChunk,
  ): Promise<BroadcastChunkSendResult> {
    const targets = chunk.targets;

    if (targets.length === 0) {
      return { sent: 0, failed: 0, invalidTargets: [] };
    }

    const response = await messagingAppOficial.sendEachForMulticast({
      tokens: targets.map((target) => target.token),
      notification: {
        title: chunk.copy.title,
        body: chunk.copy.body,
      },
      data: this.buildBroadcastDataPayload(chunk),
      android: {
        priority: chunk.copy.priority === "high" ? "high" : "normal",
      },
      apns: {
        headers: {
          "apns-priority": chunk.copy.priority === "high" ? "10" : "5",
        },
      },
    });

    const invalidTargets: BroadcastChunkSendResult["invalidTargets"] = [];
    const perTarget: BroadcastChunkSendResult["perTarget"] = [];

    response.responses.forEach((result, index) => {
      const target = targets[index];

      if (result.success) {
        perTarget.push({
          target,
          status: "sent",
          providerMessageId: result.messageId,
        });
        return;
      }

      const code = result.error?.code || "messaging/unknown";

      if (INVALID_FCM_CODES.has(code)) {
        invalidTargets.push({ target, reason: code });
        perTarget.push({
          target,
          status: "invalid_token",
          providerErrorCode: code,
          providerErrorMessage: result.error?.message,
        });
        return;
      }

      perTarget.push({
        target,
        status: "failed",
        providerErrorCode: code,
        providerErrorMessage: result.error?.message,
      });
    });

    if (response.failureCount > 0) {
      this.baseLogger.warn("notification_broadcast_chunk_partial_failure", {
        broadcastId: chunk.broadcastId,
        chunkIndex: chunk.chunkIndex,
        successCount: response.successCount,
        failureCount: response.failureCount,
        invalidTokens: invalidTargets.length,
      });
    }

    return {
      sent: response.successCount,
      failed: response.failureCount,
      invalidTargets,
      perTarget,
    };
  }

  /**
   * Persiste un registro de envio por usuario (no por token) y el espejo
   * in-app, todo con BulkWriter para no bloquear por documento.
   */
  async persistBroadcastResults(
    chunk: NotificationBroadcastChunk,
    perTarget: NonNullable<BroadcastChunkSendResult["perTarget"]>,
  ): Promise<void> {
    const now = Timestamp.now();
    const byUser = new Map<string, (typeof perTarget)[number]>();

    for (const entry of perTarget) {
      const existing = byUser.get(entry.target.userId);

      // Un usuario con varios dispositivos cuenta como entregado si al menos
      // uno de sus tokens recibio la notificacion.
      if (!existing || (existing.status !== "sent" && entry.status === "sent")) {
        byUser.set(entry.target.userId, entry);
      }
    }

    const deliveriesWriter = firestoreTienda.bulkWriter();
    const inAppWriter = firestoreApp.bulkWriter();

    for (const [userId, entry] of byUser) {
      const deliveryRef = firestoreTienda
        .collection(notificationCollections.deliveries)
        .doc(`${chunk.broadcastId}_${chunk.chunkIndex}_${userId}`);

      void deliveriesWriter.set(deliveryRef, {
        eventId: chunk.broadcastId,
        fingerprint: chunk.broadcastId,
        userId,
        eventType: "manual_broadcast",
        category: chunk.copy.category,
        status: entry.status,
        channel: "push",
        deliveryMode: "token",
        entityType: "user",
        entityId: userId,
        title: chunk.copy.title,
        body: chunk.copy.body,
        deeplink: chunk.copy.deeplink,
        screen: chunk.copy.screen,
        priority: chunk.copy.priority,
        providerMessageId: entry.providerMessageId,
        providerErrorCode: entry.providerErrorCode,
        providerErrorMessage: entry.providerErrorMessage,
        createdAt: now,
        ...(entry.status === "sent" ? { sentAt: now } : {}),
      });

      if (entry.status !== "sent") {
        continue;
      }

      const inAppRef = firestoreApp
        .collection(notificationCollections.systemNotifications)
        .doc(`${chunk.broadcastId}_${userId}`);

      void inAppWriter.set(inAppRef, {
        tipo: "manual_broadcast",
        categoria: chunk.copy.category,
        canal: "in_app",
        destinatarioUid: userId,
        titulo: chunk.copy.title,
        mensaje: chunk.copy.body,
        leida: false,
        payload: {
          notificationId: `${chunk.broadcastId}:${chunk.chunkIndex}`,
          eventId: chunk.broadcastId,
          type: "manual_broadcast",
          category: chunk.copy.category,
          entityType: "user",
          entityId: userId,
          deeplink: chunk.copy.deeplink,
          screen: chunk.copy.screen,
          priority: chunk.copy.priority,
        },
        createdAt: now,
        updatedAt: now,
      });
    }

    await Promise.all([deliveriesWriter.close(), inAppWriter.close()]);
  }

  async deliver(
    event: NotificationEvent,
    copy: GeneratedPushCopy,
    eligibility: NotificationEligibilityResult,
  ): Promise<NotificationDeliveryRecord[]> {
    const deliveryRecords: NotificationDeliveryRecord[] = [];

    if (event.deliveryMode === "topic" && event.topic) {
      const notificationId = `${event.id || event.fingerprint}:topic`;
      const sentAt = Timestamp.now();

      try {
        const providerMessageId = await messagingAppOficial.send({
          topic: event.topic,
          notification: {
            title: copy.title,
            body: copy.body,
          },
          data: this.buildDataPayload(
            event,
            copy,
            notificationId,
            new Date().toISOString(),
          ),
        });

        deliveryRecords.push(
          await this.persistDeliveryRecord({
            eventId: event.id || event.fingerprint,
            fingerprint: event.fingerprint,
            userId: event.userId,
            eventType: event.eventType,
            category: event.category,
            status: "sent",
            channel: "push",
            deliveryMode: event.deliveryMode,
            topic: event.topic,
            entityType: event.entityType,
            entityId: event.entityId,
            title: copy.title,
            body: copy.body,
            deeplink: copy.deeplink,
            screen: copy.screen,
            priority: copy.priority,
            providerMessageId,
            localDayKey: eligibility.localDayKey,
            createdAt: sentAt,
            sentAt,
          }),
        );
      } catch (error) {
        const providerError = error as { code?: string; message?: string };
        deliveryRecords.push(
          await this.persistDeliveryRecord({
            eventId: event.id || event.fingerprint,
            fingerprint: event.fingerprint,
            userId: event.userId,
            eventType: event.eventType,
            category: event.category,
            status: "failed",
            channel: "push",
            deliveryMode: event.deliveryMode,
            topic: event.topic,
            entityType: event.entityType,
            entityId: event.entityId,
            title: copy.title,
            body: copy.body,
            deeplink: copy.deeplink,
            screen: copy.screen,
            priority: copy.priority,
            providerErrorCode: providerError.code,
            providerErrorMessage:
              providerError.message || "Error desconocido de FCM",
            localDayKey: eligibility.localDayKey,
            createdAt: sentAt,
          }),
        );
      }

      deliveryRecords.push(
        await this.mirrorInAppNotification(event, copy, notificationId),
      );
      return deliveryRecords;
    }

    for (const device of eligibility.devices) {
      const notificationId = `${event.id || event.fingerprint}:${device.deviceId}`;
      const recordBase = {
        eventId: event.id || event.fingerprint,
        fingerprint: event.fingerprint,
        userId: event.userId,
        eventType: event.eventType,
        category: event.category,
        channel: "push" as const,
        deliveryMode: event.deliveryMode,
        deviceId: device.deviceId,
        token: this.maskToken(device.token),
        entityType: event.entityType,
        entityId: event.entityId,
        title: copy.title,
        body: copy.body,
        deeplink: copy.deeplink,
        screen: copy.screen,
        priority: copy.priority,
        localDayKey: eligibility.localDayKey,
        createdAt: Timestamp.now(),
      };

      try {
        const providerMessageId = await messagingAppOficial.send(
          this.buildMessage(device.token, event, copy, notificationId),
        );
        const now = Timestamp.now();

        deliveryRecords.push(
          await this.persistDeliveryRecord({
            ...recordBase,
            status: "sent",
            providerMessageId,
            sentAt: now,
          }),
        );
      } catch (error) {
        const providerError = error as { code?: string; message?: string };
        const invalidReason = providerError.code || "messaging/unknown";

        if (INVALID_FCM_CODES.has(invalidReason)) {
          await deviceTokenService.markTokenInvalid(
            event.userId,
            device.deviceId,
            invalidReason,
          );

          deliveryRecords.push(
            await this.persistDeliveryRecord({
              ...recordBase,
              status: "invalid_token",
              providerErrorCode: invalidReason,
              providerErrorMessage:
                providerError.message || "Token inválido o expirado",
            }),
          );
          continue;
        }

        this.baseLogger.error("notification_push_send_failed", {
          eventId: event.id,
          userId: event.userId,
          deviceId: device.deviceId,
          code: providerError.code,
          message: providerError.message,
        });

        deliveryRecords.push(
          await this.persistDeliveryRecord({
            ...recordBase,
            status: "failed",
            providerErrorCode: providerError.code,
            providerErrorMessage:
              providerError.message || "Error desconocido de FCM",
          }),
        );
      }
    }

    deliveryRecords.push(
      await this.mirrorInAppNotification(
        event,
        copy,
        `${event.id || event.fingerprint}:in_app`,
      ),
    );

    return deliveryRecords;
  }
}

export const notificationDeliveryService = new NotificationDeliveryService();
export default notificationDeliveryService;
