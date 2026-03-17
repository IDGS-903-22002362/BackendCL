import { Timestamp } from "firebase-admin/firestore";
import notificationConfig from "../../config/notification.config";
import { firestoreApp } from "../../config/app.firebase";
import { firestoreTienda } from "../../config/firebase";
import {
  NotificationCampaignDocument,
} from "../../models/notificacion.model";
import { EstadoOrden, Orden } from "../../models/orden.model";
import { Producto } from "../../models/producto.model";
import { notificationCollections } from "./collections";

const PRODUCTOS_COLLECTION = "productos";
const CARRITOS_COLLECTION = "carritos";
const ORDENES_COLLECTION = "ordenes";

class NotificationAudienceService {
  private readonly productCache = new Map<string, Producto | null>();

  private toTimestampDaysAgo(days: number): Timestamp {
    return Timestamp.fromDate(
      new Date(Date.now() - days * 24 * 60 * 60 * 1000),
    );
  }

  private async getProduct(productId: string): Promise<Producto | null> {
    if (this.productCache.has(productId)) {
      return this.productCache.get(productId) || null;
    }

    const snapshot = await firestoreTienda
      .collection(PRODUCTOS_COLLECTION)
      .doc(productId)
      .get();
    const product = snapshot.exists ? (snapshot.data() as Producto) : null;

    this.productCache.set(productId, product);
    return product;
  }

  async getInterestedUserIdsForProduct(productId: string): Promise<string[]> {
    const interestedUserIds = new Set<string>();
    const recentCartCutoff = this.toTimestampDaysAgo(
      notificationConfig.windows.productInterestLookbackDays,
    );
    const recentOrderCutoff = this.toTimestampDaysAgo(
      notificationConfig.windows.orderLookbackDays,
    );

    const [cartSnapshot, orderSnapshot] = await Promise.all([
      firestoreTienda
        .collection(CARRITOS_COLLECTION)
        .where("updatedAt", ">=", recentCartCutoff)
        .get(),
      firestoreTienda
        .collection(ORDENES_COLLECTION)
        .where("createdAt", ">=", recentOrderCutoff)
        .get(),
    ]);

    for (const cartDoc of cartSnapshot.docs) {
      const cartData = cartDoc.data() as {
        usuarioId?: string;
        items?: Array<{ productoId?: string }>;
      };

      if (
        cartData.usuarioId &&
        Array.isArray(cartData.items) &&
        cartData.items.some((item) => item.productoId === productId)
      ) {
        interestedUserIds.add(String(cartData.usuarioId));
      }
    }

    for (const orderDoc of orderSnapshot.docs) {
      const orderData = orderDoc.data() as Orden;

      if (
        orderData.estado !== EstadoOrden.CANCELADA &&
        orderData.usuarioId &&
        Array.isArray(orderData.items) &&
        orderData.items.some((item) => item.productoId === productId)
      ) {
        interestedUserIds.add(String(orderData.usuarioId));
      }
    }

    return Array.from(interestedUserIds);
  }

  private async userMatchesCampaign(
    userId: string,
    campaign: NotificationCampaignDocument,
  ): Promise<boolean> {
    const requestedProductIds = new Set(campaign.productIds || []);
    const requestedLineIds = new Set(campaign.lineIds || []);
    const requestedCategoryIds = new Set(campaign.categoryIds || []);

    if (
      requestedProductIds.size === 0 &&
      requestedLineIds.size === 0 &&
      requestedCategoryIds.size === 0
    ) {
      return true;
    }

    const orderCutoff = this.toTimestampDaysAgo(
      notificationConfig.windows.orderLookbackDays,
    );
    const ordersSnapshot = await firestoreTienda
      .collection(ORDENES_COLLECTION)
      .where("createdAt", ">=", orderCutoff)
      .get();

    const userOrders = ordersSnapshot.docs
      .map((doc) => doc.data() as Orden)
      .filter(
        (order) =>
          order.usuarioId === userId && order.estado !== EstadoOrden.CANCELADA,
      );

    for (const order of userOrders) {
      for (const item of order.items || []) {
        if (!item.productoId) {
          continue;
        }

        if (requestedProductIds.has(item.productoId)) {
          return true;
        }

        const product = await this.getProduct(item.productoId);

        if (!product) {
          continue;
        }

        if (
          requestedLineIds.has(product.lineaId) ||
          requestedCategoryIds.has(product.categoriaId)
        ) {
          return true;
        }
      }
    }

    return false;
  }

  async listUsersForCampaign(
    campaign: NotificationCampaignDocument,
    limit = notificationConfig.scheduler.campaignBatchSize,
  ): Promise<string[]> {
    const sourceData = (campaign.sourceData || {}) as {
      userIds?: unknown;
    };
    const sourceUserIds = Array.isArray(sourceData.userIds)
      ? sourceData.userIds
          .filter((value): value is string => typeof value === "string")
          .map((value) => value.trim())
          .filter(Boolean)
      : [];

    if (sourceUserIds.length > 0) {
      return Array.from(new Set(sourceUserIds)).slice(0, limit);
    }

    const usersSnapshot = await firestoreApp
      .collection(notificationCollections.users)
      .where("activo", "==", true)
      .limit(limit * 3)
      .get();

    const userIds: string[] = [];

    for (const userDoc of usersSnapshot.docs) {
      const userData = userDoc.data() as { uid?: string; rol?: string };
      const userId = String(userData.uid || userDoc.id).trim();

      if (!userId || userData.rol === "ADMIN" || userData.rol === "EMPLEADO") {
        continue;
      }

      if (await this.userMatchesCampaign(userId, campaign)) {
        userIds.push(userId);
      }

      if (userIds.length >= limit) {
        break;
      }
    }

    return userIds;
  }

  async listProbableRepurchaseCandidates(): Promise<
    Array<{
      userId: string;
      orderId: string;
      productIds: string[];
    }>
  > {
    const olderThan = this.toTimestampDaysAgo(
      notificationConfig.windows.probableRepurchaseDays,
    );
    const repurchaseWindowStart = this.toTimestampDaysAgo(
      notificationConfig.windows.probableRepurchaseDays + 30,
    );

    const [oldOrdersSnapshot, recentOrdersSnapshot] = await Promise.all([
      firestoreTienda
        .collection(ORDENES_COLLECTION)
        .where("createdAt", ">=", repurchaseWindowStart)
        .where("createdAt", "<=", olderThan)
        .get(),
      firestoreTienda
        .collection(ORDENES_COLLECTION)
        .where("createdAt", ">=", olderThan)
        .get(),
    ]);

    const recentBuyerIds = new Set<string>();
    for (const doc of recentOrdersSnapshot.docs) {
      const order = doc.data() as Orden;
      if (order.estado !== EstadoOrden.CANCELADA && order.usuarioId) {
        recentBuyerIds.add(String(order.usuarioId));
      }
    }

    const latestEligibleOrderByUser = new Map<
      string,
      {
        createdAtMillis: number;
        orderId: string;
        productIds: string[];
      }
    >();

    for (const doc of oldOrdersSnapshot.docs) {
      const order = doc.data() as Orden;

      if (
        order.estado === EstadoOrden.CANCELADA ||
        !order.usuarioId ||
        recentBuyerIds.has(String(order.usuarioId))
      ) {
        continue;
      }

      const createdAtMillis = order.createdAt?.toMillis?.() || 0;
      const existing = latestEligibleOrderByUser.get(order.usuarioId);

      if (!existing || createdAtMillis > existing.createdAtMillis) {
        latestEligibleOrderByUser.set(order.usuarioId, {
          createdAtMillis,
          orderId: doc.id,
          productIds: (order.items || [])
            .map((item) => item.productoId)
            .filter((value): value is string => typeof value === "string"),
        });
      }
    }

    return Array.from(latestEligibleOrderByUser.entries())
      .slice(0, notificationConfig.scheduler.repurchaseBatchSize)
      .map(([userId, value]) => ({
        userId,
        orderId: value.orderId,
        productIds: value.productIds,
      }));
  }
}

export const notificationAudienceService = new NotificationAudienceService();
export default notificationAudienceService;
