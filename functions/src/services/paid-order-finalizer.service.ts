import { Timestamp } from "firebase-admin/firestore";
import { firestoreTienda } from "../config/firebase";
import {
  EstadoOrden,
  Orden,
  PaymentState,
  FulfillmentMethod,
} from "../models/orden.model";
import { COLECCION_PAGOS, EstadoPago, PaymentStatus } from "../models/pago.model";
import { buildPaidOrderStatePatch } from "../utils/build-paid-order-patch.util";
import logger from "../utils/logger";
import { getFedexConfig } from "../modules/shipping/fedex/fedex.config";
import {
  fedexShipService,
  FedexShipError,
} from "../modules/shipping/fedex/fedex-ship.service";
import { canSendAdvertisingConversionForOrder } from "../lib/privacy/advertising-tracking-policy";

const ORDENES_COLLECTION = "ordenes";
const SHIPPING_EVENTS_COLLECTION = "shipping_events";

const paidOrderFinalizerLogger = logger.child({
  component: "paid-order-finalizer-service",
});

const hasFedexTrackingLabel = (shipping: Orden["shipping"]): boolean => {
  if (!shipping || shipping.provider !== "FEDEX") {
    return false;
  }

  const fedexShipping = shipping as Record<string, unknown>;
  return (
    typeof fedexShipping.trackingNumber === "string" ||
    fedexShipping.status === "LABEL_CREATED"
  );
};

export interface FinalizePaidOrderInput {
  orderId: string;
  provider: "stripe" | "aplazo";
  sourceEventId?: string;
  paymentAttemptId?: string;
  requestedBy?: string;
  /** Solo usar cuando el caller ya verificó el pago con el proveedor (p. ej. webhook Stripe paid). */
  paymentConfirmed?: boolean;
}

const safeErrorMessage = (error: unknown): string =>
  error instanceof Error && error.message
    ? error.message.slice(0, 500)
    : "Error desconocido al generar guía FedEx";

const PAID_PAYMENT_STATUSES = new Set<string>([
  PaymentStatus.PAID,
  PaymentStatus.AUTHORIZED,
  "paid",
  "succeeded",
  "completado",
  "completed",
]);

class PaidOrderFinalizerService {
  private async assertPaymentConfirmed(
    input: FinalizePaidOrderInput,
  ): Promise<void> {
    if (input.paymentAttemptId) {
      const pagoDoc = await firestoreTienda
        .collection(COLECCION_PAGOS)
        .doc(input.paymentAttemptId)
        .get();
      if (pagoDoc.exists) {
        const pago = pagoDoc.data() as {
          estado?: EstadoPago;
          status?: PaymentStatus | string;
        };
        const status = String(pago.status || "").toLowerCase();
        if (
          pago.estado === EstadoPago.COMPLETADO ||
          PAID_PAYMENT_STATUSES.has(status)
        ) {
          return;
        }
      }
    }

    const pagosSnapshot = await firestoreTienda
      .collection(COLECCION_PAGOS)
      .where("ordenId", "==", input.orderId)
      .orderBy("createdAt", "desc")
      .limit(5)
      .get();

    const hasConfirmedPayment = pagosSnapshot.docs.some((doc) => {
      const pago = doc.data() as {
        estado?: EstadoPago;
        status?: PaymentStatus | string;
      };
      const status = String(pago.status || "").toLowerCase();
      return (
        pago.estado === EstadoPago.COMPLETADO ||
        PAID_PAYMENT_STATUSES.has(status)
      );
    });

    if (!hasConfirmedPayment) {
      paidOrderFinalizerLogger.warn("finalize_paid_order_skipped_unconfirmed_payment", {
        orderId: input.orderId,
        paymentAttemptId: input.paymentAttemptId,
      });
      throw new Error(
        "No se puede finalizar la orden: el pago no está confirmado",
      );
    }
  }

  private async writePaymentConfirmedEvent(input: FinalizePaidOrderInput): Promise<void> {
    const eventId = `payment_confirmed_${input.orderId}`;
    try {
      await firestoreTienda
        .collection(SHIPPING_EVENTS_COLLECTION)
        .doc(eventId)
        .create({
          orderId: input.orderId,
          provider: input.provider.toUpperCase(),
          type: "PAYMENT_CONFIRMED",
          sourceEventId: input.sourceEventId,
          paymentAttemptId: input.paymentAttemptId,
          createdBy: input.requestedBy || "system",
          createdAt: Timestamp.now(),
        });
    } catch (error) {
      const code = String((error as { code?: unknown })?.code || "").toLowerCase();
      const message = String(
        (error as { message?: unknown })?.message || "",
      ).toLowerCase();
      if (code === "6" || code === "already-exists" || message.includes("already exists")) {
        return;
      }
      throw error;
    }
  }

  private async commitPromotionalCounters(order: Orden): Promise<void> {
    if (order.codigoPromocionId) {
      try {
        const { codigosPromocionService } = await import(
          "./codigos-promocion.service"
        );
        const cantidadUsada = order.items.reduce(
          (total, item) => total + Math.max(0, item.cantidad),
          0,
        );
        await codigosPromocionService.registrarUsoOrden({
          ordenId: order.id!,
          codigoPromocionId: order.codigoPromocionId,
          cantidadUsada: Math.max(1, cantidadUsada),
        });
      } catch (error) {
        paidOrderFinalizerLogger.error("codigo_promocion_usage_failed", {
          orderId: order.id,
          codigoPromocionId: order.codigoPromocionId,
          errorMessage: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const pricingItems = order.pricingSnapshot?.items ?? [];
    const pricingHasOffers = pricingItems.some(
      (item) => typeof item.ofertaAplicadaId === "string" && item.ofertaAplicadaId,
    );

    try {
      const { ofertasService } = await import("./ofertas.service");
      const offerItems = pricingHasOffers
        ? pricingItems.map((item) => ({
            ofertaAplicadaId: item.ofertaAplicadaId,
            quantity: item.quantity,
          }))
        : (
            await ofertasService.calcularPreciosCarrito(
              order.items.map((item) => ({
                productoId: item.productoId,
                cantidad: item.cantidad,
                ...(item.tallaId ? { tallaId: item.tallaId } : {}),
              })),
            )
          ).items.map((item) => ({
            ofertaAplicadaId: item.ofertaAplicadaId,
            quantity: item.cantidad,
          }));

      await ofertasService.commitOfferStockForOrder({
        ordenId: order.id!,
        items: offerItems,
      });
    } catch (error) {
      paidOrderFinalizerLogger.error("oferta_stock_commit_failed", {
        orderId: order.id,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Marca la orden como pagada y lista para preparación (idempotente).
   * Cierra el gap del flujo checkout-attempt donde createOrden inicia en PENDIENTE.
   */
  async applyPaidOrderStatePatch(orderId: string): Promise<boolean> {
    const orderRef = firestoreTienda.collection(ORDENES_COLLECTION).doc(orderId);
    const orderDoc = await orderRef.get();
    if (!orderDoc.exists) {
      return false;
    }

    const order = orderDoc.data() as Orden;
    const paymentStatus = String(order.paymentStatus || "").toUpperCase();
    if (
      paymentStatus === PaymentState.PAGADO &&
      order.estado === EstadoOrden.CONFIRMADA
    ) {
      return false;
    }

    await orderRef.set(
      {
        estado: EstadoOrden.CONFIRMADA,
        ...buildPaidOrderStatePatch(order),
        updatedAt: Timestamp.now(),
      },
      { merge: true },
    );

    paidOrderFinalizerLogger.info("paid_order_state_patch_applied", {
      orderId,
      priorPaymentStatus: order.paymentStatus,
      priorEstado: order.estado,
    });

    return true;
  }

  async finalizePaidOrder(input: FinalizePaidOrderInput): Promise<void> {
    const orderRef = firestoreTienda.collection(ORDENES_COLLECTION).doc(input.orderId);
    const orderDoc = await orderRef.get();
    if (!orderDoc.exists) {
      return;
    }

    const order = { id: orderDoc.id, ...(orderDoc.data() as Orden) };

    /**
     * App Store privacy requirement:
     * Advertising and cross-site tracking must remain disabled when the
     * storefront is embedded in the iOS or Android application.
     */
    if (!canSendAdvertisingConversionForOrder(order)) {
      paidOrderFinalizerLogger.info("advertising_conversion_skipped_embedded_app", {
        orderId: input.orderId,
        clientOrigin: order.clientOrigin ?? "unknown",
      });
    }

    if (!input.paymentConfirmed) {
      await this.assertPaymentConfirmed(input);
    } else {
      await this.applyPaidOrderStatePatch(input.orderId);
    }

    const { default: ordenService } = await import("./orden.service");
    await ordenService.commitStockForOrder(input.orderId);
    await this.commitPromotionalCounters(order);

    try {
      const { earnLoyaltyPointsForPaidOrder } = await import(
        "../modules/loyalty/events/payment-loyalty.hook"
      );
      await earnLoyaltyPointsForPaidOrder(input.orderId);
    } catch (error) {
      paidOrderFinalizerLogger.error("loyalty_earn_hook_failed", {
        orderId: input.orderId,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
    }

    const cartId = order.paymentMetadata?.cartId;
    if (typeof cartId === "string" && cartId.trim()) {
      const { default: carritoService } = await import("./carrito.service");
      await carritoService.clearCartAfterSuccessfulPayment(cartId.trim());
    }

    await this.writePaymentConfirmedEvent(input);

    try {
      const { default: adminNotificationService } = await import(
        "./admin-notification.service"
      );
      const pagoSnapshot = await firestoreTienda
        .collection("pagos")
        .where("ordenId", "==", input.orderId)
        .orderBy("createdAt", "desc")
        .limit(1)
        .get();
      const pagoId = pagoSnapshot.docs[0]?.id ?? input.orderId;
      await adminNotificationService.notifyPaymentConfirmed(
        input.orderId,
        pagoId,
      );
    } catch (error) {
      paidOrderFinalizerLogger.error("admin_notification_payment_confirmed_failed", {
        orderId: input.orderId,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
    }

    if (
      order.fulfillmentMethod === FulfillmentMethod.PICKUP ||
      order.shipping?.provider !== "FEDEX" ||
      hasFedexTrackingLabel(order.shipping)
    ) {
      return;
    }

    if (!getFedexConfig().autoCreateLabelOnPaid) {
      return;
    }

    try {
      await fedexShipService.createShipmentForOrder(input.orderId);
    } catch (error) {
      if (error instanceof FedexShipError || error instanceof Error) {
        await fedexShipService.markShipmentLabelFailed({
          orderId: input.orderId,
          errorMessage: safeErrorMessage(error),
          createdBy: input.requestedBy || "system",
        });
      }
    }
  }
}

export const paidOrderFinalizerService = new PaidOrderFinalizerService();
export default paidOrderFinalizerService;
