import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { firestoreTienda } from "../../config/firebase";
import {
  NotificationBroadcastChunk,
  NotificationBroadcastJob,
} from "../../models/notificacion.model";
import logger from "../../utils/logger";
import { notificationCollections } from "./collections";
import deviceTokenService from "./device-token.service";
import notificationDeliveryService from "./notification-delivery.service";

export interface BroadcastChunkProcessingResult {
  chunkId: string;
  status: "done" | "failed" | "skipped";
  sent: number;
  failed: number;
  invalidTokens: number;
  skipReason?: string;
}

class NotificationBroadcastWorkerService {
  private readonly baseLogger = logger.child({
    component: "notification-broadcast-worker-service",
  });

  /**
   * Toma el lote solo si sigue en `queued`. Si Firestore reintenta el trigger,
   * el segundo intento encuentra el lote en otro estado y sale sin reenviar.
   */
  private async acquireChunk(
    chunkId: string,
  ): Promise<
    | { acquired: true; chunk: NotificationBroadcastChunk }
    | { acquired: false; reason: string }
  > {
    const chunkRef = firestoreTienda
      .collection(notificationCollections.broadcastChunks)
      .doc(chunkId);

    return firestoreTienda.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(chunkRef);

      if (!snapshot.exists) {
        return { acquired: false as const, reason: "chunk_not_found" };
      }

      const chunk = snapshot.data() as NotificationBroadcastChunk;

      if (chunk.status !== "queued") {
        return {
          acquired: false as const,
          reason: `chunk_already_${chunk.status}`,
        };
      }

      const now = Timestamp.now();
      transaction.update(chunkRef, {
        status: "processing",
        attempt: (chunk.attempt || 0) + 1,
        updatedAt: now,
      });

      return {
        acquired: true as const,
        chunk: {
          ...chunk,
          id: snapshot.id,
          status: "processing" as const,
          attempt: (chunk.attempt || 0) + 1,
          updatedAt: now,
        },
      };
    });
  }

  private async incrementJobCounters(
    broadcastId: string,
    delta: { sent: number; failed: number; invalidTokens: number },
  ): Promise<void> {
    const jobRef = firestoreTienda
      .collection(notificationCollections.broadcasts)
      .doc(broadcastId);

    await firestoreTienda.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(jobRef);

      if (!snapshot.exists) {
        return;
      }

      const job = snapshot.data() as NotificationBroadcastJob;
      const chunksCompleted = (job.chunksCompleted || 0) + 1;
      const isFinished = chunksCompleted >= (job.totalChunks || 0);
      const now = Timestamp.now();

      transaction.update(jobRef, {
        chunksCompleted: FieldValue.increment(1),
        sent: FieldValue.increment(delta.sent),
        failed: FieldValue.increment(delta.failed),
        invalidTokens: FieldValue.increment(delta.invalidTokens),
        status: isFinished ? "completed" : "running",
        updatedAt: now,
        ...(isFinished ? { completedAt: now } : {}),
      });
    });
  }

  async processChunk(chunkId: string): Promise<BroadcastChunkProcessingResult> {
    const lock = await this.acquireChunk(chunkId);

    if (!lock.acquired) {
      this.baseLogger.info("notification_broadcast_chunk_skipped", {
        chunkId,
        reason: lock.reason,
      });

      return {
        chunkId,
        status: "skipped",
        sent: 0,
        failed: 0,
        invalidTokens: 0,
        skipReason: lock.reason,
      };
    }

    const chunk = lock.chunk;
    const chunkRef = firestoreTienda
      .collection(notificationCollections.broadcastChunks)
      .doc(chunkId);

    try {
      const result = await notificationDeliveryService.sendBroadcastChunk(chunk);

      if (result.perTarget?.length) {
        await notificationDeliveryService.persistBroadcastResults(
          chunk,
          result.perTarget,
        );
      }

      if (result.invalidTargets.length > 0) {
        await deviceTokenService.disableTokensBulk(
          result.invalidTargets.map((entry) => ({
            userId: entry.target.userId,
            deviceId: entry.target.deviceId,
            reason: entry.reason,
          })),
        );
      }

      const now = Timestamp.now();
      await chunkRef.set(
        {
          status: "done",
          sent: result.sent,
          failed: result.failed,
          invalidTokens: result.invalidTargets.length,
          updatedAt: now,
          processedAt: now,
        },
        { merge: true },
      );

      await this.incrementJobCounters(chunk.broadcastId, {
        sent: result.sent,
        failed: result.failed,
        invalidTokens: result.invalidTargets.length,
      });

      this.baseLogger.info("notification_broadcast_chunk_done", {
        chunkId,
        broadcastId: chunk.broadcastId,
        chunkIndex: chunk.chunkIndex,
        sent: result.sent,
        failed: result.failed,
        invalidTokens: result.invalidTargets.length,
      });

      return {
        chunkId,
        status: "done",
        sent: result.sent,
        failed: result.failed,
        invalidTokens: result.invalidTargets.length,
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Error desconocido";
      const now = Timestamp.now();

      this.baseLogger.error("notification_broadcast_chunk_failed", {
        chunkId,
        broadcastId: chunk.broadcastId,
        chunkIndex: chunk.chunkIndex,
        message,
      });

      await chunkRef.set(
        {
          status: "failed",
          lastError: message,
          updatedAt: now,
          processedAt: now,
        },
        { merge: true },
      );

      await this.incrementJobCounters(chunk.broadcastId, {
        sent: 0,
        failed: chunk.targets.length,
        invalidTokens: 0,
      });

      return {
        chunkId,
        status: "failed",
        sent: 0,
        failed: chunk.targets.length,
        invalidTokens: 0,
        skipReason: message,
      };
    }
  }
}

export const notificationBroadcastWorkerService =
  new NotificationBroadcastWorkerService();
export default notificationBroadcastWorkerService;
