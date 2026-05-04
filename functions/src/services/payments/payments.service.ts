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

const ORDENES_COLLECTION = "ordenes";
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
        requestCurrency: requestCurrency || "MXN",
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

    const providerStatus = await aplazoProvider.cancelOrVoid({
      paymentAttempt: attempt,
      reason,
    });

    if (providerStatus.status === PaymentStatus.CANCELED) {
      return this.finalizer.finalizeTerminalStatus(attempt, PaymentStatus.CANCELED, {
        source: "cancel",
        requestedBy: user.uid,
        providerResult: providerStatus,
      });
    }

    return this.paymentAttemptRepo.update(attempt.id!, {
      status: providerStatus.status,
      providerStatus: providerStatus.providerStatus ?? attempt.providerStatus,
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

    try {
      const refundResult = await aplazoProvider.refund({
        paymentAttempt: attempt,
        refundAmountMinor: input.refundAmountMinor,
        reason: input.reason,
      });
      return this.finalizer.applyRefundResult(attempt, refundResult, {
        requestedBy: user.uid,
        refundAmountMinor: input.refundAmountMinor,
        reason: input.reason,
      });
    } catch (error) {
      if (
        error instanceof PaymentApiError &&
        error.code === "PAYMENT_REFUND_UNSUPPORTED"
      ) {
        return this.finalizer.markManualRefundRequested(
          attempt,
          user.uid,
          input.reason,
        );
      }
      throw error;
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

        return {
          productoId: item.productoId,
          cantidad: item.cantidad,
          precioUnitarioMinor: roundToMinor(item.precioUnitario),
          subtotalMinor: roundToMinor(item.subtotal),
          tallaId: item.tallaId,
          name: product?.descripcion || item.productoId,
          sku: product?.clave,
          imageUrl: product?.imagenes?.[0],
        };
      }),
    );

    return {
      subtotalMinor: roundToMinor(order.subtotal),
      taxMinor: roundToMinor(order.impuestos),
      shippingMinor: roundToMinor(order.costoEnvio),
      totalMinor: roundToMinor(order.total),
      currency: "MXN",
      items,
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
