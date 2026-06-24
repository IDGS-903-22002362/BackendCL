import { Timestamp } from "firebase-admin/firestore";
import { CrearOrdenDTO } from "./orden.model";
import { CheckoutPricingSnapshot } from "./checkout-pricing.model";

export enum CheckoutAttemptStatus {
  CREATED = "created",
  PAYMENT_PENDING = "payment_pending",
  PROCESSING = "processing",
  PAID = "paid",
  FAILED = "failed",
  CANCELED = "canceled",
  EXPIRED = "expired",
  FINALIZED = "finalized",
}

export const TERMINAL_CHECKOUT_ATTEMPT_STATUSES = new Set<CheckoutAttemptStatus>([
  CheckoutAttemptStatus.FAILED,
  CheckoutAttemptStatus.CANCELED,
  CheckoutAttemptStatus.EXPIRED,
  CheckoutAttemptStatus.FINALIZED,
]);

export interface CheckoutAttempt {
  id?: string;
  userId: string;
  cartId: string;
  status: CheckoutAttemptStatus;
  orderDraft: CrearOrdenDTO;
  pricingSnapshot: CheckoutPricingSnapshot;
  total: number;
  currency: string;
  metodoPago: string;
  fulfillmentMethod?: string;
  idempotencyKey: string;
  pagoId?: string;
  orderId?: string;
  stripeCheckoutSessionId?: string;
  stripePaymentIntentId?: string;
  expiresAt: Timestamp;
  finalizedAt?: Timestamp;
  failureCode?: string;
  failureMessage?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface StartCheckoutAttemptResult {
  attemptId: string;
  status: CheckoutAttemptStatus;
  clientSecret?: string;
  sessionId?: string;
  pagoId?: string;
  total: number;
  currency: string;
  created: boolean;
}
