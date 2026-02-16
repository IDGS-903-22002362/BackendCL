import { firestoreApp } from "../config/app.firebase";
import { admin } from "../config/firebase.admin";
import { AlertaStockProducto } from "../models/inventario.model";
import { RolUsuario } from "../models/usuario.model";

const USERS_COLLECTION = "usuariosApp";
const ALERT_STATES_COLLECTION = "alertasStockEstado";
const ALERT_DIGEST_COLLECTION = "alertasStockDigest";
const SYSTEM_NOTIFICATIONS_COLLECTION = "notificacionesSistema";

type LowStockScope = "global" | "talla";

interface LowStockEvent {
  alertKey: string;
  scope: LowStockScope;
  productoId: string;
  clave: string;
  descripcion: string;
  tallaId: string | null;
  cantidadActual: number;
  minimo: number;
  deficit: number;
}

interface RealtimeNotificationResult {
  sent: number;
  skipped: number;
}

class StockAlertService {
  private async getAdminRecipients(): Promise<
    Array<{ uid: string; email?: string; nombre?: string }>
  > {
    const snapshot = await firestoreApp
      .collection(USERS_COLLECTION)
      .where("activo", "==", true)
      .get();

    return snapshot.docs
      .map((doc) => {
        const data = doc.data();
        return {
          uid: String(data.uid ?? "").trim(),
          email: typeof data.email === "string" ? data.email : undefined,
          nombre: typeof data.nombre === "string" ? data.nombre : undefined,
          rol: data.rol as RolUsuario,
        };
      })
      .filter(
        (user) =>
          user.uid.length > 0 &&
          (user.rol === RolUsuario.ADMIN || user.rol === RolUsuario.EMPLEADO),
      )
      .map(({ uid, email, nombre }) => ({ uid, email, nombre }));
  }

  private buildRealtimeEvents(alert: AlertaStockProducto): LowStockEvent[] {
    const events: LowStockEvent[] = [];

    if (alert.globalBajoStock) {
      const deficit = Math.max(0, alert.stockMinimoGlobal - alert.existencias);

      events.push({
        alertKey: `${alert.productoId}__global`,
        scope: "global",
        productoId: alert.productoId,
        clave: alert.clave,
        descripcion: alert.descripcion,
        tallaId: null,
        cantidadActual: alert.existencias,
        minimo: alert.stockMinimoGlobal,
        deficit,
      });
    }

    for (const talla of alert.tallasBajoStock) {
      events.push({
        alertKey: `${alert.productoId}__talla__${talla.tallaId}`,
        scope: "talla",
        productoId: alert.productoId,
        clave: alert.clave,
        descripcion: alert.descripcion,
        tallaId: talla.tallaId,
        cantidadActual: talla.cantidadActual,
        minimo: talla.minimo,
        deficit: talla.deficit,
      });
    }

    return events;
  }

  private buildRealtimeMessage(event: LowStockEvent): string {
    if (event.scope === "global") {
      return `Stock bajo detectado en ${event.descripcion} (${event.clave}). Actual: ${event.cantidadActual}, mínimo: ${event.minimo}.`;
    }

    return `Stock bajo detectado en ${event.descripcion} (${event.clave}) talla ${event.tallaId}. Actual: ${event.cantidadActual}, mínimo: ${event.minimo}.`;
  }

  async notifyRealtime(
    alerts: AlertaStockProducto[],
  ): Promise<RealtimeNotificationResult> {
    if (alerts.length === 0) {
      return { sent: 0, skipped: 0 };
    }

    const recipients = await this.getAdminRecipients();

    if (recipients.length === 0) {
      return { sent: 0, skipped: alerts.length };
    }

    const now = admin.firestore.Timestamp.now();
    let sent = 0;
    let skipped = 0;

    for (const alert of alerts) {
      const events = this.buildRealtimeEvents(alert);

      for (const event of events) {
        const stateRef = firestoreApp
          .collection(ALERT_STATES_COLLECTION)
          .doc(event.alertKey);
        const stateDoc = await stateRef.get();

        const previous = stateDoc.exists
          ? (stateDoc.data() as {
              activo?: boolean;
              cantidadActual?: number;
              minimo?: number;
            })
          : null;

        const isDuplicateState =
          previous?.activo === true &&
          Number(previous.cantidadActual) === event.cantidadActual &&
          Number(previous.minimo) === event.minimo;

        if (isDuplicateState) {
          skipped += 1;
          continue;
        }

        const message = this.buildRealtimeMessage(event);

        for (const recipient of recipients) {
          await firestoreApp.collection(SYSTEM_NOTIFICATIONS_COLLECTION).add({
            tipo: "stock_bajo",
            canal: "in_app",
            destinatarioUid: recipient.uid,
            destinatarioEmail: recipient.email,
            titulo: "Alerta de stock bajo",
            mensaje: message,
            leida: false,
            payload: {
              productoId: event.productoId,
              tallaId: event.tallaId,
              scope: event.scope,
              cantidadActual: event.cantidadActual,
              minimo: event.minimo,
              deficit: event.deficit,
            },
            createdAt: now,
            updatedAt: now,
          });
          sent += 1;
        }

        await stateRef.set(
          {
            activo: true,
            scope: event.scope,
            productoId: event.productoId,
            tallaId: event.tallaId,
            cantidadActual: event.cantidadActual,
            minimo: event.minimo,
            deficit: event.deficit,
            lastNotifiedAt: now,
            updatedAt: now,
          },
          { merge: true },
        );
      }
    }

    return { sent, skipped };
  }

  async notifyDailyDigest(
    alerts: AlertaStockProducto[],
  ): Promise<{ sent: number; skipped: boolean }> {
    const dayKey = new Date().toISOString().slice(0, 10);
    const digestRef = firestoreApp
      .collection(ALERT_DIGEST_COLLECTION)
      .doc(dayKey);
    const digestSnapshot = await digestRef.get();

    if (digestSnapshot.exists) {
      return { sent: 0, skipped: true };
    }

    const recipients = await this.getAdminRecipients();

    if (recipients.length === 0) {
      return { sent: 0, skipped: false };
    }

    const now = admin.firestore.Timestamp.now();
    const totalAlertas = alerts.reduce(
      (acc, item) => acc + item.totalAlertas,
      0,
    );
    const criticas = alerts.filter((item) => item.maxDeficit >= 5).length;

    for (const recipient of recipients) {
      await firestoreApp.collection(SYSTEM_NOTIFICATIONS_COLLECTION).add({
        tipo: "stock_bajo_digest",
        canal: "in_app",
        destinatarioUid: recipient.uid,
        destinatarioEmail: recipient.email,
        titulo: "Resumen diario de stock bajo",
        mensaje: `Se detectaron ${alerts.length} productos con stock bajo y ${totalAlertas} alertas activas en total.`,
        leida: false,
        payload: {
          totalProductos: alerts.length,
          totalAlertas,
          alertasCriticas: criticas,
          fecha: dayKey,
        },
        createdAt: now,
        updatedAt: now,
      });
    }

    await digestRef.set({
      fecha: dayKey,
      totalProductos: alerts.length,
      totalAlertas,
      alertasCriticas: criticas,
      sentAt: now,
    });

    return { sent: recipients.length, skipped: false };
  }
}

export const stockAlertService = new StockAlertService();
export default stockAlertService;
