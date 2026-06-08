import { createHash } from "crypto";
import { Timestamp } from "firebase-admin/firestore";
import { firestoreTienda } from "../../config/firebase";
import { getAplazoConfig } from "../../config/aplazo.config";
import { EstadoOrden, MetodoPago, Orden } from "../../models/orden.model";
import {
  PaymentFlowType,
  PaymentMethodCode,
  PaymentPricingSnapshot,
  RefundState,
  PaymentStatus,
  ProveedorPago,
} from "../../models/pago.model";
import { RolUsuario } from "../../models/usuario.model";
import logger from "../../utils/logger";
import productService from "../product.service";
import {
  createPaymentValidationError,
  PaymentApiError,
} from "./payment-api-error";
import paymentAttemptRepository, {
  mapLegacyEstadoToPaymentStatus,
} from "./payment-attempt.repository";
import paymentEventLogRepository from "./payment-event-log.repository";
import paymentFinalizerService from "./payment-finalizer.service";
import paymentReconciliationService from "./payment-reconciliation.service";
import paymentRefundRepository, {
  PaymentRefundRepository,
} from "./payment-refund.repository";
import paymentRefundRequestRepository, {
  PaymentRefundRequestRecord,
  PaymentRefundRequestRepository,
  PaymentRefundRequestStatus,
} from "./payment-refund-request.repository";
import aplazoProvider from "./providers/aplazo.provider";
import {
  isValidEmail,
  normalizeEmail,
  normalizeMxPhoneForAplazo,
  normalizeWhitespace,
  sanitizeForStorage,
} from "./payment-sanitizer";
import { PaymentAttempt } from "./payment-domain.types";
import { ProviderRefundStatusEntry } from "./payment-domain.types";
import {
  shippingRefundGuardService,
  ShippingRefundGuardError,
} from "../shipping-refund-guard.service";

const ORDENES_COLLECTION = "ordenes";
const SHIPPING_EVENTS_COLLECTION = "shipping_events";
const USERS_APP_COLLECTION = "usuariosApp";
const POLL_NEXT_PENDING_SHORT_MS = 3_000;
const POLL_NEXT_PENDING_LONG_MS = 10_000;
const ONLINE_FALLBACK_EXPIRATION_MINUTES = 30;
const STATUS_SYNC_THROTTLE_MS = 30_000;
const IDEMPOTENCY_KEY_MIN_LENGTH = 8;
const IDEMPOTENCY_KEY_MAX_LENGTH = 255;

type AuthActor = {
  uid: string;
  rol?: string;
  email?: string;
  nombre?: string;
  telefono?: string;
};

type PaymentCustomerInput = {
  name?: string;
  email?: string;
  phone?: string;
};

type PaymentItemInput = {
  productoId: string;
  cantidad: number;
  tallaId?: string;
};

type OnlineCreateRequest = {
  orderId: string;
  customer?: PaymentCustomerInput;
  items?: PaymentItemInput[];
  subtotal?: number;
  tax?: number;
  shipping?: number;
  total?: number;
  currency?: string;
  successUrl?: string;
  cancelUrl?: string;
  failureUrl?: string;
  cartUrl?: string;
  metadata?: Record<string, unknown>;
};

type BrowserReturnLookup = {
  paymentAttemptId?: string;
  providerPaymentId?: string;
  providerReference?: string;
};

type AplazoRefundStatusSyncResult = {
  paymentAttempt: PaymentAttempt;
  refunds: ProviderRefundStatusEntry[];
  selectedRefund?: ProviderRefundStatusEntry;
  totalRefundedAmount: number;
};

const paymentsLogger = logger.child({
  component: "payments-service",
});

const isPrivileged = (rol?: string): boolean => {
  return rol === RolUsuario.ADMIN || rol === RolUsuario.EMPLEADO;
};

const roundToMinor = (amount: number | undefined): number => {
  if (typeof amount !== "number" || !Number.isFinite(amount)) {
    return 0;
  }

  return Math.round(amount * 100);
};

const validateIdempotencyKey = (idempotencyKey?: string): string | undefined => {
  if (!idempotencyKey) {
    return undefined;
  }

  const normalized = idempotencyKey.trim();
  if (
    normalized.length < IDEMPOTENCY_KEY_MIN_LENGTH ||
    normalized.length > IDEMPOTENCY_KEY_MAX_LENGTH
  ) {
    throw new PaymentApiError(
      400,
      "PAYMENT_VALIDATION_ERROR",
      `Idempotency-Key debe tener entre ${IDEMPOTENCY_KEY_MIN_LENGTH} y ${IDEMPOTENCY_KEY_MAX_LENGTH} caracteres`,
    );
  }

  return normalized;
};

const getMetadataString = (
  metadata: Record<string, unknown> | undefined,
  key: string,
): string | undefined => {
  const value = metadata?.[key];
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
};

const normalizeCurrency = (currency?: string): string | undefined => {
  const normalized = currency?.trim();
  return normalized ? normalized.toUpperCase() : undefined;
};

const ensureRequiredUrl = (
  value: string | undefined,
  fieldName: string,
): string => {
  const normalized = value?.trim();
  if (!normalized) {
    throw createPaymentValidationError(
      "Aplazo online requiere successUrl y failureUrl/cancelUrl",
      {
        missingField: fieldName,
      },
    );
  }

  return normalized;
};

const normalizeBaseUrl = (value: string): string => {
  return value.trim().replace(/\/+$/, "");
};

const getBackendBaseUrl = (): string => {
  const explicit =
    process.env.BACKEND_PUBLIC_URL?.trim() ||
    process.env.PAYMENTS_BACKEND_BASE_URL?.trim();
  if (explicit) {
    return normalizeBaseUrl(explicit);
  }

  const projectId =
    process.env.GCLOUD_PROJECT ||
    process.env.GCP_PROJECT ||
    process.env.GCP_PROJECT_ID ||
    process.env.FIREBASE_PROJECT_ID;
  const region =
    process.env.FUNCTION_REGION ||
    process.env.GCLOUD_REGION ||
    process.env.GCP_REGION ||
    "us-central1";
  const serviceName = process.env.K_SERVICE || process.env.FUNCTION_NAME || "api";

  if (projectId && serviceName) {
    return `https://${region}-${projectId}.cloudfunctions.net/${serviceName}`;
  }

  throw new PaymentApiError(
    500,
    "PAYMENT_INTERNAL_ERROR",
    "No fue posible resolver la URL pública del backend para webhooks Aplazo",
  );
};

const getBackendWebhookUrl = (): string => {
  return `${getBackendBaseUrl()}/api/webhooks/aplazo`;
};

const toPaymentStatus = (attempt: PaymentAttempt): PaymentStatus => {
  return attempt.status ?? mapLegacyEstadoToPaymentStatus(attempt.estado);
};

export class PaymentsService {
  constructor(
    private readonly paymentAttemptRepo = paymentAttemptRepository,
    private readonly paymentEventLogRepo = paymentEventLogRepository,
    private readonly finalizer = paymentFinalizerService,
    private readonly reconciliationService = paymentReconciliationService,
    private readonly refundRepo: PaymentRefundRepository = paymentRefundRepository,
    private readonly refundRequestRepo: PaymentRefundRequestRepository =
      paymentRefundRequestRepository,
  ) {}

  async createAplazoOnline(
    actor: AuthActor,
    request: OnlineCreateRequest,
    headerIdempotencyKey?: string,
  ): Promise<{ created: boolean; paymentAttempt: PaymentAttempt }> {
    const user = await this.requireAuthenticatedActor(actor);
    const order = await this.requirePayableOrder(request.orderId, user);
    const config = getAplazoConfig();
    const customer = await this.resolveOnlineCustomer(user, request.customer);
    const pricingSnapshot = await this.buildOrderPricingSnapshot(order);
    const amountMinor = pricingSnapshot.totalMinor;
    const requestCurrency = normalizeCurrency(request.currency);

    if (requestCurrency && requestCurrency !== "MXN") {
      throw new PaymentApiError(
        400,
        "PAYMENT_VALIDATION_ERROR",
        "Aplazo online solo soporta MXN",
        {
          requestCurrency,
          expectedCurrency: "MXN",
        },
      );
    }

    if (
      typeof request.total === "number" &&
      roundToMinor(request.total) !== amountMinor
    ) {
      throw new PaymentApiError(
        409,
        "PAYMENT_AMOUNT_MISMATCH",
        "El total enviado por frontend no coincide con el total recalculado en backend",
      );
    }

    const idempotencyKey =
      validateIdempotencyKey(headerIdempotencyKey) ??
      this.generateDeterministicIdempotencyKey(
        "online",
        request.orderId,
        user.uid,
        amountMinor,
        pricingSnapshot,
      );

    const existing = await this.paymentAttemptRepo.findByIdempotencyKey(
      ProveedorPago.APLAZO,
      idempotencyKey,
    );
    if (existing) {
      await this.assertActorCanAccessAttempt(existing, user);
      return { created: false, paymentAttempt: existing };
    }

    const existingForOrder = await this.paymentAttemptRepo.findLatestByOrderAndFlow(
      ProveedorPago.APLAZO,
      order.id,
      PaymentFlowType.ONLINE,
    );
    if (
      existingForOrder &&
      !this.isTerminalStatus(toPaymentStatus(existingForOrder))
    ) {
      await this.assertActorCanAccessAttempt(existingForOrder, user);
      return { created: false, paymentAttempt: existingForOrder };
    }

    const metadataCartId =
      getMetadataString(request.metadata, "cartId") || order.id;
    const successUrl = ensureRequiredUrl(
      request.successUrl || config.online.successUrl,
      "successUrl",
    );
    const cancelUrl = request.cancelUrl || config.online.cancelUrl;
    const failureUrl = request.failureUrl || config.online.failureUrl;
    const normalizedFailureUrl = ensureRequiredUrl(
      failureUrl || cancelUrl,
      failureUrl ? "failureUrl" : "cancelUrl",
    );
    const webhookUrl = getBackendWebhookUrl();
    this.validateOnlineAplazoPayload({
      customer,
      amountMinor,
      currency: pricingSnapshot.currency,
      providerReference: metadataCartId,
      pricingSnapshot,
      successUrl,
      failureUrl: normalizedFailureUrl,
    });
    const expiresAt = Timestamp.fromDate(
      new Date(Date.now() + ONLINE_FALLBACK_EXPIRATION_MINUTES * 60 * 1000),
    );

    const attempt = await this.paymentAttemptRepo.create({
      provider: ProveedorPago.APLAZO,
      flowType: PaymentFlowType.ONLINE,
      paymentMethodCode: PaymentMethodCode.APLAZO,
      metodoPago: MetodoPago.APLAZO,
      ordenId: order.id,
      userId: user.uid,
      customerId: user.uid,
      customerName: customer.name,
      customerEmail: customer.email,
      customerPhone: customer.phone,
      currency: pricingSnapshot.currency,
      amount: pricingSnapshot.totalMinor / 100,
      amountMinor,
      idempotencyKey,
      successUrl,
      cancelUrl,
      failureUrl: normalizedFailureUrl,
      webhookUrl,
      providerReference: metadataCartId,
      expiresAt,
      pricingSnapshot,
      metadata: {
        ...(request.metadata || {}),
        cartId: metadataCartId,
        cartUrl: request.cartUrl || config.online.cartUrl,
        orderId: order.id,
        fulfillmentMethod: order.fulfillmentMethod || "DELIVERY",
        pickupLocationId: order.pickupLocationId || "",
        requestCurrency: requestCurrency || "MXN",
        shippingProvider:
          typeof order.shipping?.provider === "string" ? order.shipping.provider : "",
        shippingServiceType:
          typeof order.shipping?.serviceType === "string"
            ? order.shipping.serviceType
            : "",
        carrierCode:
          typeof order.shipping?.carrierCode === "string"
            ? order.shipping.carrierCode
            : "",
        shippingTotal: String(order.costoEnvio || 0),
        discountTotal: String(order.discountTotal || 0),
      },
      status: PaymentStatus.CREATED,
      rawCreateRequestSanitized: sanitizeForStorage({
        orderId: request.orderId,
        cartId: metadataCartId,
        customer,
        metadata: request.metadata || {},
      }),
    });

    await this.paymentAttemptRepo.update(attempt.id!, {
      status: PaymentStatus.PENDING_PROVIDER,
    });

    try {
      const providerResult = await aplazoProvider.createOnline({
        paymentAttemptId: attempt.id!,
        idempotencyKey,
        amountMinor,
        currency: pricingSnapshot.currency,
        providerReference: metadataCartId,
        customerName: customer.name,
        customerEmail: customer.email,
        customerPhone: customer.phone,
        successUrl,
        cancelUrl,
        failureUrl: normalizedFailureUrl,
        cartUrl: request.cartUrl || config.online.cartUrl,
        webhookUrl,
        metadata: {
          orderId: order.id,
          userId: user.uid,
          cartId: metadataCartId,
          fulfillmentMethod: order.fulfillmentMethod || "DELIVERY",
          pickupLocationId: order.pickupLocationId || "",
          requestCurrency: requestCurrency || "MXN",
          ...(request.metadata || {}),
        },
        pricingSnapshot,
      });

      const updated = await this.paymentAttemptRepo.update(attempt.id!, {
        status: providerResult.status,
        providerStatus: providerResult.providerStatus,
        providerPaymentId: providerResult.providerPaymentId,
        providerLoanId: providerResult.providerLoanId,
        providerReference: providerResult.providerReference,
        redirectUrl: providerResult.redirectUrl,
        expiresAt: providerResult.expiresAt
          ? Timestamp.fromDate(providerResult.expiresAt)
          : attempt.expiresAt,
        rawCreateRequestSanitized: providerResult.rawRequestSanitized,
        rawCreateResponseSanitized: providerResult.rawResponseSanitized,
        metadata: {
          ...(attempt.metadata || {}),
          cartId: providerResult.providerReference || metadataCartId,
          providerRequestLoggedAt: Timestamp.now(),
        },
      });

      return {
        created: true,
        paymentAttempt: updated,
      };
    } catch (error) {
      if (
        error instanceof PaymentApiError &&
        error.code === "PAYMENT_PROVIDER_TIMEOUT"
      ) {
        const timeoutAttempt = await this.paymentAttemptRepo.update(attempt.id!, {
          status: PaymentStatus.PENDING_PROVIDER,
          providerStatus: "timeout",
        metadata: {
          ...(attempt.metadata || {}),
          lastCreateTimeoutAt: Timestamp.now(),
          providerLastError: "Timeout al comunicarse con Aplazo",
        },
      });
        return {
          created: true,
          paymentAttempt: timeoutAttempt,
        };
      }

      await this.paymentAttemptRepo.update(attempt.id!, {
        status: PaymentStatus.FAILED,
        providerStatus: "create_failed",
        failedAt: Timestamp.now(),
        metadata: {
          ...(attempt.metadata || {}),
          lastCreateError:
            error instanceof Error ? error.message : "Error desconocido",
          providerLastError:
            error instanceof Error ? error.message : "Error desconocido",
          providerLastErrorDetails:
            error instanceof PaymentApiError
              ? sanitizeForStorage(error.details || {})
              : {},
        },
      });
      throw error;
    }
  }

  async handleAplazoWebhook(input: {
    rawBody: Buffer;
    headers: Record<string, string | string[] | undefined>;
    requestId?: string;
  }): Promise<{
    duplicate: boolean;
    eventLogId: string;
    paymentAttemptId?: string;
    status: "accepted" | "duplicate";
  }> {
    const normalizedEvent = await aplazoProvider.parseWebhook(input);
    const matchedAttempt =
      await this.paymentAttemptRepo.findByProviderIdentifiers({
        provider: normalizedEvent.provider,
        providerPaymentId: normalizedEvent.providerPaymentId,
        providerLoanId: normalizedEvent.providerLoanId,
        providerReference: normalizedEvent.providerReference,
      });

    const parsedRawBody = this.tryParseRawJson(input.rawBody);
      const reservation = await this.paymentEventLogRepo.reserve({
        provider: normalizedEvent.provider,
        paymentAttemptId: matchedAttempt?.id,
        providerPaymentId: normalizedEvent.providerPaymentId,
        providerLoanId: normalizedEvent.providerLoanId,
        providerReference: normalizedEvent.providerReference,
        merchantId: normalizedEvent.merchantId,
        channel: normalizedEvent.channel,
        eventType: normalizedEvent.eventType,
        eventId: normalizedEvent.eventId,
        dedupeKey: normalizedEvent.dedupeKey,
      payloadSanitized: normalizedEvent.payloadSanitized,
      rawBodySanitized: sanitizeForStorage(parsedRawBody || {}),
      amountMinor: normalizedEvent.amountMinor,
      currency: normalizedEvent.currency,
      mappedStatus: normalizedEvent.status,
      requestId: input.requestId,
      status: matchedAttempt ? "received" : "pending_match",
    });

    paymentsLogger.info("aplazo_webhook_received", {
      eventLogId: reservation.record.id,
      paymentAttemptId: matchedAttempt?.id,
      duplicate: !reservation.created,
      requestId: input.requestId,
    });

    return {
      duplicate: !reservation.created,
      eventLogId: reservation.record.id!,
      paymentAttemptId: matchedAttempt?.id,
      status: reservation.created ? "accepted" : "duplicate",
    };
  }

  async getPaymentStatusForActor(
    paymentAttemptId: string,
    actor: AuthActor,
    options?: { syncWithProvider?: boolean },
  ): Promise<{
    paymentAttempt: PaymentAttempt;
    isTerminal: boolean;
    nextPollAfterMs: number;
  }> {
    const user = await this.requireAuthenticatedActor(actor);
    const attempt = await this.requirePaymentAttempt(paymentAttemptId);
    await this.assertActorCanAccessAttempt(attempt, user);

    let effectiveAttempt = attempt;
    const currentStatus = toPaymentStatus(effectiveAttempt);

    if (
      options?.syncWithProvider &&
      effectiveAttempt.provider === ProveedorPago.APLAZO &&
      !this.isTerminalStatus(currentStatus) &&
      this.shouldSyncStatus(effectiveAttempt)
    ) {
      this.assertAplazoOnlineAttempt(effectiveAttempt);
      effectiveAttempt = await this.reconciliationService.reconcilePaymentAttempt(
        paymentAttemptId,
        user.uid,
      );
    }

    const finalStatus = toPaymentStatus(effectiveAttempt);
    return {
      paymentAttempt: effectiveAttempt,
      isTerminal: this.isTerminalStatus(finalStatus),
      nextPollAfterMs: this.isTerminalStatus(finalStatus)
        ? 0
        : finalStatus === PaymentStatus.PENDING_PROVIDER
          ? POLL_NEXT_PENDING_LONG_MS
          : POLL_NEXT_PENDING_SHORT_MS,
    };
  }

  async reconcileAplazoPaymentAttempt(
    paymentAttemptId: string,
    actor: AuthActor,
  ): Promise<PaymentAttempt> {
    const user = await this.requireAuthenticatedActor(actor);
    this.assertPrivilegedPosActor(user);
    const attempt = await this.requirePaymentAttempt(paymentAttemptId);
    if (attempt.provider !== ProveedorPago.APLAZO) {
      throw new PaymentApiError(
        409,
        "PAYMENT_VALIDATION_ERROR",
        "El endpoint de reconciliación manual solo soporta Aplazo",
      );
    }
    this.assertAplazoOnlineAttempt(attempt);
    return this.reconciliationService.reconcilePaymentAttempt(
      paymentAttemptId,
      user.uid,
    );
  }

  async cancelAplazoPaymentAttempt(
    paymentAttemptId: string,
    actor: AuthActor,
    reason?: string,
  ): Promise<PaymentAttempt> {
    const user = await this.requireAuthenticatedActor(actor);
    if (user.rol !== RolUsuario.ADMIN) {
      throw new PaymentApiError(
        403,
        "PAYMENT_FORBIDDEN",
        "Solo ADMIN puede cancelar intentos Aplazo manualmente",
      );
    }

    const attempt = await this.requirePaymentAttempt(paymentAttemptId);
    if (attempt.provider !== ProveedorPago.APLAZO) {
      throw new PaymentApiError(
        409,
        "PAYMENT_VALIDATION_ERROR",
        "El endpoint de cancelación manual solo soporta Aplazo",
      );
    }

    this.assertAplazoOnlineAttempt(attempt);

    if (toPaymentStatus(attempt) === PaymentStatus.CANCELED) {
      return attempt;
    }

    const reconciledAttempt = await this.reconciliationService.reconcilePaymentAttempt(
      paymentAttemptId,
      user.uid,
    );
    const currentStatus = toPaymentStatus(reconciledAttempt);

    if (currentStatus === PaymentStatus.CANCELED) {
      return reconciledAttempt;
    }

    if (currentStatus === PaymentStatus.PAID) {
      throw new PaymentApiError(
        409,
        "PAYMENT_CANCEL_NOT_ALLOWED",
        "El pago Aplazo ya está ACTIVO/pagado; usa el flujo de refund para devolverlo",
      );
    }

    if (currentStatus !== PaymentStatus.PENDING_CUSTOMER) {
      throw new PaymentApiError(
        409,
        "PAYMENT_CANCEL_NOT_ALLOWED",
        "La cancelación Aplazo solo aplica a pagos NO CONFIRMADOS",
        {
          currentStatus,
          providerStatus: reconciledAttempt.providerStatus,
        },
      );
    }

    const providerStatus = await aplazoProvider.cancelOrVoid({
      paymentAttempt: reconciledAttempt,
      reason,
    });

    if (
      providerStatus.status === PaymentStatus.CANCELED ||
      providerStatus.status === PaymentStatus.REFUNDED
    ) {
      return this.finalizer.finalizeTerminalStatus(
        reconciledAttempt,
        PaymentStatus.CANCELED,
        {
          source: "cancel",
          requestedBy: user.uid,
          cancelReason: reason || "manual_admin_cancel",
          providerResult: providerStatus,
        },
      );
    }

    if (providerStatus.status === PaymentStatus.PAID) {
      await this.finalizer.finalizeTerminalStatus(
        reconciledAttempt,
        PaymentStatus.PAID,
        {
          source: "reconcile",
          requestedBy: user.uid,
          providerResult: providerStatus,
        },
      );
      throw new PaymentApiError(
        409,
        "PAYMENT_CANCEL_NOT_ALLOWED",
        "El pago Aplazo ya está ACTIVO/pagado; usa el flujo de refund para devolverlo",
      );
    }

    return this.paymentAttemptRepo.update(reconciledAttempt.id!, {
      status: providerStatus.status,
      providerStatus:
        providerStatus.providerStatus ?? reconciledAttempt.providerStatus,
      metadata: {
        ...(reconciledAttempt.metadata || {}),
        lastCancelAttemptAt: Timestamp.now(),
        ...(reason ? { lastCancelReason: reason } : {}),
        ...(providerStatus.rawResponseSanitized
          ? { lastCancelProviderResponse: providerStatus.rawResponseSanitized }
          : {}),
      },
    });
  }

  async refundAplazoPaymentAttempt(
    paymentAttemptId: string,
    actor: AuthActor,
    input: { refundAmountMinor?: number; reason?: string },
  ): Promise<PaymentAttempt> {
    const user = await this.requireAuthenticatedActor(actor);
    if (user.rol !== RolUsuario.ADMIN) {
      throw new PaymentApiError(
        403,
        "PAYMENT_FORBIDDEN",
        "Solo ADMIN puede solicitar refunds Aplazo",
      );
    }

    const attempt = await this.requirePaymentAttempt(paymentAttemptId);
    if (attempt.provider !== ProveedorPago.APLAZO) {
      throw new PaymentApiError(
        409,
        "PAYMENT_VALIDATION_ERROR",
        "El endpoint de refund manual solo soporta Aplazo",
      );
    }

    this.assertAplazoOnlineAttempt(attempt);

    const config = getAplazoConfig();
    if (!config.refundsEnabled) {
      return this.finalizer.markManualRefundRequested(
        attempt,
        user.uid,
        input.reason,
      );
    }

    this.assertAplazoRefundLocalStatus(attempt);
    const providerStatus = await aplazoProvider.getStatus(attempt);
    this.assertAplazoRefundProviderStatus(providerStatus.status);

    const refundAmounts = this.resolveAplazoRefundAmounts(
      attempt,
      input.refundAmountMinor,
    );

    if (attempt.ordenId) {
      const orderDoc = await firestoreTienda
        .collection(ORDENES_COLLECTION)
        .doc(attempt.ordenId)
        .get();
      if (orderDoc.exists) {
        try {
          await shippingRefundGuardService.ensureShipmentCanProceedToRefund({
            orderId: attempt.ordenId,
            order: orderDoc.data() as Orden,
            reason: input.reason,
            requestedByUid: user.uid,
          });
        } catch (error) {
          if (error instanceof ShippingRefundGuardError) {
            throw new PaymentApiError(
              error.statusCode,
              "SHIPPING_REFUND_BLOCKED",
              error.message,
            );
          }
          throw error;
        }
      }
    }

    await firestoreTienda.collection(SHIPPING_EVENTS_COLLECTION).add({
      orderId: attempt.ordenId,
      provider: ProveedorPago.APLAZO,
      type: "REFUND_REQUESTED",
      reason: input.reason,
      refundAmountMinor: refundAmounts.requestedMinor,
      createdBy: user.uid,
      createdAt: Timestamp.now(),
    });

    const refundOperation = await this.refundRepo.createProcessingRefund({
      paymentAttemptId,
      amountMinor: refundAmounts.requestedMinor,
      reason: input.reason,
      requestedBy: user.uid,
    });

    try {
      const refundResult = await aplazoProvider.refund({
        paymentAttempt: attempt,
        refundAmountMinor: refundAmounts.requestedMinor,
        reason: input.reason,
      });

      const nextRefundTotalMinor =
        refundAmounts.alreadyRefundedMinor + refundAmounts.requestedMinor;
      const nextRefundRemainingMinor = Math.max(
        refundAmounts.totalPaidMinor - nextRefundTotalMinor,
        0,
      );
      const nextStatus =
        nextRefundRemainingMinor === 0
          ? PaymentStatus.REFUNDED
          : PaymentStatus.PARTIALLY_REFUNDED;
      const nextRefundsCount = (attempt.refundsCount ?? 0) + 1;

      await this.refundRepo.markSucceeded({
        operationId: refundOperation.id!,
        paymentAttemptId,
        orderId: attempt.ordenId,
        providerRefundId: refundResult.refundId,
        providerResponse: refundResult.rawResponseSanitized,
        nextPaymentStatus: nextStatus,
        refundTotalMinor: nextRefundTotalMinor,
        refundRemainingMinor: nextRefundRemainingMinor,
        refundsCount: nextRefundsCount,
        reason: input.reason,
        refundAmountMinor: refundAmounts.requestedMinor,
        refundAmountMajor: nextRefundTotalMinor / 100,
        providerStatus: refundResult.providerStatus,
      });

      await firestoreTienda.collection(SHIPPING_EVENTS_COLLECTION).add({
        orderId: attempt.ordenId,
        provider: ProveedorPago.APLAZO,
        type: "REFUND_COMPLETED",
        refundId: refundResult.refundId,
        refundAmountMinor: refundAmounts.requestedMinor,
        reason: input.reason,
        createdBy: user.uid,
        createdAt: Timestamp.now(),
      });

      const updatedAttempt = await this.requirePaymentAttempt(paymentAttemptId);
      return updatedAttempt;
    } catch (error) {
      await this.refundRepo.markFailed({
        operationId: refundOperation.id!,
        paymentAttemptId,
        failedReason:
          error instanceof Error ? error.message : "Error desconocido con Aplazo",
        providerResponse:
          error instanceof PaymentApiError ? error.details : undefined,
      });

      throw new PaymentApiError(
        error instanceof PaymentApiError ? error.statusCode : 502,
        "APLAZO_REFUND_FAILED",
        "Aplazo no pudo procesar el refund; el pago local no fue marcado como reembolsado",
        {
          paymentAttemptId,
          refundOperationId: refundOperation.id,
          originalCode:
            error instanceof PaymentApiError ? error.code : "UNKNOWN_ERROR",
          originalMessage:
            error instanceof Error ? error.message : "Error desconocido",
        },
      );
    }
  }

  async getAplazoRefundStatus(
    paymentAttemptId: string,
    actor: AuthActor,
    input: { refundId?: string },
  ): Promise<AplazoRefundStatusSyncResult> {
    const user = await this.requireAuthenticatedActor(actor);
    if (!isPrivileged(user.rol)) {
      throw new PaymentApiError(
        403,
        "PAYMENT_FORBIDDEN",
        "Solo ADMIN o EMPLEADO puede consultar refunds Aplazo",
      );
    }

    const attempt = await this.requirePaymentAttempt(paymentAttemptId);
    if (attempt.provider !== ProveedorPago.APLAZO) {
      throw new PaymentApiError(
        409,
        "PAYMENT_VALIDATION_ERROR",
        "El endpoint de refund status solo soporta Aplazo",
      );
    }

    this.assertAplazoOnlineAttempt(attempt);

    if (!aplazoProvider.getRefundStatus) {
      throw new PaymentApiError(
        409,
        "PAYMENT_REFUND_UNSUPPORTED",
        "El proveedor no soporta consultar refund status",
      );
    }

    const refundResult = await aplazoProvider.getRefundStatus({
      paymentAttempt: attempt,
      refundId: input.refundId,
    });
    const refunds = refundResult.refundEntries || [];
    const confirmedRefundMinor = this.getConfirmedRefundTotalMinor(refunds, attempt);
    const nextStatus = this.resolvePaymentStatusAfterRefundSync(
      attempt,
      confirmedRefundMinor,
      refunds.length > 0,
    );

    const updatedAttempt = await this.paymentAttemptRepo.update(paymentAttemptId, {
      status: nextStatus,
      providerStatus: refundResult.providerStatus ?? attempt.providerStatus,
      refundState: refundResult.refundState ?? attempt.refundState ?? RefundState.NONE,
      refundId: refundResult.refundId ?? attempt.refundId,
      refundAmount:
        refunds.length > 0 ? confirmedRefundMinor / 100 : attempt.refundAmount,
      metadata: {
        ...(attempt.metadata || {}),
        lastRefundStatusSyncAt: Timestamp.now(),
        lastRefundStatusSyncBy: user.uid,
      },
    });

    return {
      paymentAttempt: updatedAttempt,
      refunds,
      selectedRefund:
        refundResult.refundId
          ? refunds.find((refund) => refund.refundId === refundResult.refundId)
          : this.selectLatestRefundEntry(refunds),
      totalRefundedAmount:
        typeof updatedAttempt.refundAmount === "number"
          ? updatedAttempt.refundAmount
        : 0,
    };
  }

  async createAplazoRefundRequest(
    actor: AuthActor,
    input: { orderId: string; reason: string },
  ): Promise<PaymentRefundRequestRecord> {
    const user = await this.requireAuthenticatedActor(actor);
    const order = await this.requireOrderForRefundRequest(input.orderId, user);
    const attempt = await this.requireAplazoRefundableAttemptForOrder(order.id);
    await this.assertActorCanAccessAttempt(attempt, user);

    const openRequest = await this.refundRequestRepo.findOpenByPaymentAttempt(
      attempt.id!,
    );
    if (openRequest) {
      throw new PaymentApiError(
        409,
        "REFUND_REQUEST_ALREADY_OPEN",
        "Ya existe una solicitud de devolución pendiente o aprobada para este pago",
        {
          refundRequestId: openRequest.id,
          paymentAttemptId: attempt.id,
        },
      );
    }

    return this.refundRequestRepo.create({
      orderId: order.id,
      paymentAttemptId: attempt.id!,
      userId: user.uid,
      reason: input.reason,
    });
  }

  async listAplazoRefundRequestsForActor(
    actor: AuthActor,
    input: { orderId?: string } = {},
  ): Promise<PaymentRefundRequestRecord[]> {
    const user = await this.requireAuthenticatedActor(actor);
    return this.refundRequestRepo.listByUser(user.uid, input);
  }

  async getAplazoRefundRequestForActor(
    refundRequestId: string,
    actor: AuthActor,
  ): Promise<PaymentRefundRequestRecord> {
    const user = await this.requireAuthenticatedActor(actor);
    const request = await this.requireRefundRequest(refundRequestId);
    if (request.userId !== user.uid && !isPrivileged(user.rol)) {
      throw new PaymentApiError(
        403,
        "PAYMENT_FORBIDDEN",
        "No tienes permisos para consultar esta solicitud de devolución",
      );
    }

    return request;
  }

  async listAplazoRefundRequestsForAdmin(
    actor: AuthActor,
    input: { status?: PaymentRefundRequestStatus } = {},
  ): Promise<PaymentRefundRequestRecord[]> {
    const user = await this.requireAuthenticatedActor(actor);
    this.assertPrivilegedPosActor(user);
    return this.refundRequestRepo.listForAdmin(input);
  }

  async approveAplazoRefundRequest(
    refundRequestId: string,
    actor: AuthActor,
    input: { refundAmountMinor: number; reason?: string },
  ): Promise<PaymentRefundRequestRecord> {
    const user = await this.requireAuthenticatedActor(actor);
    if (user.rol !== RolUsuario.ADMIN) {
      throw new PaymentApiError(
        403,
        "PAYMENT_FORBIDDEN",
        "Solo ADMIN puede aprobar solicitudes de devolución Aplazo",
      );
    }

    const request = await this.requireRefundRequest(refundRequestId);
    if (request.status !== "pending" && request.status !== "approved") {
      throw new PaymentApiError(
        409,
        "REFUND_REQUEST_NOT_APPROVABLE",
        "Solo solicitudes pendientes o aprobadas con error se pueden aprobar/procesar",
        {
          refundRequestId,
          status: request.status,
        },
      );
    }

    const config = getAplazoConfig();
    if (!config.refundsEnabled) {
      throw new PaymentApiError(
        409,
        "PAYMENT_REFUND_UNSUPPORTED",
        "Refund Aplazo deshabilitado por feature flag",
      );
    }

    const attempt = await this.requirePaymentAttempt(request.paymentAttemptId);
    if (attempt.provider !== ProveedorPago.APLAZO) {
      throw new PaymentApiError(
        409,
        "PAYMENT_VALIDATION_ERROR",
        "La solicitud no corresponde a un pago Aplazo",
      );
    }
    this.assertAplazoOnlineAttempt(attempt);
    this.assertAplazoRefundLocalStatus(attempt);
    this.resolveAplazoRefundAmounts(attempt, input.refundAmountMinor);

    await this.refundRequestRepo.markApproved({
      id: refundRequestId,
      approvedBy: user.uid,
      refundAmountMinor: input.refundAmountMinor,
      reason: input.reason,
    });

    try {
      const updatedAttempt = await this.refundAplazoPaymentAttempt(
        request.paymentAttemptId,
        user,
        {
          refundAmountMinor: input.refundAmountMinor,
          reason: input.reason || request.reason,
        },
      );

      return this.refundRequestRepo.markProcessed({
        id: refundRequestId,
        providerRefundId: updatedAttempt.refundId,
        providerStatus: updatedAttempt.providerStatus,
        providerResponse: {
          paymentAttemptId: updatedAttempt.id,
          refundState: updatedAttempt.refundState,
          refundTotalMinor: updatedAttempt.refundTotalMinor,
          refundRemainingMinor: updatedAttempt.refundRemainingMinor,
        },
      });
    } catch (error) {
      await this.refundRequestRepo.markProcessingFailed(
        refundRequestId,
        sanitizeForStorage({
          code:
            error instanceof PaymentApiError
              ? error.code
              : "UNKNOWN_REFUND_ERROR",
          message:
            error instanceof Error
              ? error.message
              : "Error desconocido al procesar refund Aplazo",
          details: error instanceof PaymentApiError ? error.details : undefined,
          failedAt: Timestamp.now(),
        }),
      );

      throw error;
    }
  }

  async rejectAplazoRefundRequest(
    refundRequestId: string,
    actor: AuthActor,
    input: { reason: string },
  ): Promise<PaymentRefundRequestRecord> {
    const user = await this.requireAuthenticatedActor(actor);
    if (user.rol !== RolUsuario.ADMIN) {
      throw new PaymentApiError(
        403,
        "PAYMENT_FORBIDDEN",
        "Solo ADMIN puede rechazar solicitudes de devolución Aplazo",
      );
    }

    const request = await this.requireRefundRequest(refundRequestId);
    if (request.status !== "pending") {
      throw new PaymentApiError(
        409,
        "REFUND_REQUEST_NOT_REJECTABLE",
        "Solo solicitudes pendientes se pueden rechazar",
        {
          refundRequestId,
          status: request.status,
        },
      );
    }

    return this.refundRequestRepo.markRejected({
      id: refundRequestId,
      rejectedBy: user.uid,
      reason: input.reason,
    });
  }

  async resolveBrowserReturnState(
    lookup: BrowserReturnLookup,
  ): Promise<{
    paymentAttempt: PaymentAttempt | null;
    message: string;
    isTerminal: boolean;
    nextPollAfterMs: number;
  }> {
    const paymentAttempt = await this.findReturnAttempt(lookup);
    if (!paymentAttempt) {
      return {
        paymentAttempt: null,
        message:
          "No encontramos el intento de pago. Estamos esperando confirmación asíncrona del proveedor.",
        isTerminal: false,
        nextPollAfterMs: POLL_NEXT_PENDING_LONG_MS,
      };
    }

    const status = toPaymentStatus(paymentAttempt);
    if (status === PaymentStatus.PAID) {
      return {
        paymentAttempt,
        message: "Pago validado correctamente.",
        isTerminal: true,
        nextPollAfterMs: 0,
      };
    }

    if (
      status === PaymentStatus.CANCELED ||
      status === PaymentStatus.EXPIRED ||
      status === PaymentStatus.FAILED
    ) {
      return {
        paymentAttempt,
        message: "El intento ya no está vigente o fue rechazado.",
        isTerminal: true,
        nextPollAfterMs: 0,
      };
    }

    return {
      paymentAttempt,
      message:
        "Estamos validando tu pago con Aplazo. El webhook sigue siendo la fuente de verdad.",
      isTerminal: false,
      nextPollAfterMs: POLL_NEXT_PENDING_SHORT_MS,
    };
  }

  private async requireAuthenticatedActor(actor: AuthActor): Promise<AuthActor> {
    if (!actor?.uid) {
      throw new PaymentApiError(
        401,
        "PAYMENT_AUTH_REQUIRED",
        "Se requiere autenticación para operar pagos",
      );
    }

    return actor;
  }

  private async requirePaymentAttempt(paymentAttemptId: string): Promise<PaymentAttempt> {
    const attempt = await this.paymentAttemptRepo.getById(paymentAttemptId);
    if (!attempt) {
      throw new PaymentApiError(
        404,
        "PAYMENT_ATTEMPT_NOT_FOUND",
        `PaymentAttempt ${paymentAttemptId} no encontrado`,
      );
    }

    return attempt;
  }

  private async requirePayableOrder(
    orderId: string,
    actor: AuthActor,
  ): Promise<Orden & { id: string }> {
    const snapshot = await firestoreTienda
      .collection(ORDENES_COLLECTION)
      .doc(orderId)
      .get();
    if (!snapshot.exists) {
      throw new PaymentApiError(
        404,
        "PAYMENT_ORDER_INVALID",
        `Orden ${orderId} no encontrada`,
        {
          reason: "ORDER_NOT_FOUND",
          orderId,
        },
      );
    }

    const order = {
      id: snapshot.id,
      ...(snapshot.data() as Orden),
    };

    if (!isPrivileged(actor.rol) && order.usuarioId !== actor.uid) {
      throw new PaymentApiError(
        403,
        "PAYMENT_FORBIDDEN",
        "No puedes crear un pago para una orden ajena",
      );
    }

    if (order.estado !== EstadoOrden.PENDIENTE) {
      throw new PaymentApiError(
        409,
        "PAYMENT_ORDER_INVALID",
        `La orden ${orderId} no está disponible para pago. Estado actual: ${order.estado}`,
        {
          reason: "ORDER_STATUS_INVALID",
          orderId,
          orderStatus: order.estado,
          paymentMethod: order.metodoPago,
        },
      );
    }

    if (order.metodoPago !== MetodoPago.APLAZO) {
      throw new PaymentApiError(
        409,
        "PAYMENT_ORDER_INVALID",
        "La orden debe haberse creado con método de pago APLAZO para este flujo",
        {
          reason: "ORDER_PAYMENT_METHOD_INVALID",
          orderId,
          orderStatus: order.estado,
          paymentMethod: order.metodoPago,
        },
      );
    }

    if (!Array.isArray(order.items) || order.items.length === 0) {
      throw new PaymentApiError(
        409,
        "PAYMENT_ORDER_INVALID",
        "La orden no tiene productos para enviar a Aplazo",
        {
          reason: "ORDER_ITEMS_EMPTY",
          orderId,
          orderStatus: order.estado,
          paymentMethod: order.metodoPago,
        },
      );
    }

    if (typeof order.total !== "number" || !Number.isFinite(order.total) || order.total <= 0) {
      throw new PaymentApiError(
        409,
        "PAYMENT_ORDER_INVALID",
        "La orden debe tener un total mayor a cero",
        {
          reason: "ORDER_TOTAL_INVALID",
          orderId,
          orderStatus: order.estado,
          paymentMethod: order.metodoPago,
          orderTotal: order.total,
        },
      );
    }

    return order;
  }

  private async requireOrderForRefundRequest(
    orderId: string,
    actor: AuthActor,
  ): Promise<Orden & { id: string }> {
    const snapshot = await firestoreTienda
      .collection(ORDENES_COLLECTION)
      .doc(orderId)
      .get();
    if (!snapshot.exists) {
      throw new PaymentApiError(
        404,
        "PAYMENT_ORDER_INVALID",
        `Orden ${orderId} no encontrada`,
      );
    }

    const order = {
      id: snapshot.id,
      ...(snapshot.data() as Orden),
    };

    if (order.usuarioId !== actor.uid) {
      throw new PaymentApiError(
        403,
        "PAYMENT_FORBIDDEN",
        "No puedes solicitar devolución de una orden ajena",
      );
    }

    return order;
  }

  private async requireAplazoRefundableAttemptForOrder(
    orderId: string,
  ): Promise<PaymentAttempt> {
    const attempt = await this.paymentAttemptRepo.findLatestByOrderAndFlow(
      ProveedorPago.APLAZO,
      orderId,
      PaymentFlowType.ONLINE,
    );
    if (!attempt) {
      throw new PaymentApiError(
        404,
        "PAYMENT_ATTEMPT_NOT_FOUND",
        "No se encontró un pago Aplazo online para esta orden",
        {
          orderId,
        },
      );
    }

    this.assertAplazoRefundLocalStatus(attempt);
    this.resolveAplazoRefundAmounts(attempt);
    return attempt;
  }

  private async requireRefundRequest(
    refundRequestId: string,
  ): Promise<PaymentRefundRequestRecord> {
    const request = await this.refundRequestRepo.getById(refundRequestId);
    if (!request) {
      throw new PaymentApiError(
        404,
        "REFUND_REQUEST_NOT_FOUND",
        `Solicitud de devolución ${refundRequestId} no encontrada`,
      );
    }

    return request;
  }

  private async resolveOnlineCustomer(
    actor: AuthActor,
    input?: PaymentCustomerInput,
  ): Promise<{ name?: string; email?: string; phone?: string }> {
    const userSnapshot = await firestoreTienda
      .collection(USERS_APP_COLLECTION)
      .where("uid", "==", actor.uid)
      .limit(1)
      .get();

    const userData = userSnapshot.empty
      ? {}
      : (userSnapshot.docs[0].data() as Record<string, unknown>);

    return {
      name: normalizeWhitespace(
        input?.name ||
          actor.nombre ||
          (typeof userData.nombre === "string" ? userData.nombre : undefined),
      ),
      email: normalizeEmail(
        input?.email ||
          actor.email ||
          (typeof userData.email === "string" ? userData.email : undefined),
      ),
      phone: normalizeMxPhoneForAplazo(
        input?.phone ||
          actor.telefono ||
          (typeof userData.telefono === "string" ? userData.telefono : undefined),
      ),
    };
  }

  private validateOnlineAplazoPayload(input: {
    customer: { name?: string; email?: string; phone?: string };
    amountMinor: number;
    currency?: string;
    providerReference?: string;
    pricingSnapshot: PaymentPricingSnapshot;
    successUrl?: string;
    failureUrl?: string;
  }): void {
    if (!normalizeWhitespace(input.customer.name)) {
      throw createPaymentValidationError("Nombre inválido para Aplazo");
    }

    if (!input.customer.email || !isValidEmail(input.customer.email)) {
      throw createPaymentValidationError("Email inválido para Aplazo");
    }

    if (!input.customer.phone) {
      throw createPaymentValidationError("Teléfono inválido para Aplazo");
    }

    if (input.amountMinor <= 0) {
      throw createPaymentValidationError("Monto inválido para Aplazo");
    }

    if (!normalizeCurrency(input.currency)) {
      throw createPaymentValidationError("Currency inválida para Aplazo");
    }

    if (!normalizeWhitespace(input.providerReference)) {
      throw createPaymentValidationError("No fue posible resolver cartId para Aplazo");
    }

    if (!input.successUrl || !input.failureUrl) {
      throw createPaymentValidationError(
        "Aplazo online requiere successUrl y failureUrl/cancelUrl",
      );
    }

    if (!input.pricingSnapshot.items.length) {
      throw createPaymentValidationError(
        "No fue posible construir products[] válidos para Aplazo",
      );
    }

    input.pricingSnapshot.items.forEach((item, index) => {
      const name = normalizeWhitespace(item.name || item.productoId);
      if (
        !name ||
        item.cantidad <= 0 ||
        item.precioUnitarioMinor <= 0 ||
        item.subtotalMinor <= 0
      ) {
        throw createPaymentValidationError(
          "No fue posible construir products[] válidos para Aplazo",
          {
            index,
            productoId: item.productoId,
          },
        );
      }
    });
  }

  private async buildOrderPricingSnapshot(order: Orden): Promise<PaymentPricingSnapshot> {
    const items = await Promise.all(
      (order.items || []).map(async (item) => {
        const product = await productService.getProductById(item.productoId);
        const checkoutItem = order.pricingSnapshot?.items?.find(
          (pricingItem) =>
            pricingItem.productId === item.productoId &&
            (pricingItem.tallaId || "") === (item.tallaId || ""),
        );

        return {
          productoId: item.productoId,
          cantidad: item.cantidad,
          precioUnitarioMinor: roundToMinor(item.precioUnitario),
          subtotalMinor: roundToMinor(item.subtotal),
          tallaId: item.tallaId,
          name: checkoutItem?.productName || product?.descripcion || item.productoId,
          sku: checkoutItem?.sku || product?.clave,
          imageUrl: product?.imagenes?.[0],
          precioUnitarioOriginalMinor:
            typeof checkoutItem?.unitPriceOriginal === "number"
              ? roundToMinor(checkoutItem.unitPriceOriginal)
              : roundToMinor(item.precioUnitario),
          precioUnitarioFinalMinor:
            typeof checkoutItem?.unitPriceFinal === "number"
              ? roundToMinor(checkoutItem.unitPriceFinal)
              : roundToMinor(item.precioUnitario),
          subtotalOriginalMinor:
            typeof checkoutItem?.subtotalOriginal === "number"
              ? roundToMinor(checkoutItem.subtotalOriginal)
              : roundToMinor(item.subtotal),
          subtotalFinalMinor:
            typeof checkoutItem?.subtotalFinal === "number"
              ? roundToMinor(checkoutItem.subtotalFinal)
              : roundToMinor(item.subtotal),
          discountMinor:
            typeof checkoutItem?.discountTotal === "number"
              ? roundToMinor(checkoutItem.discountTotal)
              : 0,
          weightKg: checkoutItem?.weightKg,
          lengthCm: checkoutItem?.lengthCm,
          widthCm: checkoutItem?.widthCm,
          heightCm: checkoutItem?.heightCm,
          requiresShipping: checkoutItem?.requiereEnvio,
        };
      }),
    );

    return {
      subtotalMinor: roundToMinor(order.subtotal),
      taxMinor: roundToMinor(order.impuestos),
      shippingMinor: roundToMinor(order.costoEnvio),
      totalMinor: roundToMinor(order.total),
      currency: order.currency || "MXN",
      items,
      subtotalOriginalMinor:
        typeof order.subtotalOriginal === "number"
          ? roundToMinor(order.subtotalOriginal)
          : roundToMinor(order.subtotal),
      subtotalFinalMinor:
        typeof order.subtotalFinal === "number"
          ? roundToMinor(order.subtotalFinal)
          : roundToMinor(order.subtotal),
      discountMinor:
        typeof order.discountTotal === "number"
          ? roundToMinor(order.discountTotal)
          : 0,
      shipping: order.shipping
        ? {
            method:
              typeof order.shipping.method === "string"
                ? order.shipping.method
                : undefined,
            provider:
              typeof order.shipping.provider === "string"
                ? order.shipping.provider
                : undefined,
            serviceType:
              typeof order.shipping.serviceType === "string"
                ? order.shipping.serviceType
                : undefined,
            serviceName:
              typeof order.shipping.serviceName === "string"
                ? order.shipping.serviceName
                : undefined,
            carrierCode:
              typeof order.shipping.carrierCode === "string"
                ? order.shipping.carrierCode
                : undefined,
            packagingType:
              typeof order.shipping.packagingType === "string"
                ? order.shipping.packagingType
                : undefined,
            amountMinor: roundToMinor(order.costoEnvio),
            currency: order.currency || "MXN",
            transitTime:
              typeof order.shipping.transitTime === "string"
                ? order.shipping.transitTime
                : undefined,
            deliveryTimestamp:
              typeof order.shipping.deliveryTimestamp === "string"
                ? order.shipping.deliveryTimestamp
                : undefined,
            deliveryDayOfWeek:
              typeof order.shipping.deliveryDayOfWeek === "string"
                ? order.shipping.deliveryDayOfWeek
                : undefined,
            addressValidationStatus:
              typeof order.shipping.addressValidationStatus === "string"
                ? order.shipping.addressValidationStatus
                : undefined,
            rateTransactionId:
              typeof order.shipping.rateTransactionId === "string"
                ? order.shipping.rateTransactionId
                : undefined,
            availabilityTransactionId:
              typeof order.shipping.availabilityTransactionId === "string"
                ? order.shipping.availabilityTransactionId
                : undefined,
            quotedAt:
              typeof order.shipping.quotedAt === "string"
                ? order.shipping.quotedAt
                : undefined,
          }
        : undefined,
      warnings: order.pricingSnapshot?.warnings || [],
      calculatedAt: order.pricingSnapshot?.calculatedAt,
    };
  }

  private generateDeterministicIdempotencyKey(
    flow: "online",
    primaryId: string,
    actorKey: string,
    amountMinor: number,
    pricingSnapshot: PaymentPricingSnapshot,
  ): string {
    const snapshotHash = createHash("sha256")
      .update(JSON.stringify(pricingSnapshot))
      .digest("hex");
    const digest = createHash("sha256")
      .update(`${flow}|${primaryId}|${actorKey}|${amountMinor}|${snapshotHash}`)
      .digest("hex");
    return `aplazo_${flow}_${digest.slice(0, 48)}`;
  }

  private assertPrivilegedPosActor(actor: AuthActor): void {
    if (!isPrivileged(actor.rol)) {
      throw new PaymentApiError(
        403,
        "PAYMENT_FORBIDDEN",
        "Solo personal autorizado puede operar pagos Aplazo",
      );
    }
  }

  private assertAplazoOnlineAttempt(attempt: PaymentAttempt): void {
    if (attempt.flowType === PaymentFlowType.IN_STORE) {
      throw new PaymentApiError(
        409,
        "PAYMENT_FLOW_UNSUPPORTED",
        "Las APIs Aplazo in-store ya no están disponibles; este endpoint solo soporta Aplazo online",
        {
          paymentAttemptId: attempt.id,
          flowType: attempt.flowType,
        },
      );
    }
  }

  private assertAplazoRefundLocalStatus(attempt: PaymentAttempt): void {
    const currentStatus = toPaymentStatus(attempt);
    if (
      currentStatus === PaymentStatus.PAID ||
      currentStatus === PaymentStatus.PARTIALLY_REFUNDED
    ) {
      return;
    }

    if (currentStatus === PaymentStatus.PENDING_CUSTOMER) {
      throw new PaymentApiError(
        409,
        "PAYMENT_NOT_PAID_USE_CANCEL",
        "El pago Aplazo sigue NO CONFIRMADO; usa cancelación en lugar de refund",
        {
          paymentAttemptId: attempt.id,
          currentStatus,
          providerStatus: attempt.providerStatus,
        },
      );
    }

    if (currentStatus === PaymentStatus.REFUNDED) {
      throw new PaymentApiError(
        409,
        "PAYMENT_ALREADY_REFUNDED",
        "El pago Aplazo ya está completamente reembolsado",
        {
          paymentAttemptId: attempt.id,
          currentStatus,
        },
      );
    }

    throw new PaymentApiError(
      409,
      "PAYMENT_NOT_PAID_USE_CANCEL",
      "Solo se pueden reembolsar pagos Aplazo confirmados/pagados",
      {
        paymentAttemptId: attempt.id,
        currentStatus,
        providerStatus: attempt.providerStatus,
      },
    );
  }

  private assertAplazoRefundProviderStatus(status: PaymentStatus): void {
    if (
      status === PaymentStatus.PAID ||
      status === PaymentStatus.PARTIALLY_REFUNDED
    ) {
      return;
    }

    if (status === PaymentStatus.PENDING_CUSTOMER) {
      throw new PaymentApiError(
        409,
        "PAYMENT_NOT_PAID_USE_CANCEL",
        "Aplazo reporta el pago como NO CONFIRMADO; usa cancelación en lugar de refund",
        {
          providerStatus: status,
        },
      );
    }

    throw new PaymentApiError(
      409,
      status === PaymentStatus.REFUNDED
        ? "PAYMENT_ALREADY_REFUNDED"
        : "PAYMENT_NOT_PAID_USE_CANCEL",
      status === PaymentStatus.REFUNDED
        ? "Aplazo reporta el pago como completamente reembolsado"
        : "Aplazo no reporta el pago como ACTIVO/pagado; no se puede solicitar refund",
      {
        providerStatus: status,
      },
    );
  }

  private resolveAplazoRefundAmounts(
    attempt: PaymentAttempt,
    requestedMinor?: number,
  ): {
    totalPaidMinor: number;
    alreadyRefundedMinor: number;
    remainingMinor: number;
    requestedMinor: number;
  } {
    const totalPaidMinor =
      typeof attempt.amountMinor === "number" && Number.isFinite(attempt.amountMinor)
        ? attempt.amountMinor
        : Math.round((attempt.monto || 0) * 100);
    const alreadyRefundedMinor =
      typeof attempt.refundTotalMinor === "number" &&
      Number.isFinite(attempt.refundTotalMinor)
        ? attempt.refundTotalMinor
        : typeof attempt.refundAmount === "number" &&
            Number.isFinite(attempt.refundAmount)
          ? Math.round(attempt.refundAmount * 100)
          : 0;
    const remainingMinor = Math.max(totalPaidMinor - alreadyRefundedMinor, 0);

    if (remainingMinor <= 0) {
      throw new PaymentApiError(
        409,
        "PAYMENT_ALREADY_REFUNDED",
        "El pago Aplazo ya está completamente reembolsado",
        {
          paymentAttemptId: attempt.id,
          totalPaidMinor,
          alreadyRefundedMinor,
        },
      );
    }

    const effectiveRequestedMinor =
      typeof requestedMinor === "number" ? requestedMinor : remainingMinor;

    if (!Number.isFinite(effectiveRequestedMinor) || effectiveRequestedMinor <= 0) {
      throw new PaymentApiError(
        400,
        "REFUND_AMOUNT_INVALID",
        "refundAmountMinor debe ser mayor a 0",
        {
          paymentAttemptId: attempt.id,
          refundAmountMinor: requestedMinor,
        },
      );
    }

    if (effectiveRequestedMinor > remainingMinor) {
      throw new PaymentApiError(
        409,
        "REFUND_AMOUNT_EXCEEDS_AVAILABLE",
        "El monto solicitado excede el saldo reembolsable disponible",
        {
          paymentAttemptId: attempt.id,
          requestedMinor: effectiveRequestedMinor,
          remainingMinor,
          totalPaidMinor,
          alreadyRefundedMinor,
        },
      );
    }

    return {
      totalPaidMinor,
      alreadyRefundedMinor,
      remainingMinor,
      requestedMinor: effectiveRequestedMinor,
    };
  }

  private getConfirmedRefundTotalMinor(
    refunds: ProviderRefundStatusEntry[],
    attempt: PaymentAttempt,
  ): number {
    if (refunds.length === 0) {
      return typeof attempt.refundAmount === "number"
        ? Math.round(attempt.refundAmount * 100)
        : 0;
    }

    return refunds.reduce((total, refund) => {
      if (refund.refundState !== RefundState.SUCCEEDED) {
        return total;
      }

      return total + (refund.amountMinor ?? 0);
    }, 0);
  }

  private resolvePaymentStatusAfterRefundSync(
    attempt: PaymentAttempt,
    confirmedRefundMinor: number,
    hasRefundEntries: boolean,
  ): PaymentStatus {
    const currentStatus = toPaymentStatus(attempt);
    const totalMinor =
      attempt.amountMinor ?? Math.round((attempt.monto || 0) * 100);

    if (confirmedRefundMinor > 0 && totalMinor > 0) {
      return confirmedRefundMinor >= totalMinor
        ? PaymentStatus.REFUNDED
        : PaymentStatus.PARTIALLY_REFUNDED;
    }

    if (
      hasRefundEntries &&
      (currentStatus === PaymentStatus.REFUNDED ||
        currentStatus === PaymentStatus.PARTIALLY_REFUNDED)
    ) {
      return PaymentStatus.PAID;
    }

    return currentStatus;
  }

  private selectLatestRefundEntry(
    refunds: ProviderRefundStatusEntry[],
  ): ProviderRefundStatusEntry | undefined {
    if (refunds.length === 0) {
      return undefined;
    }

    return [...refunds].sort((left, right) => {
      const leftDate = left.refundDate ? new Date(left.refundDate).getTime() : 0;
      const rightDate = right.refundDate ? new Date(right.refundDate).getTime() : 0;
      if (rightDate !== leftDate) {
        return rightDate - leftDate;
      }

      return Number(right.refundId || 0) - Number(left.refundId || 0);
    })[0];
  }

  private async assertActorCanAccessAttempt(
    attempt: PaymentAttempt,
    actor: AuthActor,
  ): Promise<void> {
    if (isPrivileged(actor.rol) || attempt.userId === actor.uid) {
      return;
    }

    if (attempt.ordenId) {
      const orderSnapshot = await firestoreTienda
        .collection(ORDENES_COLLECTION)
        .doc(attempt.ordenId)
        .get();
      const order = orderSnapshot.exists ? (orderSnapshot.data() as Orden) : null;
      if (order && order.usuarioId === actor.uid) {
        return;
      }
    }

    throw new PaymentApiError(
      403,
      "PAYMENT_FORBIDDEN",
      "No tienes permisos para consultar este intento de pago",
    );
  }

  private isTerminalStatus(status: PaymentStatus): boolean {
    return (
      status === PaymentStatus.PAID ||
      status === PaymentStatus.FAILED ||
      status === PaymentStatus.CANCELED ||
      status === PaymentStatus.EXPIRED ||
      status === PaymentStatus.REFUNDED ||
      status === PaymentStatus.PARTIALLY_REFUNDED
    );
  }

  private shouldSyncStatus(attempt: PaymentAttempt): boolean {
    const lastSyncRaw = attempt.metadata?.lastStatusSyncAt;
    const lastSync =
      lastSyncRaw instanceof Timestamp
        ? lastSyncRaw.toDate()
        : typeof lastSyncRaw === "string"
          ? new Date(lastSyncRaw)
          : undefined;

    if (!lastSync || Number.isNaN(lastSync.getTime())) {
      return true;
    }

    return Date.now() - lastSync.getTime() >= STATUS_SYNC_THROTTLE_MS;
  }

  private async findReturnAttempt(
    lookup: BrowserReturnLookup,
  ): Promise<PaymentAttempt | null> {
    if (lookup.paymentAttemptId) {
      const byId = await this.paymentAttemptRepo.getById(lookup.paymentAttemptId);
      if (byId) {
        return byId;
      }
    }

    if (lookup.providerPaymentId || lookup.providerReference) {
      return this.paymentAttemptRepo.findByProviderIdentifiers({
        provider: ProveedorPago.APLAZO,
        providerPaymentId: lookup.providerPaymentId,
        providerReference: lookup.providerReference,
      });
    }

    return null;
  }

  private tryParseRawJson(rawBody: Buffer): Record<string, unknown> | null {
    try {
      return JSON.parse(rawBody.toString("utf8")) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
}

export const paymentsService = new PaymentsService();
export default paymentsService;
