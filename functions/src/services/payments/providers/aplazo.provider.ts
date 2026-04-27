import axios, { AxiosError, AxiosRequestConfig } from "axios";
import { createHash } from "crypto";
import {
  AplazoChannel,
  AplazoCommunicationChannel,
  assertAplazoEnabled,
  getAplazoConfig,
} from "../../../config/aplazo.config";
import { ProveedorPago, RefundState } from "../../../models/pago.model";
import logger from "../../../utils/logger";
import {
  CreateInStoreProviderInput,
  CreateOnlineProviderInput,
  PaymentProvider,
  ProviderCancelOrVoidInput,
  ProviderRefundInput,
  ProviderRefundStatusInput,
  ProviderWebhookInput,
} from "../payment-provider.interface";
import {
  NormalizedProviderWebhookEvent,
  PaymentAttempt,
  ProviderCreatePaymentResult,
  ProviderRefundResult,
  ProviderRefundStatusEntry,
  ProviderStatusResult,
} from "../payment-domain.types";
import {
  createPaymentProviderError,
  createPaymentProviderNetworkError,
  createPaymentProviderTimeoutError,
  createPaymentValidationError,
  PaymentApiError,
} from "../payment-api-error";
import { PaymentStatus } from "../payment-status.enum";
import {
  AplazoContractConfig,
  getAplazoContractConfig,
  getAplazoContractTodoMessage,
  sanitizeAplazoPayload,
} from "../aplazo.contract.v1";
import {
  isValidEmail,
  maskToken,
  normalizeEmail,
  normalizeMxPhoneForAplazo,
  normalizeWhitespace,
  sanitizeAxiosErrorData,
  sanitizeOutgoingProviderPayload,
  sanitizeProviderHeaders,
} from "../payment-sanitizer";

type JsonRecord = Record<string, unknown>;
type RequestHeaders = Record<string, string>;

const TODO_PRODUCTS_ONLINE = getAplazoContractTodoMessage("shape de products[] online");
const aplazoLogger = logger.child({ component: "aplazo-provider" });

const normalizeComparable = (value: string): string => {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[\/_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
};

const isRecord = (value: unknown): value is JsonRecord => {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
};

const toTrimmedString = (value: unknown): string | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
};

const toIdentifierString = (value: unknown): string | undefined => {
  const asString = toTrimmedString(value);
  if (asString) {
    return asString;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  return undefined;
};

const toNumber = (value: unknown): number | undefined => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
};

const toAplazoNumericWhenPossible = (
  value: string | undefined,
): string | number | undefined => {
  const normalized = toTrimmedString(value);
  if (!normalized) {
    return undefined;
  }

  return /^\d+$/.test(normalized) ? Number(normalized) : normalized;
};

const resolveOnlineAuthMerchantId = (
  merchantId: string | undefined,
): number => {
  const normalized = toTrimmedString(merchantId);
  const numericMerchantId = toAplazoNumericWhenPossible(normalized);

  if (typeof numericMerchantId === "number") {
    return numericMerchantId;
  }

  throw new PaymentApiError(
    503,
    "PAYMENT_PROVIDER_ERROR",
    "APLAZO_ONLINE_MERCHANT_ID debe ser numérico para auth",
  );
};

const normalizeCurrencyOrThrow = (currency?: string): "MXN" => {
  const normalized = toTrimmedString(currency)?.toUpperCase();
  if (!normalized || normalized !== "MXN") {
    throw new PaymentApiError(
      400,
      "PAYMENT_VALIDATION_ERROR",
      "Aplazo online solo soporta currency MXN",
      {
        receivedCurrency: currency,
        expectedCurrency: "MXN",
      },
    );
  }

  return "MXN";
};

const collectPayloadVariants = (payload: unknown): JsonRecord[] => {
  if (!isRecord(payload)) {
    return [];
  }

  const variants: JsonRecord[] = [payload];
  const nestedKeys = ["data", "result", "payload", "response"];
  nestedKeys.forEach((key) => {
    const candidate = payload[key];
    if (isRecord(candidate)) {
      variants.push(candidate);
    }
  });

  return variants;
};

const pickString = (payload: unknown, keys: string[]): string | undefined => {
  const variants = collectPayloadVariants(payload);
  for (const variant of variants) {
    for (const key of keys) {
      const value = toTrimmedString(variant[key]);
      if (value) {
        return value;
      }
    }
  }

  return undefined;
};

const pickNumber = (payload: unknown, keys: string[]): number | undefined => {
  const variants = collectPayloadVariants(payload);
  for (const variant of variants) {
    for (const key of keys) {
      const value = toNumber(variant[key]);
      if (typeof value === "number") {
        return value;
      }
    }
  }

  return undefined;
};

const pickIdentifier = (payload: unknown, keys: string[]): string | undefined => {
  const variants = collectPayloadVariants(payload);
  for (const variant of variants) {
    for (const key of keys) {
      const value = toIdentifierString(variant[key]);
      if (value) {
        return value;
      }
    }
  }

  return undefined;
};

const getRecordArray = (payload: unknown): JsonRecord[] => {
  if (Array.isArray(payload)) {
    return payload.filter(isRecord);
  }

  if (!isRecord(payload)) {
    return [];
  }

  const nestedArrays = ["data", "items", "results", "refunds"];
  for (const key of nestedArrays) {
    const candidate = payload[key];
    if (Array.isArray(candidate)) {
      return candidate.filter(isRecord);
    }
  }

  return [];
};

const getPrimaryRecord = (payload: unknown): JsonRecord | undefined => {
  if (isRecord(payload)) {
    return payload;
  }

  return getRecordArray(payload)[0];
};

const parseAplazoDateValue = (value: unknown): Date | undefined => {
  return parseAplazoDate(toTrimmedString(value));
};

const selectRefundStatusEntry = (
  entries: ProviderRefundStatusEntry[],
  refundId?: string,
): ProviderRefundStatusEntry | undefined => {
  if (entries.length === 0) {
    return undefined;
  }

  if (refundId) {
    const matched = entries.find((entry) => {
      return entry.refundId === refundId;
    });
    return matched;
  }

  return [...entries].sort((left, right) => {
    const leftDate = parseAplazoDate(left.refundDate)?.getTime() || 0;
    const rightDate = parseAplazoDate(right.refundDate)?.getTime() || 0;
    if (rightDate !== leftDate) {
      return rightDate - leftDate;
    }

    const leftStateRank = getRefundStateRank(left.refundState);
    const rightStateRank = getRefundStateRank(right.refundState);
    if (rightStateRank !== leftStateRank) {
      return rightStateRank - leftStateRank;
    }

    const leftId = toNumber(left.refundId) || 0;
    const rightId = toNumber(right.refundId) || 0;
    return rightId - leftId;
  })[0];
};

const getRefundStateRank = (state: RefundState): number => {
  switch (state) {
    case RefundState.SUCCEEDED:
      return 4;
    case RefundState.PROCESSING:
      return 3;
    case RefundState.REQUESTED:
      return 2;
    case RefundState.FAILED:
      return 1;
    case RefundState.NONE:
    default:
      return 0;
  }
};

const buildRefundStatusEntry = (
  entry: JsonRecord,
): ProviderRefundStatusEntry | undefined => {
  const refundId = pickIdentifier(entry, ["id", "refundId", "refund_id"]);
  const providerStatus = pickString(entry, ["status", "refundStatus", "state"]);
  const refundDate =
    pickString(entry, ["refundDate", "requestedAt", "createdAt"]) ||
    parseAplazoDateValue(entry.refundDate)?.toISOString();
  const amountMinor = majorToMinor(
    pickNumber(entry, ["totalAmount", "refundAmount", "amount"]),
  );

  if (!refundId && !providerStatus && !refundDate && typeof amountMinor !== "number") {
    return undefined;
  }

  return {
    refundId,
    providerStatus,
    refundState: resolveRefundState(providerStatus),
    refundDate,
    amountMinor,
  };
};

const extractRefundStatusEntries = (
  payload: unknown,
): ProviderRefundStatusEntry[] => {
  const entries = getRecordArray(payload);
  if (entries.length > 0) {
    return entries
      .map((entry) => buildRefundStatusEntry(entry))
      .filter((entry): entry is ProviderRefundStatusEntry => Boolean(entry));
  }

  if (isRecord(payload)) {
    const singleEntry = buildRefundStatusEntry(payload);
    return singleEntry ? [singleEntry] : [];
  }

  return [];
};

const getMetadataString = (
  metadata: Record<string, unknown> | undefined,
  key: string,
): string | undefined => {
  if (!metadata) {
    return undefined;
  }

  return toTrimmedString(metadata[key]);
};

const getMetadataNumber = (
  metadata: Record<string, unknown> | undefined,
  key: string,
): number | undefined => {
  if (!metadata) {
    return undefined;
  }

  return toNumber(metadata[key]);
};

const throwContractError = (fieldName: string): never => {
  throw new PaymentApiError(
    503,
    "PAYMENT_PROVIDER_ERROR",
    getAplazoContractTodoMessage(fieldName),
  );
};

const requireBaseUrl = (
  contract: AplazoContractConfig,
  kind: keyof AplazoContractConfig["baseUrls"],
): string => {
  const value = contract.baseUrls[kind];
  if (!value) {
    throw new PaymentApiError(
      503,
      "PAYMENT_PROVIDER_ERROR",
      `Falta configurar Aplazo ${contract.channel}.${kind} base URL`,
    );
  }
  return value;
};

const requirePath = (
  contract: AplazoContractConfig,
  kind: keyof AplazoContractConfig["paths"],
  todo?: boolean,
): string => {
  const value = contract.paths[kind];
  if (!value) {
    if (todo) {
      throwContractError(`${contract.channel}.${String(kind)}Path`);
    }

    throw new PaymentApiError(
      503,
      "PAYMENT_PROVIDER_ERROR",
      `Falta configurar Aplazo ${contract.channel}.${String(kind)} path`,
    );
  }
  return value;
};

const minorToMajor = (amountMinor: number | undefined): number => {
  if (typeof amountMinor !== "number" || !Number.isFinite(amountMinor)) {
    return 0;
  }

  return Number((amountMinor / 100).toFixed(2));
};

const majorToMinor = (amount: number | undefined): number | undefined => {
  if (typeof amount !== "number" || !Number.isFinite(amount)) {
    return undefined;
  }

  return Math.round(amount * 100);
};

const replaceCartIdPath = (path: string, cartId: string): string => {
  return path.replace("{cartId}", encodeURIComponent(cartId));
};

const parseAplazoDate = (value: unknown): Date | undefined => {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value;
  }

  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }

  return undefined;
};

const getHeader = (
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | undefined => {
  const value = headers[name.toLowerCase()] ?? headers[name];
  if (Array.isArray(value)) {
    return value[0];
  }

  return typeof value === "string" ? value.trim() : undefined;
};

const buildClient = (
  baseURL: string,
  timeoutMs: number,
  headers?: RequestHeaders,
) => {
  return axios.create({
    baseURL,
    timeout: timeoutMs,
    headers,
  });
};

const resolveAplazoStatus = (providerStatus?: string): PaymentStatus => {
  const normalized = normalizeComparable(providerStatus || "");

  switch (normalized) {
    case "co":
      return PaymentStatus.PAID;
    case "pe":
      return PaymentStatus.PENDING_CUSTOMER;
    case "ca":
      return PaymentStatus.CANCELED;
    case "activo":
    case "active":
    case "paid":
    case "approved":
    case "success":
    case "completed":
    case "outstanding":
    case "historical":
      return PaymentStatus.PAID;
    case "no confirmado":
    case "not confirmed":
    case "pending":
    case "created":
    case "initiated":
    case "request":
      return PaymentStatus.PENDING_CUSTOMER;
    case "processing":
      return PaymentStatus.PENDING_PROVIDER;
    case "authorized":
      return PaymentStatus.AUTHORIZED;
    case "cancelado":
    case "cancelled":
    case "canceled":
      return PaymentStatus.CANCELED;
    case "failed":
    case "rejected":
      return PaymentStatus.FAILED;
    case "expired":
      return PaymentStatus.EXPIRED;
    case "devuelto":
    case "returned":
    case "refunded":
      return PaymentStatus.REFUNDED;
    case "partially refunded":
    case "partial refund":
    case "refund parcial":
      return PaymentStatus.PARTIALLY_REFUNDED;
    default:
      return PaymentStatus.PENDING_PROVIDER;
  }
};

const resolveRefundState = (providerStatus?: string): RefundState => {
  const normalized = resolveAplazoStatus(providerStatus);
  if (
    normalized === PaymentStatus.REFUNDED ||
    normalized === PaymentStatus.PARTIALLY_REFUNDED
  ) {
    return RefundState.SUCCEEDED;
  }

  if (normalized === PaymentStatus.FAILED || normalized === PaymentStatus.CANCELED) {
    return RefundState.FAILED;
  }

  if (
    normalized === PaymentStatus.PENDING_PROVIDER ||
    normalized === PaymentStatus.PENDING_CUSTOMER ||
    normalized === PaymentStatus.AUTHORIZED
  ) {
    return RefundState.PROCESSING;
  }

  return RefundState.REQUESTED;
};

const resolveShopId = (
  channel: AplazoChannel,
  contract: AplazoContractConfig,
  metadata?: Record<string, unknown>,
): string | number => {
  const configuredShopId =
    (channel === "online"
      ? process.env.APLAZO_ONLINE_SHOP_ID
      : process.env.APLAZO_INSTORE_SHOP_ID) || undefined;
  const candidate =
    getMetadataString(metadata, "shopId") ||
    toTrimmedString(configuredShopId) ||
    (channel === "in_store"
      ? getMetadataString(metadata, "sucursalId")
      : undefined) ||
    contract.merchantId;

  if (!candidate) {
    throw new PaymentApiError(
      400,
      "PAYMENT_VALIDATION_ERROR",
      "No fue posible resolver shopId para Aplazo",
    );
  }

  return toAplazoNumericWhenPossible(candidate) ?? candidate;
};

const resolveInStoreShopId = (
  contract: AplazoContractConfig,
  metadata?: Record<string, unknown>,
): string => {
  const shopId = String(resolveShopId("in_store", contract, metadata));
  if (!/^\d+$/.test(shopId)) {
    throw createPaymentValidationError("shopId inválido para Aplazo in-store", {
      shopId,
    });
  }

  return shopId;
};

const resolveCartId = (
  input:
    | CreateOnlineProviderInput
    | CreateInStoreProviderInput
    | PaymentAttempt
    | Record<string, unknown>,
): string => {
  if ("providerReference" in input) {
    const providerReference = toTrimmedString(input.providerReference);
    if (providerReference) {
      return providerReference;
    }
  }

  if ("metadata" in input && isRecord(input.metadata)) {
    const metadataCartId = getMetadataString(input.metadata, "cartId");
    if (metadataCartId) {
      return metadataCartId;
    }
  }

  if ("paymentAttemptId" in input) {
    const paymentAttemptId = toTrimmedString(input.paymentAttemptId);
    if (paymentAttemptId) {
      return paymentAttemptId;
    }
  }

  if ("id" in input) {
    const id = toTrimmedString(input.id);
    if (id) {
      return id;
    }
  }

  throw new PaymentApiError(
    400,
    "PAYMENT_VALIDATION_ERROR",
    "No fue posible resolver cartId para Aplazo",
  );
};

const buildProducts = (
  pricingSnapshot: PaymentAttempt["pricingSnapshot"],
  _todoMessage: string,
): JsonRecord[] => {
  const items = pricingSnapshot?.items || [];
  if (items.length === 0) {
    throw createPaymentValidationError(
      "No fue posible construir products[] válidos para Aplazo",
      {
        reason: "PRODUCTS_EMPTY",
      },
    );
  }

  return items.map((item, index) => {
    const name = normalizeWhitespace(item.name || item.productoId || `item_${index + 1}`);
    const quantity = item.cantidad;
    const unitPrice = minorToMajor(item.precioUnitarioMinor);

    if (!name || quantity <= 0 || unitPrice <= 0) {
      throw createPaymentValidationError(
        "No fue posible construir products[] válidos para Aplazo",
        {
          reason: "PRODUCT_INVALID",
          index,
          productoId: item.productoId,
          quantity,
          unitPrice,
        },
      );
    }

    return {
      id: item.productoId,
      count: quantity,
      description: name,
      price: unitPrice,
      title: name,
      imageUrl: item.imageUrl,
    };
  });
};

const resolveAplazoDiscountType = (
  value: string | undefined,
  fallback: "a" | "p",
): "a" | "p" => {
  const normalized = value?.toLowerCase();
  if (!normalized) {
    return fallback;
  }

  if (normalized === "a" || normalized === "p") {
    return normalized;
  }

  throw createPaymentValidationError("discountType debe ser a o p");
};

const buildInStoreProducts = (
  pricingSnapshot: PaymentAttempt["pricingSnapshot"],
): JsonRecord[] => {
  const items = pricingSnapshot?.items || [];
  if (items.length === 0) {
    throw createPaymentValidationError(
      "No fue posible construir products[] válidos para Aplazo",
      {
        reason: "PRODUCTS_EMPTY",
      },
    );
  }

  return items.map((item, index) => {
    const title = normalizeWhitespace(
      item.name || item.sku || item.productoId || `item_${index + 1}`,
    );
    const quantity = item.cantidad;
    const unitPriceMinor = item.precioUnitarioMinor;
    const lineUnitPriceMinor =
      quantity > 0 ? Math.round(item.subtotalMinor / quantity) : 0;
    const discountMinor = Math.max(0, unitPriceMinor - lineUnitPriceMinor);
    const discountType = discountMinor > 0 ? "a" : "p";
    const discountPriceMinor = Math.max(0, unitPriceMinor - discountMinor);

    if (!title || quantity <= 0 || unitPriceMinor <= 0 || discountPriceMinor <= 0) {
      throw createPaymentValidationError(
        "No fue posible construir products[] válidos para Aplazo",
        {
          reason: "PRODUCT_INVALID",
          index,
          productoId: item.productoId,
          quantity,
          unitPrice: minorToMajor(unitPriceMinor),
        },
      );
    }

    return {
      id: item.productoId,
      externalId: item.sku || item.productoId,
      quantity,
      unitPrice: minorToMajor(unitPriceMinor),
      discount: minorToMajor(discountMinor),
      discountType,
      discountPrice: minorToMajor(discountPriceMinor),
      title,
      description: title,
    };
  });
};

const buildInStoreTaxes = (
  input: CreateInStoreProviderInput,
): JsonRecord[] => {
  const taxMinor = input.pricingSnapshot?.taxMinor || 0;
  if (taxMinor <= 0) {
    return [];
  }

  return [
    {
      price: minorToMajor(taxMinor),
      title: getMetadataString(input.metadata, "taxTitle") || "IVA",
    },
  ];
};

const resolveAttemptAmountMajor = (paymentAttempt: PaymentAttempt): number => {
  if (
    typeof paymentAttempt.amountMinor === "number" &&
    Number.isFinite(paymentAttempt.amountMinor)
  ) {
    return minorToMajor(paymentAttempt.amountMinor);
  }

  return Number((paymentAttempt.monto || 0).toFixed(2));
};

const buildInStoreCancelPayload = (
  input: ProviderCancelOrVoidInput,
  cartId: string,
): JsonRecord => {
  return {
    cartId,
    totalAmount: resolveAttemptAmountMajor(input.paymentAttempt),
    reason:
      normalizeWhitespace(input.reason) ||
      "Cancelación solicitada por comercio",
  };
};

const buildInStoreRefundPayload = (
  input: ProviderRefundInput,
  cartId: string,
  refundAmountMinor: number | undefined,
): JsonRecord => {
  return {
    cartId,
    totalAmount: minorToMajor(refundAmountMinor),
    reason:
      normalizeWhitespace(input.reason) ||
      "Devolución solicitada por comercio",
  };
};

const splitFullName = (
  value?: string,
): { firstName?: string; lastName?: string } => {
  const normalized = normalizeWhitespace(value);
  if (!normalized) {
    return {};
  }

  const [firstName, ...rest] = normalized.split(" ");
  return {
    firstName,
    lastName: rest.length > 0 ? rest.join(" ") : firstName,
  };
};

const buildBuyerPayload = (input: {
  name?: string;
  email?: string;
  phone?: string;
  metadata?: Record<string, unknown>;
}): JsonRecord | undefined => {
  const buyer: JsonRecord = {};
  const { firstName, lastName } = splitFullName(input.name);
  if (firstName) {
    buyer.firstName = firstName;
  }
  if (lastName) {
    buyer.lastName = lastName;
  }
  const normalizedEmail = normalizeEmail(input.email);
  if (normalizedEmail) {
    if (!isValidEmail(normalizedEmail)) {
      throw createPaymentValidationError("Email inválido para Aplazo");
    }
    buyer.email = normalizedEmail;
  }
  if (input.phone) {
    const normalizedPhone = normalizeMxPhoneForAplazo(input.phone);
    if (!normalizedPhone) {
      throw createPaymentValidationError("Teléfono inválido para Aplazo");
    }
    buyer.phone = normalizedPhone;
  }

  const addressLine = getMetadataString(input.metadata, "addressLine");
  const postalCode = getMetadataString(input.metadata, "postalCode");
  if (addressLine) {
    buyer.addressLine = addressLine;
  }
  if (postalCode) {
    buyer.postalCode = postalCode;
  }

  return Object.keys(buyer).length > 0 ? buyer : undefined;
};

const validateOnlinePayloadInput = (
  input: CreateOnlineProviderInput,
  payload: JsonRecord,
): void => {
  if (typeof input.amountMinor !== "number" || input.amountMinor <= 0) {
    throw createPaymentValidationError("Monto inválido para Aplazo", {
      amountMinor: input.amountMinor,
    });
  }

  if (!toTrimmedString(String(payload.shopId ?? ""))) {
    throw createPaymentValidationError("No fue posible resolver shopId para Aplazo");
  }

  if (!toTrimmedString(String(payload.cartId ?? ""))) {
    throw createPaymentValidationError("No fue posible resolver cartId para Aplazo");
  }

  if (!toTrimmedString(input.successUrl)) {
    throw createPaymentValidationError(
      "Aplazo online requiere successUrl y failureUrl/cancelUrl",
    );
  }

  if (!toTrimmedString(input.failureUrl || input.cancelUrl)) {
    throw createPaymentValidationError(
      "Aplazo online requiere successUrl y failureUrl/cancelUrl",
    );
  }

  if (!toTrimmedString(input.cartUrl)) {
    throw createPaymentValidationError("Aplazo online requiere cartUrl");
  }

  if (!toTrimmedString(input.webhookUrl)) {
    throw createPaymentValidationError("Aplazo online requiere webHookUrl");
  }

  const buyer = isRecord(payload.buyer) ? payload.buyer : undefined;
  if (!buyer) {
    throw createPaymentValidationError("Aplazo online requiere buyer");
  }

  const requiredBuyerFields = ["firstName", "lastName", "email", "phone"];
  requiredBuyerFields.forEach((field) => {
    if (!toTrimmedString(String(buyer[field] ?? ""))) {
      throw createPaymentValidationError(
        `Aplazo online requiere buyer.${field}`,
      );
    }
  });

  if (!Array.isArray(payload.products) || payload.products.length === 0) {
    throw createPaymentValidationError(
      "No fue posible construir products[] válidos para Aplazo",
    );
  }
};

const buildRequestLogContext = (input: {
  channel: AplazoChannel;
  paymentAttemptId?: string;
  providerReference?: string;
  url: string;
  merchantId?: string;
  payload?: unknown;
}) => {
  return {
    channel: input.channel,
    url: input.url,
    paymentAttemptId: input.paymentAttemptId,
    providerReference: input.providerReference,
    merchantId: maskToken(input.merchantId) || input.merchantId,
    payload: sanitizeOutgoingProviderPayload(input.payload),
  };
};

const buildOnlineAplazoPayload = (
  input: CreateOnlineProviderInput,
  contract: AplazoContractConfig,
  cartId: string,
): JsonRecord => {
  const pricingSnapshot = input.pricingSnapshot;
  const currency = normalizeCurrencyOrThrow(input.currency);
  const subtotalMinor = pricingSnapshot?.subtotalMinor || input.amountMinor;
  const taxMinor = pricingSnapshot?.taxMinor || 0;
  const shippingMinor = pricingSnapshot?.shippingMinor || 0;
  const composedMinor = subtotalMinor + taxMinor + shippingMinor;
  const discountMinor = Math.max(0, composedMinor - input.amountMinor);
  const products = buildProducts(pricingSnapshot, TODO_PRODUCTS_ONLINE);
  const productsMinor = products.reduce((sum, product) => {
    const quantity = toNumber(product.count) || 0;
    const unitPrice = toNumber(product.price) || 0;
    return sum + Math.round(unitPrice * 100) * quantity;
  }, 0);
  const recomposedMinor = productsMinor + taxMinor + shippingMinor - discountMinor;

  if (recomposedMinor !== input.amountMinor) {
    throw new PaymentApiError(
      409,
      "PAYMENT_AMOUNT_MISMATCH",
      "El payload de Aplazo no cuadra con el monto total recalculado",
      {
        amountMinor: input.amountMinor,
        productsMinor,
        taxMinor,
        shippingMinor,
        discountMinor,
      },
    );
  }

  const payload: JsonRecord = {
    totalPrice: minorToMajor(input.amountMinor),
    currency,
    shopId: resolveShopId("online", contract, input.metadata),
    cartId,
    successUrl: input.successUrl,
    errorUrl: input.failureUrl || input.cancelUrl,
    webHookUrl: input.webhookUrl,
    shipping: {
      price: minorToMajor(shippingMinor),
      title: getMetadataString(input.metadata, "shippingTitle") || "Envio",
    },
    taxes: {
      price: minorToMajor(taxMinor),
      title: getMetadataString(input.metadata, "taxTitle") || "IVA",
    },
    discount: {
      price: minorToMajor(discountMinor),
      title: getMetadataString(input.metadata, "discountTitle") || "Descuento",
    },
    products,
  };

  const buyer = buildBuyerPayload({
    name: input.customerName,
    email: input.customerEmail,
    phone: input.customerPhone,
    metadata: input.metadata,
  });
  if (buyer) {
    payload.buyer = buyer;
  }

  if (input.cartUrl) {
    payload.cartUrl = input.cartUrl;
  }

  validateOnlinePayloadInput(input, payload);
  return payload;
};

const resolveCommChannel = (
  input: CreateInStoreProviderInput,
): AplazoCommunicationChannel => {
  const fromMetadata = getMetadataString(input.metadata, "commChannel")?.toLowerCase();
  const configuredDefault = getAplazoConfig().inStore.defaultCommChannel || "q";
  const value = fromMetadata || configuredDefault;

  if (value === "q" || value === "w" || value === "s") {
    return value;
  }

  throw new PaymentApiError(
    400,
    "PAYMENT_VALIDATION_ERROR",
    "commChannel debe ser q, w o s",
  );
};

const buildInStoreAplazoPayload = (
  input: CreateInStoreProviderInput,
  contract: AplazoContractConfig,
  cartId: string,
): JsonRecord => {
  const custLogin = normalizeMxPhoneForAplazo(input.customerPhone);
  if (!custLogin) {
    throw createPaymentValidationError("Teléfono inválido para Aplazo");
  }

  if (!toTrimmedString(input.webhookUrl)) {
    throw createPaymentValidationError("Aplazo in-store requiere webhookUrl");
  }

  const orderDiscount = getMetadataNumber(input.metadata, "orderDiscount") || 0;
  const discountType = resolveAplazoDiscountType(
    getMetadataString(input.metadata, "discountType"),
    "a",
  );

  const payload: JsonRecord = {
    custLogin,
    shopId: resolveInStoreShopId(contract, input.metadata),
    cartId,
    webhookUrl: input.webhookUrl,
    products: buildInStoreProducts(input.pricingSnapshot),
    taxes: buildInStoreTaxes(input),
    totalAmount: minorToMajor(input.amountMinor),
    orderDiscount,
    discountType,
    commChannel: resolveCommChannel(input),
  };

  return payload;
};

export const normalizeProviderError = (
  error: unknown,
  context?: {
    providerUrl?: string;
    requestPayload?: unknown;
    providerHeaders?: unknown;
  },
): PaymentApiError => {
  if (error instanceof PaymentApiError) {
    return error;
  }

  const axiosLikeError =
    error instanceof AxiosError
      ? error
      : isRecord(error)
        ? (error as {
            code?: string;
            message?: string;
            response?: {
              status?: number;
              data?: unknown;
              headers?: Record<string, unknown>;
            };
            config?: { url?: string };
          })
        : undefined;

  if (axiosLikeError) {
    const providerHttpStatus = axiosLikeError.response?.status;
    const rawProviderResponse = axiosLikeError.response?.data;
    const providerResponse = sanitizeAxiosErrorData(rawProviderResponse);
    const providerHeaders = sanitizeProviderHeaders(
      axiosLikeError.response?.headers || context?.providerHeaders,
    );
    const providerUrl = axiosLikeError.config?.url || context?.providerUrl;
    const requestPayload = sanitizeOutgoingProviderPayload(context?.requestPayload);
    const providerCode = pickString(rawProviderResponse, [
      "code",
      "error",
      "errorCode",
      "error_code",
    ]);
    const providerParams = sanitizeAxiosErrorData(
      isRecord(rawProviderResponse) ? rawProviderResponse.params : undefined,
    );

    if (
      axiosLikeError.code === "ECONNABORTED" ||
      axiosLikeError.code === "ETIMEDOUT"
    ) {
      return createPaymentProviderTimeoutError(
        "Timeout al comunicarse con Aplazo",
        {
          providerHttpStatus,
          providerResponse,
          providerHeaders,
          providerUrl,
          providerCode,
          providerParams,
          requestPayload,
        },
      );
    }

    if (!axiosLikeError.response) {
      return createPaymentProviderNetworkError(
        "Error de red al comunicarse con Aplazo",
        {
          providerHttpStatus,
          providerResponse: sanitizeAxiosErrorData({
            message: axiosLikeError.message,
            code: axiosLikeError.code,
          }),
          providerHeaders,
          providerUrl,
          providerCode,
          providerParams,
          requestPayload,
        },
      );
    }

    const providerMessage =
      pickString(axiosLikeError.response?.data, ["message", "error", "detail"]) ||
      axiosLikeError.message ||
      "Error desconocido con Aplazo";

    return createPaymentProviderError(
      providerMessage,
      {
        providerHttpStatus,
        providerResponse,
        providerHeaders,
        providerUrl,
        providerCode,
        providerParams,
        requestPayload,
      },
    );
  }

  return createPaymentProviderError(
    error instanceof Error ? error.message : "Error desconocido con Aplazo",
  );
};

export class AplazoProvider implements PaymentProvider {
  readonly provider = ProveedorPago.APLAZO;

  private validateChannelConfig(
    channel: AplazoChannel,
    contract: AplazoContractConfig,
    requiredPaths: Array<keyof AplazoContractConfig["paths"]>,
  ): void {
    const missing: string[] = [];
    const channelLabel = channel === "online" ? "APLAZO_ONLINE" : "APLAZO_INSTORE";

    if (!contract.merchantId) {
      missing.push(`${channelLabel}_MERCHANT_ID`);
    }
    if (!contract.apiToken) {
      missing.push(`${channelLabel}_API_TOKEN`);
    }
    if (!contract.baseUrls.api) {
      missing.push(`${channelLabel}_BASE_URL`);
    }

    requiredPaths.forEach((pathKey) => {
      if (!contract.paths[pathKey]) {
        missing.push(`${channelLabel}_${String(pathKey).toUpperCase()}_PATH`);
      }
    });

    if (missing.length > 0) {
      throw new PaymentApiError(
        503,
        "PAYMENT_PROVIDER_ERROR",
        "APLZ CONFIG MISSING",
        {
          missing,
        },
      );
    }
  }

  private async authenticateOnline(
    contract: AplazoContractConfig,
  ): Promise<RequestHeaders> {
    const apiBaseUrl = requireBaseUrl(contract, "api");
    const authPath = requirePath(contract, "auth");

    if (!contract.merchantId || !contract.apiToken) {
      throw new PaymentApiError(
        503,
        "PAYMENT_PROVIDER_ERROR",
        "Faltan credenciales online de Aplazo",
      );
    }

    try {
      const client = buildClient(apiBaseUrl, contract.timeoutMs);
      const response = await client.post(authPath, {
        apiToken: contract.apiToken,
        merchantId: resolveOnlineAuthMerchantId(contract.merchantId),
      });
      const token =
        pickString(response.data, [
          "authorization",
          "Authorization",
          "token",
          "accessToken",
          "access_token",
          "bearerToken",
        ]) ||
        toTrimmedString(response.headers?.authorization) ||
        toTrimmedString(
          isRecord(response.headers) ? response.headers.Authorization : undefined,
        );

      if (!token) {
        throw new PaymentApiError(
          502,
          "PAYMENT_PROVIDER_ERROR",
          "Aplazo online auth no devolvió token Bearer",
        );
      }

      return {
        Authorization: /^bearer\s+/i.test(token) ? token : `Bearer ${token}`,
      };
    } catch (error) {
      const normalizedError = normalizeProviderError(error, {
        providerUrl: `${apiBaseUrl}${authPath}`,
        requestPayload: {
          apiToken: contract.apiToken,
          merchantId: contract.merchantId,
        },
      });
      aplazoLogger.error("aplazo_online_auth_failed", {
        channel: "online",
        endpoint: authPath,
        baseUrl: apiBaseUrl,
        statusCode: normalizedError.statusCode,
        code: normalizedError.code,
        details: normalizedError.details,
      });
      throw normalizedError;
    }
  }

  private getInStoreHeaders(contract: AplazoContractConfig): RequestHeaders {
    if (!contract.apiToken || !contract.merchantId) {
      throw new PaymentApiError(
        503,
        "PAYMENT_PROVIDER_ERROR",
        "Faltan credenciales in-store de Aplazo",
      );
    }

    return {
      api_token: contract.apiToken,
      merchant_id: contract.merchantId,
    };
  }

  private async request(
    baseURL: string,
    timeoutMs: number,
    config: AxiosRequestConfig,
  ) {
    const client = buildClient(baseURL, timeoutMs, config.headers as RequestHeaders);
    if ((config.method || "get").toLowerCase() === "get") {
      return client.get(config.url || "", { params: config.params });
    }

    return client.request(config);
  }

  private buildProviderStatusResult(
    rawData: unknown,
    fallback: {
      providerLoanId?: string;
      providerReference?: string;
      providerStatus?: string;
    } = {},
  ): ProviderStatusResult {
    const statusData = getPrimaryRecord(rawData) || rawData;
    const providerStatus =
      pickString(statusData, ["status", "loanStatus", "state"]) ||
      fallback.providerStatus ||
      "pending_provider";
    const amountMajor = pickNumber(statusData, [
      "totalPrice",
      "totalAmount",
      "amount",
    ]);

    return {
      status: resolveAplazoStatus(providerStatus),
      providerStatus,
      providerLoanId:
        pickIdentifier(statusData, ["loanId", "loan_id"]) ||
        fallback.providerLoanId,
      providerReference:
        pickIdentifier(statusData, ["cartId", "cart_id"]) ||
        fallback.providerReference,
      amountMinor: majorToMinor(amountMajor),
      currency: pickString(statusData, ["currency"]),
      paidAt:
        parseAplazoDate(
          pickString(statusData, [
            "paidAt",
            "activatedAt",
            "activated_at",
            "updatedAt",
          ]),
        ) || undefined,
      expiresAt:
        parseAplazoDate(
          pickString(statusData, ["expiresAt", "expires_at", "expirationDate"]),
        ) || undefined,
      rawResponseSanitized: sanitizeAplazoPayload(rawData),
    };
  }

  private resolveWebhookChannel(
    payloadMerchantId: string | undefined,
    headers: Record<string, string | string[] | undefined>,
  ): { channel: AplazoChannel; contract: AplazoContractConfig } {
    const onlineContract = getAplazoContractConfig("online");
    const inStoreContract = getAplazoContractConfig("in_store");
    const configuredMerchantIds = [
      onlineContract.merchantId,
      inStoreContract.merchantId,
    ].filter(Boolean);

    const candidates: Array<{ channel: AplazoChannel; contract: AplazoContractConfig }> =
      [];

    if (payloadMerchantId) {
      if (onlineContract.merchantId === payloadMerchantId) {
        candidates.push({ channel: "online", contract: onlineContract });
      }
      if (inStoreContract.merchantId === payloadMerchantId) {
        candidates.push({ channel: "in_store", contract: inStoreContract });
      }

      if (configuredMerchantIds.length > 0 && candidates.length === 0) {
        throw new PaymentApiError(
          400,
          "PAYMENT_VALIDATION_ERROR",
          "merchantId de webhook Aplazo no reconocido",
        );
      }
    }

    if (candidates.length === 0) {
      candidates.push(
        { channel: "online", contract: onlineContract },
        { channel: "in_store", contract: inStoreContract },
      );
    }

    let invalidAuthDetected = false;
    for (const candidate of candidates) {
      try {
        this.validateWebhookAuthorization(candidate.contract, headers);
        return candidate;
      } catch (error) {
        if (
          error instanceof PaymentApiError &&
          error.code === "PAYMENT_WEBHOOK_INVALID_SIGNATURE"
        ) {
          invalidAuthDetected = true;
          continue;
        }
        throw error;
      }
    }

    if (invalidAuthDetected) {
      throw new PaymentApiError(
        400,
        "PAYMENT_WEBHOOK_INVALID_SIGNATURE",
        "Authorization inválido para webhook Aplazo",
      );
    }

    return candidates[0];
  }

  private validateWebhookAuthorization(
    contract: AplazoContractConfig,
    headers: Record<string, string | string[] | undefined>,
  ): void {
    if (!contract.webhookSecret) {
      return;
    }

    const authorization = getHeader(headers, "authorization");
    const scheme = contract.webhookAuthScheme || "Bearer";
    const expected = `${scheme} ${contract.webhookSecret}`;

    if (!authorization || authorization !== expected) {
      throw new PaymentApiError(
        400,
        "PAYMENT_WEBHOOK_INVALID_SIGNATURE",
        "Authorization inválido para webhook Aplazo",
      );
    }
  }

  private async getCheckoutQr(
    contract: AplazoContractConfig,
    cartId: string,
    headers: RequestHeaders,
  ): Promise<{ qrString?: string; qrImageUrl?: string }> {
    const getQrPath = contract.paths.getQr;
    if (!getQrPath) {
      return {};
    }

    const baseURL = contract.baseUrls.merchant || requireBaseUrl(contract, "api");

    try {
      const response = await this.request(baseURL, contract.timeoutMs, {
        method: "get",
        url: replaceCartIdPath(getQrPath, cartId),
        headers,
      });
      return {
        qrString: pickString(response.data, ["qr", "qrString", "code"]),
        qrImageUrl: pickString(response.data, [
          "qrImageUrl",
          "qr_url",
          "qrUrl",
          "imageUrl",
        ]),
      };
    } catch (error) {
      throw normalizeProviderError(error);
    }
  }

  async generateInStoreQr(input: {
    cartId: string;
    shopId: string;
  }): Promise<{ checkoutUrl?: string; qrCode?: string; rawResponseSanitized: JsonRecord }> {
    assertAplazoEnabled("in_store");
    const contract = getAplazoContractConfig("in_store");
    const getQrPath = requirePath(contract, "getQr", true);
    const cartId = normalizeWhitespace(input.cartId);
    const shopId = normalizeWhitespace(input.shopId);

    if (!cartId) {
      throw createPaymentValidationError("cartId inválido para generar QR");
    }

    if (!shopId || !/^\d+$/.test(shopId)) {
      throw createPaymentValidationError("shopId inválido para generar QR");
    }

    const response = await this.request(
      requireBaseUrl(contract, "merchant"),
      contract.timeoutMs,
      {
        method: "get",
        url: getQrPath,
        headers: this.getInStoreHeaders(contract),
        params: {
          cartId,
          shopId,
        },
      },
    );

    return {
      checkoutUrl: pickString(response.data, ["checkoutUrl", "checkout_url", "url"]),
      qrCode: pickString(response.data, ["qrCode", "qr_code", "qr", "qrString"]),
      rawResponseSanitized: sanitizeAplazoPayload(response.data),
    };
  }

  async resendCheckout(
    contract: AplazoContractConfig,
    cartId: string,
    headers: RequestHeaders,
  ): Promise<void> {
    const resendCheckoutPath = contract.paths.resendCheckout;
    if (!resendCheckoutPath) {
      throwContractError("in_store.resendCheckoutPath");
    }

    const baseURL = contract.baseUrls.merchant || requireBaseUrl(contract, "api");

    await this.request(baseURL, contract.timeoutMs, {
      method: "post",
      url: resendCheckoutPath,
      headers,
      data: {
        cartId,
        // TODO: confirmar path y payload exactos de resend checkout con colección Postman de Aplazo
      },
    });
  }

  async resendInStoreCheckout(input: {
    cartId: string;
    phoneNumber: string;
    channels: Array<"WHATSAPP" | "SMS">;
  }): Promise<JsonRecord> {
    assertAplazoEnabled("in_store");
    const contract = getAplazoContractConfig("in_store");
    const resendCheckoutPath = requirePath(contract, "resendCheckout", true);
    const normalizedCartId = normalizeWhitespace(input.cartId);
    if (!normalizedCartId) {
      throw createPaymentValidationError("cartId inválido para reenviar checkout");
    }

    const phoneNumber = normalizeMxPhoneForAplazo(input.phoneNumber);
    if (!phoneNumber) {
      throw createPaymentValidationError("Teléfono inválido para Aplazo");
    }

    const response = await this.request(
      requireBaseUrl(contract, "merchant"),
      contract.timeoutMs,
      {
        method: "post",
        url: replaceCartIdPath(resendCheckoutPath, normalizedCartId),
        headers: this.getInStoreHeaders(contract),
        data: {
          target: {
            phoneNumber,
          },
          channels: input.channels,
        },
      },
    );

    return sanitizeAplazoPayload(response.data);
  }

  async registerMerchantStores(branches: string[]): Promise<JsonRecord[]> {
    assertAplazoEnabled("in_store");
    const contract = getAplazoContractConfig("in_store");
    const registerBranchPath = requirePath(contract, "registerBranch", true);
    const normalizedBranches = branches
      .map((branch) => normalizeWhitespace(branch))
      .filter((branch): branch is string => Boolean(branch));

    if (normalizedBranches.length === 0) {
      throw createPaymentValidationError(
        "Se requiere al menos una sucursal para registrar en Aplazo",
      );
    }

    const response = await this.request(
      requireBaseUrl(contract, "merchant"),
      contract.timeoutMs,
      {
        method: "post",
        url: registerBranchPath,
        headers: this.getInStoreHeaders(contract),
        data: {
          branches: normalizedBranches,
        },
      },
    );

    return getRecordArray(response.data).map((entry) => sanitizeAplazoPayload(entry));
  }

  async createOnline(
    input: CreateOnlineProviderInput,
  ): Promise<ProviderCreatePaymentResult> {
    assertAplazoEnabled("online");
    const contract = getAplazoContractConfig("online");
    this.validateChannelConfig("online", contract, ["auth", "create"]);
    const apiBaseUrl = requireBaseUrl(contract, "api");
    requirePath(contract, "auth");
    const createPath = requirePath(contract, "create");
    const cartId = resolveCartId(input);
    let requestPayload: JsonRecord | undefined;

    try {
      requestPayload = buildOnlineAplazoPayload(input, contract, cartId);
      const headers = await this.authenticateOnline(contract);
      aplazoLogger.info(
        "Aplazo request prepared",
        buildRequestLogContext({
          channel: "online",
          paymentAttemptId: input.paymentAttemptId,
          providerReference: input.providerReference || cartId,
          url: `${apiBaseUrl}${createPath}`,
          merchantId: contract.merchantId,
          payload: requestPayload,
        }),
      );
      const response = await this.request(apiBaseUrl, contract.timeoutMs, {
        method: "post",
        url: createPath,
        headers,
        data: requestPayload,
      });
      aplazoLogger.info("Aplazo response received", {
        channel: "online",
        url: `${apiBaseUrl}${createPath}`,
        paymentAttemptId: input.paymentAttemptId,
        providerReference: input.providerReference || cartId,
        providerHttpStatus: response.status,
        body: sanitizeAxiosErrorData(response.data),
      });
      const rawData = response.data;
      const providerStatus = pickString(rawData, ["status", "loanStatus", "state"]);

      return {
        status: providerStatus
          ? resolveAplazoStatus(providerStatus)
          : PaymentStatus.PENDING_CUSTOMER,
        providerStatus: providerStatus || "pending_customer",
        providerLoanId: pickIdentifier(rawData, ["loanId", "loan_id"]),
        providerReference: pickIdentifier(rawData, ["cartId", "cart_id"]) || cartId,
        redirectUrl: pickString(rawData, [
          "url",
          "checkoutUrl",
          "checkout_url",
          "link",
          "paymentLink",
        ]),
        expiresAt:
          parseAplazoDate(
            pickString(rawData, ["expiresAt", "expires_at", "expirationDate"]),
          ) || undefined,
        rawRequestSanitized: sanitizeAplazoPayload(requestPayload),
        rawResponseSanitized: sanitizeAplazoPayload(rawData),
      };
    } catch (error) {
      const sanitizedRequestPayload = sanitizeOutgoingProviderPayload(requestPayload);
      const normalizedError = normalizeProviderError(error, {
        providerUrl: `${apiBaseUrl}${createPath}`,
        requestPayload: sanitizedRequestPayload,
      });
      aplazoLogger.error("Aplazo request failed", {
        channel: "online",
        paymentAttemptId: input.paymentAttemptId,
        url: `${apiBaseUrl}${createPath}`,
        cartId,
        amountMinor: input.amountMinor,
        providerReference: input.providerReference || cartId,
        requestPayload: sanitizedRequestPayload,
        statusCode: normalizedError.statusCode,
        code: normalizedError.code,
        details: normalizedError.details,
      });
      throw normalizedError;
    }
  }

  async createInStore(
    input: CreateInStoreProviderInput,
  ): Promise<ProviderCreatePaymentResult> {
    assertAplazoEnabled("in_store");
    const contract = getAplazoContractConfig("in_store");
    this.validateChannelConfig("in_store", contract, ["create"]);
    const apiBaseUrl = requireBaseUrl(contract, "api");
    const createPath = requirePath(contract, "create");
    const cartId = resolveCartId(input);

    try {
      const headers = this.getInStoreHeaders(contract);
      const requestPayload = buildInStoreAplazoPayload(input, contract, cartId);
      const response = await this.request(apiBaseUrl, contract.timeoutMs, {
        method: "post",
        url: createPath,
        headers,
        data: requestPayload,
      });
      const rawData = response.data;
      const providerStatus =
        pickString(rawData, ["status", "loanStatus", "state"]) ||
        "pending_customer";
      let qrString = pickString(rawData, ["qr", "qrString", "code"]);
      let qrImageUrl = pickString(rawData, [
        "qrImageUrl",
        "qr_url",
        "qrUrl",
        "imageUrl",
      ]);

      if (
        resolveCommChannel(input) === "q" &&
        (!qrString || !qrImageUrl) &&
        contract.paths.getQr
      ) {
        const qrResult = await this.getCheckoutQr(contract, cartId, headers);
        qrString = qrString || qrResult.qrString;
        qrImageUrl = qrImageUrl || qrResult.qrImageUrl;
      }

      return {
        status: resolveAplazoStatus(providerStatus),
        providerStatus,
        providerLoanId: pickIdentifier(rawData, ["loanId", "loan_id"]),
        providerReference: pickIdentifier(rawData, ["cartId", "cart_id"]) || cartId,
        paymentLink: pickString(rawData, [
          "url",
          "link",
          "paymentLink",
          "checkoutUrl",
        ]),
        qrString,
        qrImageUrl,
        expiresAt:
          parseAplazoDate(
            pickString(rawData, ["expiresAt", "expires_at", "expirationDate"]),
          ) || undefined,
        rawRequestSanitized: sanitizeAplazoPayload(requestPayload),
        rawResponseSanitized: sanitizeAplazoPayload(rawData),
      };
    } catch (error) {
      throw normalizeProviderError(error);
    }
  }

  async getStatus(paymentAttempt: PaymentAttempt): Promise<ProviderStatusResult> {
    const channel = paymentAttempt.flowType === "in_store" ? "in_store" : "online";
    assertAplazoEnabled(channel);
    const contract = getAplazoContractConfig(channel);
    this.validateChannelConfig(channel, contract, ["status"]);

    try {
      if (channel === "online") {
        const merchantBaseUrl = requireBaseUrl(contract, "merchant");
        const statusPath = requirePath(contract, "status");
        const headers = await this.authenticateOnline(contract);
        const params: Record<string, string> = {};

        if (paymentAttempt.providerLoanId) {
          params.loan_id = paymentAttempt.providerLoanId;
        } else if (paymentAttempt.providerReference) {
          params.cart_id = paymentAttempt.providerReference;
        } else {
          throw new PaymentApiError(
            409,
            "PAYMENT_VALIDATION_ERROR",
            "El intento Aplazo online no tiene loanId ni cartId para consultar status",
          );
        }

        const response = await this.request(merchantBaseUrl, contract.timeoutMs, {
          method: "get",
          url: statusPath,
          headers,
          params,
        });

        return this.buildProviderStatusResult(response.data, {
          providerLoanId: paymentAttempt.providerLoanId,
          providerReference: paymentAttempt.providerReference,
          providerStatus: paymentAttempt.providerStatus,
        });
      }

      const apiBaseUrl = requireBaseUrl(contract, "api");
      const cartId = paymentAttempt.providerReference;
      if (!cartId) {
        throw new PaymentApiError(
          409,
          "PAYMENT_VALIDATION_ERROR",
          "El intento Aplazo in-store no tiene cartId para consultar status",
        );
      }

      const response = await this.request(apiBaseUrl, contract.timeoutMs, {
        method: "get",
        url: replaceCartIdPath(requirePath(contract, "status"), cartId),
        headers: this.getInStoreHeaders(contract),
      });

      return this.buildProviderStatusResult(response.data, {
        providerLoanId: paymentAttempt.providerLoanId,
        providerReference: cartId,
        providerStatus: paymentAttempt.providerStatus,
      });
    } catch (error) {
      throw normalizeProviderError(error);
    }
  }

  async parseWebhook(
    input: ProviderWebhookInput,
  ): Promise<NormalizedProviderWebhookEvent> {
    const rawPayload = input.rawBody.toString("utf8");
    let parsedPayload: JsonRecord;

    try {
      const parsed = JSON.parse(rawPayload) as unknown;
      if (!isRecord(parsed)) {
        throw new Error("invalid");
      }
      parsedPayload = parsed;
    } catch (_error) {
      throw new PaymentApiError(
        400,
        "PAYMENT_VALIDATION_ERROR",
        "Webhook Aplazo con JSON inválido",
      );
    }

    const providerStatus = pickString(parsedPayload, ["status"]) || "pending_provider";
    const providerLoanId = pickIdentifier(parsedPayload, ["loanId", "loan_id"]);
    const providerReference = pickIdentifier(parsedPayload, ["cartId", "cart_id"]);
    const merchantId = pickIdentifier(parsedPayload, ["merchantId", "merchant_id"]);
    const eventId = pickString(parsedPayload, ["eventId", "event_id", "id"]);
    const resolvedChannel = this.resolveWebhookChannel(merchantId, input.headers);
    const dedupeKey =
      eventId || createHash("sha256").update(rawPayload).digest("hex");

    const payloadSanitized = sanitizeAplazoPayload({
      ...parsedPayload,
      merchantId,
      resolvedChannel: resolvedChannel.channel,
    });

    return {
      provider: ProveedorPago.APLAZO,
      eventType:
        pickString(parsedPayload, ["eventType", "type"]) ||
        `aplazo.status.${normalizeComparable(providerStatus).replace(/\s+/g, "_")}`,
      eventId,
      dedupeKey,
      providerLoanId,
      providerReference,
      channel: resolvedChannel.channel,
      merchantId,
      status: resolveAplazoStatus(providerStatus),
      providerStatus,
      amountMinor: majorToMinor(
        pickNumber(parsedPayload, ["totalPrice", "totalAmount", "amount"]),
      ),
      currency: pickString(parsedPayload, ["currency"]),
      payloadSanitized,
    };
  }

  async cancelOrVoid(
    input: ProviderCancelOrVoidInput,
  ): Promise<ProviderStatusResult> {
    const channel = input.paymentAttempt.flowType === "in_store" ? "in_store" : "online";
    assertAplazoEnabled(channel);
    const contract = getAplazoContractConfig(channel);
    const cancelPath = requirePath(contract, "cancelOrVoid", true);
    const cartId = input.paymentAttempt.providerReference;

    if (!cartId && !input.paymentAttempt.providerLoanId) {
      throw new PaymentApiError(
        409,
        "PAYMENT_VALIDATION_ERROR",
        "El intento Aplazo no tiene cartId ni loanId para cancelar",
      );
    }
    const cancelReference = cartId || input.paymentAttempt.providerLoanId;
    if (!cancelReference) {
      throw new PaymentApiError(
        409,
        "PAYMENT_VALIDATION_ERROR",
        "El intento Aplazo no tiene cartId ni loanId para cancelar",
      );
    }

    try {
      const headers =
        channel === "online"
          ? await this.authenticateOnline(contract)
          : this.getInStoreHeaders(contract);
      const baseURL =
        channel === "online"
          ? requireBaseUrl(contract, "refunds")
          : requireBaseUrl(contract, "api");
      const response =
        channel === "online"
          ? await this.request(baseURL, contract.timeoutMs, {
              method: "get",
              url: cancelPath,
              headers,
              params: {
                cartId: cancelReference,
              },
            })
          : await this.request(baseURL, contract.timeoutMs, {
              method: "post",
              url: cancelPath,
              headers,
              data: buildInStoreCancelPayload(input, cancelReference),
            });

      const result = this.buildProviderStatusResult(response.data, {
        providerLoanId: input.paymentAttempt.providerLoanId,
        providerReference: cancelReference,
        providerStatus: "cancelado",
      });

      return {
        ...result,
        status:
          result.providerStatus
            ? resolveAplazoStatus(result.providerStatus)
            : PaymentStatus.CANCELED,
      };
    } catch (error) {
      throw normalizeProviderError(error);
    }
  }

  async refund(input: ProviderRefundInput): Promise<ProviderRefundResult> {
    const channel = input.paymentAttempt.flowType === "in_store" ? "in_store" : "online";
    const aplazoConfig = getAplazoConfig();
    if (!aplazoConfig.refundsEnabled) {
      throw new PaymentApiError(
        409,
        "PAYMENT_REFUND_UNSUPPORTED",
        "Refund Aplazo deshabilitado por feature flag",
      );
    }

    assertAplazoEnabled(channel);
    const contract = getAplazoContractConfig(channel);
    const refundPath = requirePath(contract, "refund");
    const cartId = input.paymentAttempt.providerReference;

    if (channel === "in_store" && !cartId) {
      throw new PaymentApiError(
        409,
        "PAYMENT_VALIDATION_ERROR",
        "El refund in-store Aplazo requiere cartId",
      );
    }

    if (channel === "online" && !cartId && !input.paymentAttempt.providerLoanId) {
      throw new PaymentApiError(
        409,
        "PAYMENT_VALIDATION_ERROR",
        "El intento Aplazo no tiene cartId ni loanId para refund",
      );
    }
    const refundReference = cartId || input.paymentAttempt.providerLoanId;
    if (!refundReference) {
      throw new PaymentApiError(
        409,
        "PAYMENT_VALIDATION_ERROR",
        "El intento Aplazo no tiene cartId ni loanId para refund",
      );
    }

    const refundAmountMinor =
      typeof input.refundAmountMinor === "number" &&
      Number.isFinite(input.refundAmountMinor)
        ? input.refundAmountMinor
        : input.paymentAttempt.amountMinor;

    try {
      const headers =
        channel === "online"
          ? await this.authenticateOnline(contract)
          : this.getInStoreHeaders(contract);
      const baseURL =
        channel === "online"
          ? requireBaseUrl(contract, "merchant")
          : requireBaseUrl(contract, "api");
      const response = await this.request(baseURL, contract.timeoutMs, {
        method: "post",
        url: refundPath,
        headers,
        data:
          channel === "online"
            ? {
                cartId: refundReference,
                totalAmount: minorToMajor(refundAmountMinor),
                reason: input.reason,
              }
            : buildInStoreRefundPayload(input, refundReference, refundAmountMinor),
      });

      const providerStatus =
        pickString(response.data, ["status", "refundStatus", "state"]) ||
        "processing";
      const resolvedStatus = resolveAplazoStatus(providerStatus);

      return {
        refundState: resolveRefundState(providerStatus),
        status:
          resolvedStatus === PaymentStatus.PENDING_PROVIDER
            ? undefined
            : resolvedStatus,
        providerStatus,
        refundId: pickIdentifier(response.data, ["refundId", "refund_id"]),
        refundAmountMinor,
        rawResponseSanitized: sanitizeAplazoPayload(response.data),
      };
    } catch (error) {
      throw normalizeProviderError(error);
    }
  }

  async getRefundStatus(
    input: ProviderRefundStatusInput,
  ): Promise<ProviderRefundResult> {
    const channel = input.paymentAttempt.flowType === "in_store" ? "in_store" : "online";
    assertAplazoEnabled(channel);
    const contract = getAplazoContractConfig(channel);
    const refundStatusPath = requirePath(contract, "refundStatus");
    const cartId = input.paymentAttempt.providerReference;

    try {
      if (channel === "online") {
        const merchantBaseUrl = requireBaseUrl(contract, "merchant");
        const headers = await this.authenticateOnline(contract);
        if (!cartId) {
          throw new PaymentApiError(
            409,
            "PAYMENT_VALIDATION_ERROR",
            "El refund online Aplazo requiere cartId para consultar status",
          );
        }

        const response = await this.request(merchantBaseUrl, contract.timeoutMs, {
          method: "get",
          url: refundStatusPath,
          headers,
          params: {
            cartId,
          },
        });
        const refundEntries = extractRefundStatusEntries(response.data);
        const selectedEntry = selectRefundStatusEntry(refundEntries, input.refundId);
        if (input.refundId && !selectedEntry) {
          throw new PaymentApiError(
            404,
            "PAYMENT_REFUND_NOT_FOUND",
            `No se encontró el refund ${input.refundId} para cartId ${cartId}`,
          );
        }

        if (!selectedEntry) {
          return {
            refundState: input.paymentAttempt.refundState ?? RefundState.NONE,
            refundId: input.refundId,
            refundEntries,
            rawResponseSanitized: sanitizeAplazoPayload(response.data),
          };
        }

        return {
          refundState: selectedEntry.refundState,
          status: resolveAplazoStatus(selectedEntry.providerStatus),
          providerStatus: selectedEntry.providerStatus,
          refundId: selectedEntry.refundId || input.refundId,
          refundAmountMinor: selectedEntry.amountMinor,
          refundEntries,
          rawResponseSanitized: sanitizeAplazoPayload(response.data),
        };
      }

      if (!cartId) {
        throw new PaymentApiError(
          409,
          "PAYMENT_VALIDATION_ERROR",
          "El refund in-store Aplazo requiere cartId para consultar status",
        );
      }

      const response = await this.request(
        requireBaseUrl(contract, "api"),
        contract.timeoutMs,
        {
          method: "get",
          url: replaceCartIdPath(refundStatusPath, cartId),
          headers: this.getInStoreHeaders(contract),
        },
      );
      const refundEntries = extractRefundStatusEntries(response.data);
      const selectedEntry = selectRefundStatusEntry(refundEntries, input.refundId);
      if (input.refundId && !selectedEntry) {
        throw new PaymentApiError(
          404,
          "PAYMENT_REFUND_NOT_FOUND",
          `No se encontró el refund ${input.refundId} para cartId ${cartId}`,
        );
      }

      if (!selectedEntry) {
        return {
          refundState: input.paymentAttempt.refundState ?? RefundState.NONE,
          refundId: input.refundId,
          refundEntries,
          rawResponseSanitized: sanitizeAplazoPayload(response.data),
        };
      }

      return {
        refundState: selectedEntry.refundState,
        status: resolveAplazoStatus(selectedEntry.providerStatus),
        providerStatus: selectedEntry.providerStatus,
        refundId: selectedEntry.refundId || input.refundId,
        refundAmountMinor: selectedEntry.amountMinor,
        refundEntries,
        rawResponseSanitized: sanitizeAplazoPayload(response.data),
      };
    } catch (error) {
      throw normalizeProviderError(error);
    }
  }

  mapProviderStatus(providerStatus: string): PaymentStatus {
    return resolveAplazoStatus(providerStatus);
  }
}

export const aplazoProvider = new AplazoProvider();
export default aplazoProvider;
