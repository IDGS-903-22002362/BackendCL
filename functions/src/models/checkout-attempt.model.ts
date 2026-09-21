import { Timestamp } from "firebase-admin/firestore";
import { CrearOrdenDTO } from "./orden.model";
import {
  CheckoutPricingSnapshot,
  PaymentComposition,
} from "./checkout-pricing.model";

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
  paymentComposition: PaymentComposition;
  /** Total bruto antes de aplicar FieraPuntos. */
  grossTotal: number;
  /** `total` conserva el monto que se cobra al proveedor. */
  total: number;
  currency: string;
  metodoPago: string;
  fulfillmentMethod?: string;
  idempotencyKey: string;
  /**
   * Firma comparable del carrito + pricing al momento de crear el intento.
   * Permite detectar cambios (items, cantidades, tallas, ofertas, código,
   * envío o total) y evitar reutilizar una sesión de Stripe obsoleta.
   * Campo opcional para mantener compatibilidad con documentos existentes.
   */
  cartSignature?: string;
  pagoId?: string;
  orderId?: string;
  stripeCheckoutSessionId?: string;
  stripePaymentIntentId?: string;
  expiresAt: Timestamp;
  finalizedAt?: Timestamp;
  failureCode?: string;
  failureMessage?: string;
  fieraPointsConfirmStatus?: "COMPLETED" | "FAILED";
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface StartCheckoutAttemptResult {
  attemptId: string;
  status: CheckoutAttemptStatus;
  url?: string;
  clientSecret?: string;
  sessionId?: string;
  pagoId?: string;
  total: number;
  grossTotal: number;
  currency: string;
  created: boolean;
  paymentComposition: PaymentComposition;
}
