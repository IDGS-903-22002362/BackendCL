import { CheckoutFlowError } from "../models/checkout-pricing.model";
import {
  CheckoutUnavailableItemDetail,
  CheckoutUnavailableItemReason,
  PublicErrorDetails,
} from "../models/checkout-unavailable-item.model";
import { InventoryStockUnavailableError } from "../services/inventory-reservation.service";
import { ApiError } from "./api-error";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object";

const toReason = (value: unknown): CheckoutUnavailableItemReason => {
  if (
    value === "out_of_stock" ||
    value === "reserved_by_other" ||
    value === "inactive"
  ) {
    return value;
  }
  return "out_of_stock";
};

export const normalizeUnavailableItems = (
  input: unknown,
): CheckoutUnavailableItemDetail[] | undefined => {
  if (!isRecord(input)) {
    return undefined;
  }

  const rawItems = input.unavailableItems;
  if (Array.isArray(rawItems) && rawItems.length > 0) {
    const items: CheckoutUnavailableItemDetail[] = [];
    for (const item of rawItems) {
      if (!isRecord(item)) {
        continue;
      }
      const productId = String(item.productId ?? "").trim();
      if (!productId) {
        continue;
      }
      items.push({
        productId,
        productName: String(item.productName ?? "Producto").trim() || "Producto",
        tallaId:
          typeof item.tallaId === "string" && item.tallaId.trim()
            ? item.tallaId.trim()
            : undefined,
        available: Math.max(0, Math.floor(Number(item.available) || 0)),
        requested: Math.max(0, Math.floor(Number(item.requested) || 0)),
        reason: toReason(item.reason),
      });
    }
    return items.length > 0 ? items : undefined;
  }

  const productId = String(input.productId ?? "").trim();
  if (!productId) {
    return undefined;
  }

  return [
    {
      productId,
      productName: String(input.productName ?? "Producto").trim() || "Producto",
      tallaId:
        typeof input.tallaId === "string" && input.tallaId.trim()
          ? input.tallaId.trim()
          : undefined,
      available: Math.max(0, Math.floor(Number(input.available) || 0)),
      requested: Math.max(0, Math.floor(Number(input.requested) || 0)),
      reason: toReason(input.reason),
    },
  ];
};

export const buildUnavailableItemsDetails = (
  items: CheckoutUnavailableItemDetail[],
): PublicErrorDetails | undefined =>
  items.length > 0 ? { unavailableItems: items } : undefined;

export const mapCheckoutErrorToApiError = (
  error: unknown,
): ApiError | null => {
  if (error instanceof ApiError) {
    return error;
  }

  if (error instanceof CheckoutFlowError) {
    const unavailableItems = normalizeUnavailableItems(error.data);
    return new ApiError(
      error.statusCode,
      error.message,
      true,
      error.code,
      unavailableItems?.length
        ? buildUnavailableItemsDetails(unavailableItems)
        : undefined,
    );
  }

  if (error instanceof InventoryStockUnavailableError) {
    return new ApiError(
      409,
      error.message,
      true,
      error.code,
      error.unavailableItems?.length
        ? buildUnavailableItemsDetails(error.unavailableItems)
        : undefined,
    );
  }

  return null;
};
