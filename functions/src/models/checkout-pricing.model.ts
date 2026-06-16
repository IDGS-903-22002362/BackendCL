export type CheckoutShippingMethod = "PICKUP" | "FEDEX" | "MANUAL";

export type CheckoutPaymentProvider = "STRIPE" | "APLAZO";

export type CheckoutAddressValidationStatus =
  | "VALIDATED"
  | "SUGGESTED"
  | "USER_CONFIRMED"
  | "NOT_VALIDATED"
  | "VALIDATION_UNAVAILABLE";

export type CheckoutShippingAddress = {
  streetLines: string[];
  city?: string;
  stateOrProvinceCode?: string;
  postalCode: string;
  countryCode: string;
  residential?: boolean;
  addressValidationStatus?: CheckoutAddressValidationStatus;
};

export type CheckoutShippingSelection = {
  method: CheckoutShippingMethod;
  provider?: "FEDEX" | "MANUAL";
  carrier?: "FEDEX";
  shippingMethod?: string;
  serviceType?: string;
  serviceName?: string;
  carrierCode?: string;
  packagingType?: string;
  quotedAmount?: number;
  quotedCurrency?: string;
  transitTime?: string;
  deliveryTimestamp?: string;
};

export type CheckoutItemPricingSnapshot = {
  productId: string;
  tallaId?: string;
  quantity: number;
  productName?: string;
  sku?: string;
  unitPriceOriginal: number;
  unitPriceFinal: number;
  subtotalOriginal: number;
  subtotalFinal: number;
  discountTotal: number;
  ofertaAplicadaId?: string | null;
  ofertaTitulo?: string | null;
  weightKg?: number;
  lengthCm?: number;
  widthCm?: number;
  heightCm?: number;
  requiereEnvio?: boolean;
};

export type CheckoutShippingSnapshot = {
  method: CheckoutShippingMethod;
  provider?: "FEDEX" | "MANUAL";
  carrier?: "FEDEX";
  shippingMethod?: string;
  serviceType?: string;
  serviceName?: string;
  carrierCode?: string;
  packagingType?: string;
  amount: number;
  currency: string;
  transitTime?: string;
  deliveryTimestamp?: string;
  deliveryDayOfWeek?: string;
  address?: CheckoutShippingAddress;
  addressValidationStatus?: CheckoutAddressValidationStatus;
  rateTransactionId?: string;
  availabilityTransactionId?: string;
  quotedAt: string;
  warnings?: string[];
  status?: string;
  quoteId?: string;
  selectedOptionId?: string;
  selectedRate?: Record<string, unknown>;
  packages?: Array<Record<string, unknown>>;
  destination?: Record<string, unknown>;
  trackingNumber?: string;
  trackingUrl?: string;
  createdManually?: boolean;
  manualEvidence?: {
    receiptUrl?: string;
    guidePdfUrl?: string;
    realShippingCost?: number;
    notes?: string;
  };
};

export type CheckoutPricingSnapshot = {
  currency: string;
  subtotalOriginal: number;
  subtotalFinal: number;
  discountTotal: number;
  shippingTotal: number;
  total: number;
  items: CheckoutItemPricingSnapshot[];
  shipping: CheckoutShippingSnapshot;
  warnings: string[];
  calculatedAt: string;
};

export type CheckoutPricingInput = {
  userId?: string;
  cartId?: string;
  cartItems?: unknown[];
  shippingSelection: CheckoutShippingSelection;
  shippingAddress?: CheckoutShippingAddress;
  paymentProvider?: CheckoutPaymentProvider;
  shippingQuoteId?: string;
  selectedShippingOptionId?: string;
  selectedServiceType?: string;
};

export type CheckoutFlowErrorCode =
  | "CHECKOUT_CART_EMPTY"
  | "CHECKOUT_PRODUCT_NOT_FOUND"
  | "CHECKOUT_PRODUCT_INACTIVE"
  | "CHECKOUT_STOCK_UNAVAILABLE"
  | "CHECKOUT_PRICE_CHANGED"
  | "CHECKOUT_OFFER_RECALCULATION_FAILED"
  | "PRODUCT_SHIPPING_DATA_MISSING"
  | "SHIPPING_ADDRESS_REQUIRED"
  | "SHIPPING_RATE_CHANGED"
  | "FEDEX_SERVICE_NOT_AVAILABLE"
  | "FEDEX_RATE_UNAVAILABLE"
  | "PAYMENT_PROVIDER_NOT_SUPPORTED"
  | "CHECKOUT_TOTAL_INVALID";

export class CheckoutFlowError extends Error {
  code: CheckoutFlowErrorCode;
  statusCode: number;
  data?: Record<string, unknown>;

  constructor(
    code: CheckoutFlowErrorCode,
    message: string,
    statusCode = 400,
    data?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "CheckoutFlowError";
    this.code = code;
    this.statusCode = statusCode;
    this.data = data;
    Error.captureStackTrace(this, this.constructor);
  }
}
