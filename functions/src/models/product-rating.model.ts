import { Timestamp } from "firebase-admin/firestore";

export interface ProductRating {
  id?: string;
  productId: string;
  userId: string;
  score: number;
  eligibleOrderId: string;
  eligibleDeliveredAt: Timestamp;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export type ProductRatingEligibilityReason =
  | "eligible"
  | "purchase_required"
  | "not_delivered";

export interface ProductRatingEligibility {
  canRate: boolean;
  reason: ProductRatingEligibilityReason;
}

export interface ProductUserRatingSnapshot {
  score: number;
  updatedAt: Timestamp;
}
