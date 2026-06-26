import {
  FulfillmentMethod,
  FulfillmentStatus,
  Orden,
  PaymentState,
  PreparationStatus,
} from "../models/orden.model";
import {
  MANUAL_FEDEX_METHOD,
  MANUAL_FEDEX_PROVIDER,
  MANUAL_FEDEX_STATUS,
} from "../config/manual-shipping.config";

/**
 * Patch de campos de orden al confirmarse un pago (Stripe/Aplazo).
 * Alineado con buildManualFedexPaidOrderPatch del flujo legacy.
 */
export function buildPaidOrderStatePatch(order?: Orden): Record<string, unknown> {
  const shipping = order?.shipping as Record<string, unknown> | undefined;
  const isManualFedexOrder =
    order?.fulfillmentMethod !== FulfillmentMethod.PICKUP &&
    (shipping?.provider === MANUAL_FEDEX_PROVIDER ||
      shipping?.shippingMethod === MANUAL_FEDEX_METHOD);

  const commonPaidPatch: Record<string, unknown> = {
    paymentStatus: PaymentState.PAGADO,
    preparationStatus: PreparationStatus.PENDING_PREPARATION,
  };

  if (!isManualFedexOrder) {
    return commonPaidPatch;
  }

  return {
    ...commonPaidPatch,
    fulfillmentStatus: FulfillmentStatus.PREPARING,
    shipping: {
      ...(shipping || {}),
      status: MANUAL_FEDEX_STATUS,
    },
  };
}
