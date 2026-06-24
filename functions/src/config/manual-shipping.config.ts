export const MANUAL_SHIPPING_COST_LEON = 99;
export const MANUAL_SHIPPING_COST_OUTSIDE_LEON = 299;
export const LEON_POSTAL_CODE_MIN = 37000;
export const LEON_POSTAL_CODE_MAX = 37700;

/** @deprecated Usar calculateManualShippingCost con codigo postal */
export const MANUAL_FEDEX_SHIPPING_COST = MANUAL_SHIPPING_COST_OUTSIDE_LEON;
export const MANUAL_FEDEX_CURRENCY = "MXN";
export const MANUAL_FEDEX_METHOD = "manual_fedex";
export const MANUAL_FEDEX_STATUS = "pending_manual_shipment";
export const MANUAL_FEDEX_PROVIDER = "MANUAL";
export const MANUAL_FEDEX_CARRIER = "FEDEX";

export type ManualShippingZone = "LEON" | "OUTSIDE_LEON";

export const parseMxPostalCode = (value?: string): number | null => {
  const normalized = value?.trim().replace(/\D/g, "");
  if (!normalized || normalized.length !== 5) {
    return null;
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
};

export const isLeonPostalCode = (value?: string): boolean => {
  const parsed = parseMxPostalCode(value);
  if (parsed === null) {
    return false;
  }

  return parsed >= LEON_POSTAL_CODE_MIN && parsed <= LEON_POSTAL_CODE_MAX;
};

export const resolveManualShippingZone = (
  postalCode?: string,
): ManualShippingZone =>
  isLeonPostalCode(postalCode) ? "LEON" : "OUTSIDE_LEON";

export const calculateManualShippingCost = (postalCode?: string): number =>
  isLeonPostalCode(postalCode)
    ? MANUAL_SHIPPING_COST_LEON
    : MANUAL_SHIPPING_COST_OUTSIDE_LEON;

export const buildFedexTrackingUrl = (trackingNumber: string): string =>
  `https://www.fedex.com/fedextrack/?trknbr=${encodeURIComponent(trackingNumber)}`;
