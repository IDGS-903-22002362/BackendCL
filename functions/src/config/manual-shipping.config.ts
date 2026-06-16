export const MANUAL_FEDEX_SHIPPING_COST = 150;
export const MANUAL_FEDEX_CURRENCY = "MXN";
export const MANUAL_FEDEX_METHOD = "manual_fedex";
export const MANUAL_FEDEX_STATUS = "pending_manual_shipment";
export const MANUAL_FEDEX_PROVIDER = "MANUAL";
export const MANUAL_FEDEX_CARRIER = "FEDEX";

export const buildFedexTrackingUrl = (trackingNumber: string): string =>
  `https://www.fedex.com/fedextrack/?trknbr=${encodeURIComponent(trackingNumber)}`;
