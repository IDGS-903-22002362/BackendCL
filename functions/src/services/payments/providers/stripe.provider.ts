import pagoService from "../../pago.service";
import { ProveedorPago, RefundState } from "../../../models/pago.model";
import { PaymentProvider } from "../payment-provider.interface";
import {
  CreateOnlineProviderInput,
  ProviderCancelOrVoidInput,
  ProviderRefundInput,
  ProviderWebhookInput,
} from "../payment-provider.interface";
import {
  NormalizedProviderWebhookEvent,
  ProviderCreatePaymentResult,
  ProviderRefundResult,
  ProviderStatusResult,
} from "../payment-domain.types";
import { PaymentStatus } from "../payment-status.enum";
import { PaymentApiError } from "../payment-api-error";

const mapStripeStatus = (providerStatus?: string): PaymentStatus => {
  switch ((providerStatus || "").toLowerCase()) {
    case "succeeded":
    case "paid":
      return PaymentStatus.PAID;
    case "requires_action":
      return PaymentStatus.AUTHORIZED;
    case "processing":
      return PaymentStatus.PENDING_PROVIDER;
    case "canceled":
      return PaymentStatus.CANCELED;
    case "refunded":
      return PaymentStatus.REFUNDED;
    default:
      return PaymentStatus.PENDING_CUSTOMER;
  }
};

export class StripeProvider implements PaymentProvider {
  readonly provider = ProveedorPago.STRIPE;

  async createOnline(
    _input: CreateOnlineProviderInput,
  ): Promise<ProviderCreatePaymentResult> {
    throw new PaymentApiError(
      409,
      "PAYMENT_PROVIDER_UNSUPPORTED",
      "Stripe legacy sigue operando mediante pago.service en esta versión",
    );
  }

  async createInStore(_input: unknown): Promise<ProviderCreatePaymentResult> {
    throw new PaymentApiError(
      409,
      "PAYMENT_PROVIDER_UNSUPPORTED",
      "Stripe legacy no implementa flujo in-store en esta versión",
    );
  }

  async getStatus(paymentAttempt: {
    providerStatus?: string;
    providerPaymentId?: string;
    providerReference?: string;
    status?: PaymentStatus;
    paymentIntentId?: string;
    checkoutSessionId?: string;
    rawCreateResponseSanitized?: Record<string, unknown>;
  }): Promise<ProviderStatusResult> {
    const providerStatus = paymentAttempt.providerStatus;
    const providerPaymentId =
      paymentAttempt.providerPaymentId ||
      paymentAttempt.paymentIntentId ||
      paymentAttempt.checkoutSessionId;

    return {
      status: paymentAttempt.status || mapStripeStatus(providerStatus),
      providerStatus,
      providerPaymentId,
      providerReference: paymentAttempt.providerReference,
      rawResponseSanitized: paymentAttempt.rawCreateResponseSanitized,
    };
  }

  async parseWebhook(
    input: ProviderWebhookInput,
  ): Promise<NormalizedProviderWebhookEvent> {
    const signature = input.headers["stripe-signature"];
    if (typeof signature !== "string") {
      throw new PaymentApiError(
        400,
        "PAYMENT_WEBHOOK_INVALID_SIGNATURE",
        "El header Stripe-Signature es obligatorio",
      );
    }

    const result = await pagoService.procesarWebhookStripe(input.rawBody, signature);
    return {
      provider: ProveedorPago.STRIPE,
      eventType: result.eventType,
      eventId: result.eventId,
      dedupeKey: result.eventId,
      status: result.outcome === "processed" ? PaymentStatus.PAID : undefined,
      payloadSanitized: {
        outcome: result.outcome,
        pagoId: result.pagoId,
        ordenId: result.ordenId,
      },
    };
  }

  async cancelOrVoid(
    _input: ProviderCancelOrVoidInput,
  ): Promise<ProviderStatusResult> {
    throw new PaymentApiError(
      409,
      "PAYMENT_PROVIDER_UNSUPPORTED",
      "Stripe legacy no expone cancel/void genérico en esta capa",
    );
  }

  async refund(input: ProviderRefundInput): Promise<ProviderRefundResult> {
    if (!input.paymentAttempt.ordenId) {
      throw new PaymentApiError(
        409,
        "PAYMENT_VALIDATION_ERROR",
        "El pago Stripe requiere ordenId para reembolso legacy",
      );
    }

    const result = await pagoService.procesarReembolsoPorOrden({
      orderId: input.paymentAttempt.ordenId,
      reason: input.reason,
      requestedByUid:
        typeof input.paymentAttempt.metadata?.requestedByUid === "string"
          ? String(input.paymentAttempt.metadata.requestedByUid)
          : "system",
    });

    return {
      refundState: RefundState.SUCCEEDED,
      status: result.estadoPago === "REEMBOLSADO"
        ? PaymentStatus.REFUNDED
        : PaymentStatus.PARTIALLY_REFUNDED,
      rawResponseSanitized: {
        refundId: result.refundId,
        refundAmount: result.refundAmount,
      },
    };
  }

  mapProviderStatus(providerStatus: string): PaymentStatus {
    return mapStripeStatus(providerStatus);
  }
}

export const stripeProvider = new StripeProvider();
export default stripeProvider;
