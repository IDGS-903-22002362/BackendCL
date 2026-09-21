import { Timestamp } from "firebase-admin/firestore";
import { firestoreTienda } from "../../config/firebase";
import {
  NotificationBroadcastChunk,
  NotificationBroadcastCopy,
  NotificationBroadcastCreationResult,
  NotificationBroadcastJob,
  NotificationBroadcastTarget,
} from "../../models/notificacion.model";
import logger from "../../utils/logger";
import notificationBroadcastAudienceService from "./notification-broadcast-audience.service";
import { notificationCollections } from "./collections";

/** Limite duro de `sendEachForMulticast` en firebase-admin. */
export const BROADCAST_CHUNK_SIZE = 500;

const DEFAULT_DEEPLINK = "clubleon://shop/home";
const DEFAULT_SCREEN = "home";
const DEFAULT_TITLE = "Club Leon";
const DEFAULT_BODY = "Entra para ver novedades.";

export type BroadcastNotificationInput = {
  title: string;
  body: string;
  deeplink?: string;
  screen?: string;
  priority?: "normal" | "high";
  userIds?: string[];
  createdBy?: string;
};

class NotificationBroadcastService {
  private readonly baseLogger = logger.child({
    component: "notification-broadcast-service",
  });

  private truncate(value: string | undefined, max: number): string | undefined {
    const normalized = value?.trim();
    return normalized ? normalized.slice(0, max) : undefined;
  }

  /**
   * El copy de un broadcast lo escribe el admin, asi que se resuelve una sola
   * vez para todo el job en lugar de generarlo por usuario.
   */
  private buildCopy(input: BroadcastNotificationInput): NotificationBroadcastCopy {
    return {
      title: this.truncate(input.title, 80) || DEFAULT_TITLE,
      body: this.truncate(input.body, 180) || DEFAULT_BODY,
      deeplink: this.truncate(input.deeplink, 200) || DEFAULT_DEEPLINK,
      screen: this.truncate(input.screen, 80) || DEFAULT_SCREEN,
      category: "test",
      priority: input.priority === "high" ? "high" : "normal",
    };
  }

  private chunkTargets(
    targets: NotificationBroadcastTarget[],
  ): NotificationBroadcastTarget[][] {
    const chunks: NotificationBroadcastTarget[][] = [];

    for (let index = 0; index < targets.length; index += BROADCAST_CHUNK_SIZE) {
      chunks.push(targets.slice(index, index + BROADCAST_CHUNK_SIZE));
    }

    return chunks;
  }

  async createBroadcast(
    input: BroadcastNotificationInput,
  ): Promise<NotificationBroadcastCreationResult> {
    const requestedUserIds = [
      ...new Set(
        (input.userIds || [])
          .map((userId) => userId.trim())
          .filter((userId) => userId.length > 0),
      ),
    ];

    const copy = this.buildCopy(input);
    const audience =
      await notificationBroadcastAudienceService.resolve(requestedUserIds);
    const chunks = this.chunkTargets(audience.targets);
    const now = Timestamp.now();

    const broadcastRef = firestoreTienda
      .collection(notificationCollections.broadcasts)
      .doc();

    const job: Omit<NotificationBroadcastJob, "id"> = {
      status: chunks.length === 0 ? "completed" : "queued",
      copy,
      requestedUserIds,
      targetedUsers: audience.targetedUsers,
      totalTokens: audience.targets.length,
      totalChunks: chunks.length,
      chunksCompleted: 0,
      sent: 0,
      failed: 0,
      invalidTokens: 0,
      createdBy: input.createdBy,
      createdAt: now,
      updatedAt: now,
      ...(chunks.length === 0 ? { completedAt: now } : {}),
    };

    await broadcastRef.set(job);

    if (chunks.length > 0) {
      const writer = firestoreTienda.bulkWriter();

      chunks.forEach((targets, chunkIndex) => {
        const chunkRef = firestoreTienda
          .collection(notificationCollections.broadcastChunks)
          .doc(`${broadcastRef.id}_${chunkIndex}`);

        const chunk: Omit<NotificationBroadcastChunk, "id"> = {
          broadcastId: broadcastRef.id,
          chunkIndex,
          status: "queued",
          copy,
          targets,
          attempt: 0,
          sent: 0,
          failed: 0,
          invalidTokens: 0,
          createdAt: now,
          updatedAt: now,
        };

        void writer.set(chunkRef, chunk);
      });

      await writer.close();
    }

    this.baseLogger.info("notification_broadcast_created", {
      broadcastId: broadcastRef.id,
      targetedUsers: audience.targetedUsers,
      totalTokens: audience.targets.length,
      totalChunks: chunks.length,
      requestedUsers: requestedUserIds.length,
    });

    return {
      broadcastId: broadcastRef.id,
      status: job.status,
      targetedUsers: audience.targetedUsers,
      totalTokens: audience.targets.length,
      totalChunks: chunks.length,
    };
  }

  async getBroadcast(
    broadcastId: string,
  ): Promise<NotificationBroadcastJob | null> {
    const snapshot = await firestoreTienda
      .collection(notificationCollections.broadcasts)
      .doc(broadcastId.trim())
      .get();

    if (!snapshot.exists) {
      return null;
    }

    return {
      id: snapshot.id,
      ...(snapshot.data() as NotificationBroadcastJob),
    };
  }
}

export const notificationBroadcastService = new NotificationBroadcastService();
export default notificationBroadcastService;
