import { Orden } from "../models/orden.model";
import {
  fedexShipService,
  FedexShipError,
} from "../modules/shipping/fedex/fedex-ship.service";

export class ShippingRefundGuardError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 409) {
    super(message);
    this.name = "ShippingRefundGuardError";
    this.statusCode = statusCode;
    Error.captureStackTrace(this, this.constructor);
  }
}

const isActiveFedexLabel = (shipping: Record<string, any> | undefined): boolean =>
  shipping?.provider === "FEDEX" &&
  Boolean(shipping.trackingNumber) &&
  shipping.status !== "CANCELLED" &&
  shipping.status !== "DELIVERED";

class ShippingRefundGuardService {
  async ensureShipmentCanProceedToRefund(input: {
    orderId: string;
    order: Orden;
    reason?: string;
    requestedByUid?: string;
  }): Promise<void> {
    const shipping = input.order.shipping as Record<string, any> | undefined;

    if (!shipping || shipping.provider !== "FEDEX") {
      return;
    }

    if (shipping.status === "DELIVERED") {
      throw new ShippingRefundGuardError(
        "No se puede reembolsar/cancelar automáticamente una orden con guía FedEx entregada",
      );
    }

    if (!isActiveFedexLabel(shipping)) {
      return;
    }

    try {
      await fedexShipService.cancelShipmentForOrder(
        input.orderId,
        {
          reason:
            input.reason ||
            "Cancelación de guía previa a reembolso/cancelación de orden",
          forceRefreshTracking: true,
        },
        { uid: input.requestedByUid },
      );
    } catch (error) {
      const message =
        error instanceof FedexShipError || error instanceof Error
          ? error.message
          : "No fue posible cancelar la guía FedEx antes del reembolso";
      throw new ShippingRefundGuardError(message);
    }
  }
}

export const shippingRefundGuardService = new ShippingRefundGuardService();
export default shippingRefundGuardService;
