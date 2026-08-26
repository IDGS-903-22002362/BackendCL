import { Timestamp } from "firebase-admin/firestore";
import { firestoreApp } from "../../config/app.firebase";
import {
  NotificationInboxItem,
  NotificationInboxPage,
  NotificationInboxPayload,
  NotificationInboxReadResult,
} from "../../models/notificacion.model";
import { notificationCollections } from "./collections";

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;
const MAX_IDS_PER_READ = 50;
const MARK_ALL_BATCH_SIZE = 400;
/** Límite defensivo cuando Firestore aún no tiene índices compuestos. */
const MAX_IN_MEMORY_INBOX_SCAN = 500;

/**
 * Bandeja in-app del usuario. Lee el espejo que `notification-delivery.service`
 * escribe en `notificacionesSistema` cada vez que se procesa un evento, así que
 * incluye también las notificaciones cuyo push nunca llegó al dispositivo.
 */
class NotificationInboxService {
  private get collection(): FirebaseFirestore.CollectionReference {
    return firestoreApp.collection(notificationCollections.systemNotifications);
  }

  private userQuery(userId: string): FirebaseFirestore.Query {
    return this.collection.where("destinatarioUid", "==", userId);
  }

  private toText(value: unknown): string {
    return typeof value === "string" ? value : value == null ? "" : String(value);
  }

  private isMissingIndexError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return (
      message.includes("requires an index") ||
      message.includes("FAILED_PRECONDITION")
    );
  }

  private getCreatedAtMs(doc: FirebaseFirestore.DocumentSnapshot): number {
    const createdAt = doc.get("createdAt");
    if (createdAt instanceof Timestamp) {
      return createdAt.toMillis();
    }

    if (createdAt instanceof Date) {
      return createdAt.getTime();
    }

    if (typeof createdAt === "string") {
      const parsed = Date.parse(createdAt);
      return Number.isNaN(parsed) ? 0 : parsed;
    }

    return 0;
  }

  private async fetchUserNotificationDocs(
    userId: string,
  ): Promise<FirebaseFirestore.QueryDocumentSnapshot[]> {
    const snapshot = await this.userQuery(userId)
      .limit(MAX_IN_MEMORY_INBOX_SCAN)
      .get();

    return snapshot.docs.sort(
      (left, right) =>
        this.getCreatedAtMs(right) - this.getCreatedAtMs(left),
    );
  }

  private async countUnreadInMemory(userId: string): Promise<number> {
    const docs = await this.fetchUserNotificationDocs(userId);
    return docs.filter((doc) => doc.get("leida") !== true).length;
  }

  private async listInboxInMemory(
    userId: string,
    options: { limit?: number; cursor?: string } = {},
  ): Promise<NotificationInboxPage> {
    const pageSize = Math.min(
      Math.max(options.limit || DEFAULT_PAGE_SIZE, 1),
      MAX_PAGE_SIZE,
    );
    const sortedDocs = await this.fetchUserNotificationDocs(userId);
    const cursor = options.cursor?.trim();
    let startIndex = 0;

    if (cursor) {
      const cursorIndex = sortedDocs.findIndex((doc) => doc.id === cursor);
      if (cursorIndex >= 0) {
        startIndex = cursorIndex + 1;
      }
    }

    const pageDocs = sortedDocs.slice(startIndex, startIndex + pageSize + 1);
    const hasMore = pageDocs.length > pageSize;
    const docs = hasMore ? pageDocs.slice(0, pageSize) : pageDocs;
    const items = docs.map((doc) => this.mapDocument(doc));

    return {
      items,
      unreadCount: sortedDocs.filter((doc) => doc.get("leida") !== true).length,
      nextCursor: hasMore && docs.length > 0 ? docs[docs.length - 1].id : null,
      hasMore,
    };
  }

  private toIsoString(value: unknown): string | undefined {
    if (value instanceof Timestamp) {
      return value.toDate().toISOString();
    }

    if (value instanceof Date) {
      return value.toISOString();
    }

    if (typeof value === "string" && value.trim().length > 0) {
      const parsed = new Date(value);
      return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
    }

    return undefined;
  }

  private mapDocument(
    doc: FirebaseFirestore.DocumentSnapshot,
  ): NotificationInboxItem {
    const data = doc.data() || {};
    const rawPayload = (data.payload || {}) as Record<string, unknown>;
    const type = this.toText(data.tipo);
    const category = this.toText(data.categoria);

    const payload: NotificationInboxPayload = {
      notificationId: this.toText(rawPayload.notificationId) || doc.id,
      eventId: this.toText(rawPayload.eventId),
      type: this.toText(rawPayload.type) || type,
      category: this.toText(rawPayload.category) || category,
      entityType: this.toText(rawPayload.entityType),
      entityId: this.toText(rawPayload.entityId),
      deeplink: this.toText(rawPayload.deeplink),
      screen: this.toText(rawPayload.screen) || "home",
      priority: this.toText(rawPayload.priority) || "normal",
    };

    return {
      id: doc.id,
      type,
      category,
      title: this.toText(data.titulo),
      body: this.toText(data.mensaje),
      read: data.leida === true,
      createdAt: this.toIsoString(data.createdAt) || new Date().toISOString(),
      readAt: this.toIsoString(data.leidaAt),
      payload,
    };
  }

  async countUnread(userId: string): Promise<number> {
    try {
      const snapshot = await this.userQuery(userId)
        .where("leida", "==", false)
        .count()
        .get();

      return snapshot.data().count;
    } catch (error) {
      if (!this.isMissingIndexError(error)) {
        throw error;
      }

      return this.countUnreadInMemory(userId);
    }
  }

  async listInbox(
    userId: string,
    options: { limit?: number; cursor?: string } = {},
  ): Promise<NotificationInboxPage> {
    try {
      const pageSize = Math.min(
        Math.max(options.limit || DEFAULT_PAGE_SIZE, 1),
        MAX_PAGE_SIZE,
      );

      // Pedimos un documento extra para saber si hay página siguiente sin
      // necesidad de un count adicional.
      let query = this.userQuery(userId)
        .orderBy("createdAt", "desc")
        .limit(pageSize + 1);

      const cursor = options.cursor?.trim();
      if (cursor) {
        const cursorSnapshot = await this.collection.doc(cursor).get();

        // Un cursor de otro usuario no debe permitir paginar su bandeja.
        if (
          cursorSnapshot.exists &&
          cursorSnapshot.get("destinatarioUid") === userId
        ) {
          query = query.startAfter(cursorSnapshot);
        }
      }

      const snapshot = await query.get();
      const hasMore = snapshot.size > pageSize;
      const docs = hasMore ? snapshot.docs.slice(0, pageSize) : snapshot.docs;
      const items = docs.map((doc) => this.mapDocument(doc));

      return {
        items,
        unreadCount: await this.countUnread(userId),
        nextCursor:
          hasMore && docs.length > 0 ? docs[docs.length - 1].id : null,
        hasMore,
      };
    } catch (error) {
      if (!this.isMissingIndexError(error)) {
        throw error;
      }

      return this.listInboxInMemory(userId, options);
    }
  }

  async markRead(
    userId: string,
    notificationIds: string[],
  ): Promise<NotificationInboxReadResult> {
    const uniqueIds = Array.from(
      new Set(notificationIds.map((id) => id.trim()).filter(Boolean)),
    ).slice(0, MAX_IDS_PER_READ);

    if (uniqueIds.length === 0) {
      return { updated: 0, unreadCount: await this.countUnread(userId) };
    }

    const refs = uniqueIds.map((id) => this.collection.doc(id));
    const snapshots = await firestoreApp.getAll(...refs);
    const now = Timestamp.now();
    const batch = firestoreApp.batch();
    let updated = 0;

    for (const snapshot of snapshots) {
      // Nunca marcamos como leída una notificación de otro destinatario.
      if (
        !snapshot.exists ||
        snapshot.get("destinatarioUid") !== userId ||
        snapshot.get("leida") === true
      ) {
        continue;
      }

      batch.update(snapshot.ref, {
        leida: true,
        leidaAt: now,
        updatedAt: now,
      });
      updated += 1;
    }

    if (updated > 0) {
      await batch.commit();
    }

    return { updated, unreadCount: await this.countUnread(userId) };
  }

  async markAllRead(userId: string): Promise<NotificationInboxReadResult> {
    const now = Timestamp.now();
    let updated = 0;

    try {
      // Recorremos por lotes para no cargar bandejas grandes en memoria.
      for (;;) {
        const snapshot = await this.userQuery(userId)
          .where("leida", "==", false)
          .limit(MARK_ALL_BATCH_SIZE)
          .get();

        if (snapshot.empty) {
          break;
        }

        const batch = firestoreApp.batch();
        snapshot.docs.forEach((doc) => {
          batch.update(doc.ref, { leida: true, leidaAt: now, updatedAt: now });
        });
        await batch.commit();
        updated += snapshot.size;

        if (snapshot.size < MARK_ALL_BATCH_SIZE) {
          break;
        }
      }
    } catch (error) {
      if (!this.isMissingIndexError(error)) {
        throw error;
      }

      const unreadDocs = (await this.fetchUserNotificationDocs(userId)).filter(
        (doc) => doc.get("leida") !== true,
      );

      if (unreadDocs.length > 0) {
        const batch = firestoreApp.batch();
        unreadDocs.forEach((doc) => {
          batch.update(doc.ref, { leida: true, leidaAt: now, updatedAt: now });
        });
        await batch.commit();
        updated = unreadDocs.length;
      }
    }

    return { updated, unreadCount: await this.countUnread(userId) };
  }

  async deleteNotification(
    userId: string,
    notificationId: string,
  ): Promise<{ deleted: boolean; unreadCount: number }> {
    const ref = this.collection.doc(notificationId.trim());
    const snapshot = await ref.get();

    if (!snapshot.exists || snapshot.get("destinatarioUid") !== userId) {
      return { deleted: false, unreadCount: await this.countUnread(userId) };
    }

    await ref.delete();

    return { deleted: true, unreadCount: await this.countUnread(userId) };
  }
}

export const notificationInboxService = new NotificationInboxService();
export default notificationInboxService;
