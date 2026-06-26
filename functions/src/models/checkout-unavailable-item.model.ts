export type CheckoutUnavailableItemReason =
  | "out_of_stock"
  | "reserved_by_other"
  | "inactive";

export type CheckoutUnavailableItemDetail = {
  productId: string;
  productName: string;
  tallaId?: string;
  available: number;
  requested: number;
  reason: CheckoutUnavailableItemReason;
};

export type PublicErrorDetails = {
  unavailableItems?: CheckoutUnavailableItemDetail[];
};

export type CartItemStockStatus =
  | "available"
  | "out_of_stock"
  | "temporarily_unavailable";
