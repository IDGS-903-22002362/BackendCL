import { Timestamp } from "firebase-admin/firestore";
import { firestoreTienda } from "../config/firebase";
import { Orden, FulfillmentMethod } from "../models/orden.model";
import carritoService from "./carrito.service";
import ordenService from "./orden.service";
import { getFedexConfig } from "../modules/shipping/fedex/fedex.config";
import {
  fedexShipService,
  FedexShipError,
} from "../modules/shipping/fedex/fedex-ship.service";

const ORDENES_COLLECTION = "ordenes";
const SHIPPING_EVENTS_COLLECTION = "shipping_events";

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

  async finalizePaidOrder(input: FinalizePaidOrderInput): Promise<void> {
    const orderRef = firestoreTienda.collection(ORDENES_COLLECTION).doc(input.orderId);
    const orderDoc = await orderRef.get();
    if (!orderDoc.exists) {
      return;
    }

    const order = { id: orderDoc.id, ...(orderDoc.data() as Orden) };

    await ordenService.commitStockForOrder(input.orderId);

    const cartId = order.paymentMetadata?.cartId;
    if (typeof cartId === "string" && cartId.trim()) {
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
