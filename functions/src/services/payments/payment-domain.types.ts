import { Timestamp } from "firebase-admin/firestore";
import {
  Pago,
  PaymentFlowType,
  PaymentMethodCode,
  PaymentPricingSnapshot,
  PaymentStatus,
  ProveedorPago,
  RefundState,
} from "../../models/pago.model";

export interface PaymentAttempt extends Pago {
  status?: PaymentStatus;
  flowType?: PaymentFlowType;
  paymentMethodCode?: PaymentMethodCode;
  refundState?: RefundState;
}

export interface PaymentEventLogRecord {
  id?: string;
  provider: ProveedorPago;
  paymentAttemptId?: string;
  providerPaymentId?: string;
  providerLoanId?: string;
  providerReference?: string;
  channel?: string;
  merchantId?: string;
  eventType: string;
  eventId?: string;
  dedupeKey: string;
  payloadSanitized: Record<string, unknown>;
  rawBodySanitized?: Record<string, unknown>;
  amountMinor?: number;
  currency?: string;
  mappedStatus?: PaymentStatus;
  processed: boolean;
  status:
    | "received"
    | "processing"
    | "processed"
    | "duplicate"
    | "pending_match"
    | "orphaned"
    | "failed";
  errorMessage?: string;
  retryCount?: number;
  requestId?: string;
  processedAt?: Timestamp;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface CreatePaymentAttemptInput {
  provider: ProveedorPago;
  flowType: PaymentFlowType;
  paymentMethodCode: PaymentMethodCode;
  metodoPago: Pago["metodoPago"];
  ordenId?: string;
  ventaPosId?: string;
  userId: string;
  customerId?: string;
  customerName?: string;
  customerEmail?: string;
  customerPhone?: string;
  currency: string;
  amount: number;
  amountMinor: number;
  idempotencyKey: string;
  successUrl?: string;
  cancelUrl?: string;
  failureUrl?: string;
  webhookUrl?: string;
  expiresAt?: Timestamp;
  pricingSnapshot: PaymentPricingSnapshot;
  metadata?: Record<string, unknown>;
  posSessionId?: string;
  deviceId?: string;
  redirectUrl?: string;
  providerStatus?: string;
  providerLoanId?: string;
  providerReference?: string;
  status?: PaymentStatus;
  estado?: Pago["estado"];
  rawCreateRequestSanitized?: Record<string, unknown>;
  rawCreateResponseSanitized?: Record<string, unknown>;
}

export interface ProviderCreatePaymentResult {
  status: PaymentStatus;
  providerStatus?: string;
  providerPaymentId?: string;
  providerLoanId?: string;
  providerReference?: string;
  redirectUrl?: string;
  paymentLink?: string;
  qrString?: string;
  qrImageUrl?: string;
  expiresAt?: Date;
  rawRequestSanitized?: Record<string, unknown>;
  rawResponseSanitized?: Record<string, unknown>;
}

export interface ProviderStatusResult {
  status: PaymentStatus;
  providerStatus?: string;
  providerPaymentId?: string;
  providerLoanId?: string;
  providerReference?: string;
  amountMinor?: number;
  currency?: string;
  paidAt?: Date;
  expiresAt?: Date;
  rawResponseSanitized?: Record<string, unknown>;
}

export interface ProviderRefundResult {
  refundState: RefundState;
  status?: PaymentStatus;
  providerStatus?: string;
  refundId?: string;
  refundAmountMinor?: number;
  refundEntries?: ProviderRefundStatusEntry[];
  rawResponseSanitized?: Record<string, unknown>;
}

export interface ProviderRefundStatusEntry {
  refundId?: string;
  providerStatus?: string;
  refundState: RefundState;
  refundDate?: string;
  amountMinor?: number;
}

export interface NormalizedProviderWebhookEvent {
  provider: ProveedorPago;
  eventType: string;
  eventId?: string;
  dedupeKey: string;
  providerPaymentId?: string;
  providerLoanId?: string;
  providerReference?: string;
  channel?: string;
  merchantId?: string;
  status?: PaymentStatus;
  providerStatus?: string;
  amountMinor?: number;
  currency?: string;
  paidAt?: Date;
  expiresAt?: Date;
  payloadSanitized: Record<string, unknown>;
}
