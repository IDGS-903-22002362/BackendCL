import { Timestamp } from "firebase-admin/firestore";
import { firestoreTienda } from "../config/firebase";
import { Orden, FulfillmentMethod } from "../models/orden.model";
import logger from "../utils/logger";
import { getFedexConfig } from "../modules/shipping/fedex/fedex.config";
import {
  fedexShipService,
  FedexShipError,
} from "../modules/shipping/fedex/fedex-ship.service";

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
}

const safeErrorMessage = (error: unknown): string =>
  error instanceof Error && error.message
    ? error.message.slice(0, 500)
    : "Error desconocido al generar guía FedEx";

class PaidOrderFinalizerService {
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

  async finalizePaidOrder(input: FinalizePaidOrderInput): Promise<void> {
    const orderRef = firestoreTienda.collection(ORDENES_COLLECTION).doc(input.orderId);
    const orderDoc = await orderRef.get();
    if (!orderDoc.exists) {
      return;
    }

    const order = { id: orderDoc.id, ...(orderDoc.data() as Orden) };

    const { default: ordenService } = await import("./orden.service");
    await ordenService.commitStockForOrder(input.orderId);
    await this.commitPromotionalCounters(order);

    const cartId = order.paymentMetadata?.cartId;
    if (typeof cartId === "string" && cartId.trim()) {
      const { default: carritoService } = await import("./carrito.service");
      await carritoService.clearCartAfterSuccessfulPayment(cartId.trim());
    }

    await this.writePaymentConfirmedEvent(input);

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
