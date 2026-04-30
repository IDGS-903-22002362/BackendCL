import { PaymentAttempt } from "./payment-domain.types";
import {
  NormalizedProviderWebhookEvent,
  ProviderCreatePaymentResult,
  ProviderRefundResult,
  ProviderStatusResult,
} from "./payment-domain.types";
import { PaymentStatus } from "./payment-status.enum";
import { ProveedorPago } from "../../models/pago.model";

export interface CreateOnlineProviderInput {
  paymentAttemptId: string;
  idempotencyKey: string;
  amountMinor: number;
  currency: string;
  providerReference?: string;
  customerName?: string;
  customerEmail?: string;
  customerPhone?: string;
  successUrl?: string;
  cancelUrl?: string;
  failureUrl?: string;
  cartUrl?: string;
  webhookUrl?: string;
  metadata?: Record<string, unknown>;
  pricingSnapshot: PaymentAttempt["pricingSnapshot"];
}

export interface ProviderWebhookInput {
  rawBody: Buffer;
  headers: Record<string, string | string[] | undefined>;
  requestId?: string;
}

export interface ProviderCancelOrVoidInput {
  paymentAttempt: PaymentAttempt;
  reason?: string;
}

export interface ProviderRefundInput {
  paymentAttempt: PaymentAttempt;
  refundAmountMinor?: number;
  reason?: string;
}

export interface ProviderRefundStatusInput {
  paymentAttempt: PaymentAttempt;
  refundId?: string;
}

export interface PaymentProvider {
  readonly provider: ProveedorPago;

  createOnline(input: CreateOnlineProviderInput): Promise<ProviderCreatePaymentResult>;
  getStatus(paymentAttempt: PaymentAttempt): Promise<ProviderStatusResult>;
  parseWebhook(
    input: ProviderWebhookInput,
  ): Promise<NormalizedProviderWebhookEvent>;
  cancelOrVoid(
    input: ProviderCancelOrVoidInput,
  ): Promise<ProviderStatusResult>;
  refund(input: ProviderRefundInput): Promise<ProviderRefundResult>;
  getRefundStatus?(
    input: ProviderRefundStatusInput,
  ): Promise<ProviderRefundResult>;
  mapProviderStatus(providerStatus: string): PaymentStatus;
}
