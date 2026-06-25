import { firestoreTienda } from "../config/firebase";
import { admin } from "../config/firebase.admin";

export const ADMIN_NOTIFICACIONES_COLLECTION = "adminNotificaciones";

const NOTIFICATION_WINDOW_MS = 72 * 60 * 60 * 1000;

export type AdminNotificationDoc = {
  type: string;
  title: string;
  message: string;
  href: string;
  createdAt: FirebaseFirestore.Timestamp;
  ordenId?: string;
  productoId?: string;
  tallaId?: string;
};

type UpsertAdminNotificationInput = {
  id: string;
  type: string;
  title: string;
  message: string;
  href: string;
  ordenId?: string;
  productoId?: string;
  tallaId?: string;
};

class AdminNotificationService {
  private async upsertNotification(
    input: UpsertAdminNotificationInput,
  ): Promise<void> {
    try {
      const docRef = firestoreTienda
        .collection(ADMIN_NOTIFICACIONES_COLLECTION)
        .doc(input.id);
      const existing = await docRef.get();
      const now = admin.firestore.Timestamp.now();

      const payload: AdminNotificationDoc = {
        type: input.type,
        title: input.title,
        message: input.message,
        href: input.href,
        createdAt: existing.exists
          ? (existing.data()?.createdAt as FirebaseFirestore.Timestamp) ?? now
          : now,
        ...(input.ordenId ? { ordenId: input.ordenId } : {}),
        ...(input.productoId ? { productoId: input.productoId } : {}),
        ...(input.tallaId ? { tallaId: input.tallaId } : {}),
      };

      await docRef.set(payload, { merge: true });
    } catch (error) {
      console.error("admin_notification_write_failed", {
        notificationId: input.id,
        type: input.type,
        message: error instanceof Error ? error.message : error,
      });
    }
  }

  private formatOrdenLabel(ordenId: string): string {
    return ordenId.slice(0, 8).toUpperCase();
  }

  async notifyOrderNew(ordenId: string): Promise<void> {
    const type = "order_new";
    await this.upsertNotification({
      id: `${type}:${ordenId}`,
      type,
      title: "Nueva orden recibida",
      message: `Orden ${this.formatOrdenLabel(ordenId)} (PENDIENTE)`,
      href: `/admin/ordenes?orden=${ordenId}`,
      ordenId,
    });
  }

  async notifyPaymentConfirmed(ordenId: string, pagoId: string): Promise<void> {
    const type = "payment_confirmed";
    await this.upsertNotification({
      id: `${type}:${pagoId}`,
      type,
      title: "Pago confirmado",
      message: `Pago confirmado en orden ${this.formatOrdenLabel(ordenId)}`,
      href: `/admin/ordenes?orden=${ordenId}`,
      ordenId,
    });
  }

  async notifyPaymentFailed(ordenId: string, pagoId: string): Promise<void> {
    const type = "payment_failed";
    await this.upsertNotification({
      id: `${type}:${pagoId}`,
      type,
      title: "Pago fallido",
      message: `Pago fallido en orden ${this.formatOrdenLabel(ordenId)}`,
      href: `/admin/ordenes?orden=${ordenId}`,
      ordenId,
    });
  }

  async notifyStockLow(input: {
    productoId: string;
    idSuffix: string;
    message: string;
    tallaId?: string;
  }): Promise<void> {
    const type = "stock_low";
    const tallaQuery = input.tallaId
      ? `&talla=${encodeURIComponent(input.tallaId)}`
      : "";

    await this.upsertNotification({
      id: `${type}:${input.productoId}:${input.idSuffix}`,
      type,
      title: "Alerta de stock bajo",
      message: input.message,
      href: `/admin/inventario/movimientos?producto=${encodeURIComponent(input.productoId)}${tallaQuery}`,
      productoId: input.productoId,
      ...(input.tallaId ? { tallaId: input.tallaId } : {}),
    });
  }

  async emitStockAlertsForProduct(productoId: string): Promise<void> {
    try {
      const { default: productService } = await import("./product.service");
      const alerts = await productService.listLowStockProducts({
        productoId,
        limit: 5,
        soloCriticas: false,
      });

      for (const alert of alerts) {
        if (alert.globalBajoStock) {
          await this.notifyStockLow({
            productoId: alert.productoId,
            idSuffix: "global",
            message: `${alert.descripcion} (${alert.clave}) - ${alert.existencias} disponibles`,
          });
        }

        for (const talla of alert.tallasBajoStock) {
          await this.notifyStockLow({
            productoId: alert.productoId,
            idSuffix: `talla:${talla.tallaId}`,
            tallaId: talla.tallaId,
            message: `${alert.descripcion} (${alert.clave}) - talla ${talla.tallaId}: ${talla.cantidadActual}/${talla.minimo}`,
          });
        }
      }
    } catch (error) {
      console.error("admin_notification_stock_emit_failed", {
        productoId,
        message: error instanceof Error ? error.message : error,
      });
    }
  }

  getNotificationWindowStart(): FirebaseFirestore.Timestamp {
    return admin.firestore.Timestamp.fromDate(
      new Date(Date.now() - NOTIFICATION_WINDOW_MS),
    );
  }
}

export const adminNotificationService = new AdminNotificationService();
export default adminNotificationService;
