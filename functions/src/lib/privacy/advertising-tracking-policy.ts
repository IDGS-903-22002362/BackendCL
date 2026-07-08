import type { ClientOrigin } from "../../types/client-origin";
import { isEmbeddedAppOrigin } from "../../middlewares/client-origin.middleware";

/**
 * App Store privacy requirement:
 * Advertising and cross-site tracking must remain disabled when the
 * storefront is embedded in the iOS or Android application.
 */
export function canSendAdvertisingConversion(origin: ClientOrigin): boolean {
  return !isEmbeddedAppOrigin(origin);
}

export function canSendAdvertisingConversionForOrder(order: {
  clientOrigin?: ClientOrigin;
  advertisingTrackingAllowed?: boolean;
}): boolean {
  if (typeof order.advertisingTrackingAllowed === "boolean") {
    return order.advertisingTrackingAllowed;
  }

  if (order.clientOrigin) {
    return canSendAdvertisingConversion(order.clientOrigin);
  }

  return true;
}
