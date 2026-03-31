import { createHash } from "crypto";
import { Timestamp } from "firebase-admin/firestore";
import { firestoreTienda } from "../../config/firebase";
import { getAplazoConfig } from "../../config/aplazo.config";
import { EstadoOrden, MetodoPago, Orden } from "../../models/orden.model";
import {
  PaymentFlowType,
  PaymentMethodCode,
  PaymentPricingSnapshot,
  PaymentStatus,
  ProveedorPago,
} from "../../models/pago.model";
import { Producto } from "../../models/producto.model";
import { PosSession } from "../../models/pos-session.model";
import {
  EstadoVentaPos,
  VentaPos,
  VentaPosItem,
} from "../../models/venta-pos.model";
import { RolUsuario } from "../../models/usuario.model";
import logger from "../../utils/logger";
import productService from "../product.service";
import { PaymentApiError } from "./payment-api-error";
import paymentAttemptRepository, {
  mapLegacyEstadoToPaymentStatus,
} from "./payment-attempt.repository";
import paymentEventLogRepository from "./payment-event-log.repository";
import paymentFinalizerService from "./payment-finalizer.service";
import paymentReconciliationService from "./payment-reconciliation.service";
import posSaleRepository from "./pos-sale.repository";
import posSessionRepository from "./pos-session.repository";
import aplazoProvider from "./providers/aplazo.provider";
import { sanitizeForStorage } from "./payment-sanitizer";
import { PaymentAttempt } from "./payment-domain.types";

const ORDENES_COLLECTION = "ordenes";
const USERS_APP_COLLECTION = "usuariosApp";
const POLL_NEXT_PENDING_SHORT_MS = 3_000;
const POLL_NEXT_PENDING_LONG_MS = 10_000;
const ONLINE_FALLBACK_EXPIRATION_MINUTES = 30;
const POS_FALLBACK_EXPIRATION_MINUTES = 15;
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

type InStoreCreateRequest = {
  ventaPosId?: string;
  posSessionId: string;
  deviceId: string;
  cajaId: string;
  sucursalId: string;
  vendedorUid: string;
  customer?: PaymentCustomerInput;
  items?: PaymentItemInput[];
  subtotal?: number;
  tax?: number;
  shipping?: number;
  total?: number;
  amount?: number;
  currency?: string;
  metadata?: Record<string, unknown>;
};

type BrowserReturnLookup = {
  paymentAttemptId?: string;
  providerPaymentId?: string;
  providerReference?: string;
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

const getBackendWebhookUrl = (): string => {
  return `${process.env.APP_URL || "http://localhost:3000"}/api/webhooks/aplazo`;
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
    private readonly posSaleRepo = posSaleRepository,
    private readonly posSessionRepo = posSessionRepository,
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
    const pricingSnapshot = this.buildOrderPricingSnapshot(order);
    const amountMinor = pricingSnapshot.totalMinor;

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

    const metadataCartId =
      getMetadataString(request.metadata, "cartId") || order.id;
    const successUrl = request.successUrl || config.online.successUrl;
    const cancelUrl = request.cancelUrl || config.online.cancelUrl;
    const failureUrl = request.failureUrl || config.online.failureUrl;
    const webhookUrl = getBackendWebhookUrl();
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
      failureUrl,
      webhookUrl,
      providerReference: metadataCartId,
      expiresAt,
      pricingSnapshot,
      metadata: {
        ...(request.metadata || {}),
        cartId: metadataCartId,
        cartUrl: request.cartUrl || config.online.cartUrl,
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
        failureUrl,
        cartUrl: request.cartUrl || config.online.cartUrl,
        webhookUrl,
        metadata: {
          orderId: order.id,
          userId: user.uid,
          cartId: metadataCartId,
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
        },
      });
      throw error;
    }
  }

  async createAplazoInStore(
    actor: AuthActor,
    request: InStoreCreateRequest,
    headerIdempotencyKey?: string,
  ): Promise<{ created: boolean; paymentAttempt: PaymentAttempt; sale: VentaPos }> {
    const user = await this.requireAuthenticatedActor(actor);
    this.assertPrivilegedPosActor(user);

    const session = await this.requireOpenPosSession(request.posSessionId, user);
    this.assertPosContextMatchesSession(request, session, user);

    const sale = request.ventaPosId
      ? await this.requireExistingPosSale(request.ventaPosId, session)
      : await this.createDraftPosSale(request, session);

    const pricingSnapshot = this.buildPosPricingSnapshot(sale);
    const amountMinor = pricingSnapshot.totalMinor;

    if (
      typeof request.amount === "number" &&
      roundToMinor(request.amount) !== amountMinor
    ) {
      throw new PaymentApiError(
        409,
        "PAYMENT_AMOUNT_MISMATCH",
        "El monto enviado por POS no coincide con el cálculo del backend",
      );
    }

    const idempotencyKey =
      validateIdempotencyKey(headerIdempotencyKey) ??
      this.generateDeterministicIdempotencyKey(
        "in_store",
        sale.id!,
        session.id!,
        amountMinor,
        pricingSnapshot,
      );

    const existing = await this.paymentAttemptRepo.findByIdempotencyKey(
      ProveedorPago.APLAZO,
      idempotencyKey,
    );
    if (existing) {
      await this.assertActorCanAccessAttempt(existing, user);
      return { created: false, paymentAttempt: existing, sale };
    }

    const providerReference =
      sale.providerReference ||
      getMetadataString(request.metadata, "cartId") ||
      sale.id;
    const webhookUrl = getBackendWebhookUrl();
    const callbackUrl =
      getAplazoConfig().inStore.callbackUrl ||
      `${process.env.APP_URL || "http://localhost:3000"}/payments/aplazo/success`;
    const expiresAt = Timestamp.fromDate(
      new Date(Date.now() + POS_FALLBACK_EXPIRATION_MINUTES * 60 * 1000),
    );
    const customer = {
      name: request.customer?.name || sale.customerName,
      email: request.customer?.email || sale.customerEmail,
      phone: request.customer?.phone || sale.customerPhone,
    };

    const attempt = await this.paymentAttemptRepo.create({
      provider: ProveedorPago.APLAZO,
      flowType: PaymentFlowType.IN_STORE,
      paymentMethodCode: PaymentMethodCode.APLAZO,
      metodoPago: MetodoPago.APLAZO,
      ventaPosId: sale.id,
      userId: user.uid,
      customerId: user.uid,
      customerName: customer.name,
      customerEmail: customer.email,
      customerPhone: customer.phone,
      currency: pricingSnapshot.currency,
      amount: pricingSnapshot.totalMinor / 100,
      amountMinor,
      idempotencyKey,
      webhookUrl,
      providerReference,
      expiresAt,
      pricingSnapshot,
      metadata: {
        ...(request.metadata || {}),
        cartId: providerReference,
        callbackUrl,
      },
      posSessionId: session.id,
      deviceId: session.deviceId,
      status: PaymentStatus.CREATED,
      rawCreateRequestSanitized: sanitizeForStorage({
        ventaPosId: sale.id,
        posSessionId: request.posSessionId,
        cartId: providerReference,
        customer,
      }),
    });

    await this.paymentAttemptRepo.update(attempt.id!, {
      status: PaymentStatus.PENDING_PROVIDER,
    });

    try {
      const providerResult = await aplazoProvider.createInStore({
        paymentAttemptId: attempt.id!,
        idempotencyKey,
        amountMinor,
        currency: pricingSnapshot.currency,
        providerReference,
        customerName: customer.name,
        customerEmail: customer.email,
        customerPhone: customer.phone,
        webhookUrl,
        callbackUrl,
        metadata: {
          ventaPosId: sale.id,
          posSessionId: session.id,
          cajaId: session.cajaId,
          sucursalId: session.sucursalId,
          vendedorUid: session.vendedorUid,
          cartId: providerReference,
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
        redirectUrl: providerResult.paymentLink,
        expiresAt: providerResult.expiresAt
          ? Timestamp.fromDate(providerResult.expiresAt)
          : attempt.expiresAt,
        rawCreateRequestSanitized: providerResult.rawRequestSanitized,
        rawCreateResponseSanitized: providerResult.rawResponseSanitized,
        metadata: {
          ...(attempt.metadata || {}),
          cartId: providerResult.providerReference || providerReference,
          paymentLink: providerResult.paymentLink,
          qrString: providerResult.qrString,
          qrImageUrl: providerResult.qrImageUrl,
        },
      });

      const updatedSale = await this.posSaleRepo.update(sale.id!, {
        paymentAttemptId: updated.id,
        providerReference: providerResult.providerReference,
        status: EstadoVentaPos.PENDIENTE_PAGO,
      });

      return {
        created: true,
        paymentAttempt: updated,
        sale: updatedSale,
      };
    } catch (error) {
      if (
        error instanceof PaymentApiError &&
        error.code === "PAYMENT_PROVIDER_TIMEOUT"
      ) {
        const timeoutAttempt = await this.paymentAttemptRepo.update(attempt.id!, {
          status: PaymentStatus.PENDING_PROVIDER,
          providerStatus: "timeout",
        });
        return {
          created: true,
          paymentAttempt: timeoutAttempt,
          sale,
        };
      }

      await this.paymentAttemptRepo.update(attempt.id!, {
        status: PaymentStatus.FAILED,
        providerStatus: "create_failed",
        failedAt: Timestamp.now(),
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
        "PAYMENT_ORDER_NOT_FOUND",
        `Orden ${orderId} no encontrada`,
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
        "PAYMENT_VALIDATION_ERROR",
        `La orden ${orderId} no está disponible para pago. Estado actual: ${order.estado}`,
      );
    }

    if (order.metodoPago !== MetodoPago.APLAZO) {
      throw new PaymentApiError(
        409,
        "PAYMENT_VALIDATION_ERROR",
        "La orden debe haberse creado con método de pago APLAZO para este flujo",
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
      name:
        input?.name?.trim() ||
        actor.nombre ||
        (typeof userData.nombre === "string" ? userData.nombre : undefined),
      email:
        input?.email?.trim() ||
        actor.email ||
        (typeof userData.email === "string" ? userData.email : undefined),
      phone:
        input?.phone?.trim() ||
        actor.telefono ||
        (typeof userData.telefono === "string" ? userData.telefono : undefined),
    };
  }

  private buildOrderPricingSnapshot(order: Orden): PaymentPricingSnapshot {
    return {
      subtotalMinor: roundToMinor(order.subtotal),
      taxMinor: roundToMinor(order.impuestos),
      shippingMinor: 0,
      totalMinor: roundToMinor(order.total),
      currency: "mxn",
      items: (order.items || []).map((item) => ({
        productoId: item.productoId,
        cantidad: item.cantidad,
        precioUnitarioMinor: roundToMinor(item.precioUnitario),
        subtotalMinor: roundToMinor(item.subtotal),
        tallaId: item.tallaId,
      })),
    };
  }

  private buildPosPricingSnapshot(sale: VentaPos): PaymentPricingSnapshot {
    return {
      subtotalMinor: sale.subtotalMinor,
      taxMinor: sale.taxMinor,
      shippingMinor: sale.shippingMinor,
      totalMinor: sale.totalMinor,
      currency: sale.currency,
      items: sale.items.map((item) => ({
        productoId: item.productoId,
        cantidad: item.cantidad,
        precioUnitarioMinor: roundToMinor(item.precioUnitario),
        subtotalMinor: roundToMinor(item.subtotal),
        tallaId: item.tallaId,
      })),
    };
  }

  private generateDeterministicIdempotencyKey(
    flow: "online" | "in_store",
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
        "El flujo in-store solo está disponible para personal autorizado",
      );
    }
  }

  private async requireOpenPosSession(
    posSessionId: string,
    actor: AuthActor,
  ): Promise<PosSession & { id: string }> {
    const session = await this.posSessionRepo.getOpenSession(posSessionId);
    if (!session) {
      throw new PaymentApiError(
        404,
        "PAYMENT_POS_SESSION_NOT_FOUND",
        `La sesión POS ${posSessionId} no existe o no está abierta`,
      );
    }

    if (actor.rol === RolUsuario.EMPLEADO && session.vendedorUid !== actor.uid) {
      throw new PaymentApiError(
        403,
        "PAYMENT_FORBIDDEN",
        "La sesión POS pertenece a otro vendedor",
      );
    }

    return session as PosSession & { id: string };
  }

  private assertPosContextMatchesSession(
    request: InStoreCreateRequest,
    session: PosSession,
    actor: AuthActor,
  ): void {
    if (request.deviceId !== session.deviceId) {
      throw new PaymentApiError(
        409,
        "PAYMENT_VALIDATION_ERROR",
        "deviceId no coincide con la sesión POS abierta",
      );
    }

    if (request.cajaId !== session.cajaId) {
      throw new PaymentApiError(
        409,
        "PAYMENT_VALIDATION_ERROR",
        "cajaId no coincide con la sesión POS abierta",
      );
    }

    if (request.sucursalId !== session.sucursalId) {
      throw new PaymentApiError(
        409,
        "PAYMENT_VALIDATION_ERROR",
        "sucursalId no coincide con la sesión POS abierta",
      );
    }

    if (request.vendedorUid !== session.vendedorUid) {
      throw new PaymentApiError(
        409,
        "PAYMENT_VALIDATION_ERROR",
        "vendedorUid no coincide con la sesión POS abierta",
      );
    }

    if (actor.rol === RolUsuario.EMPLEADO && request.vendedorUid !== actor.uid) {
      throw new PaymentApiError(
        403,
        "PAYMENT_FORBIDDEN",
        "No puedes crear intentos POS a nombre de otro vendedor",
      );
    }
  }

  private async requireExistingPosSale(
    ventaPosId: string,
    session: PosSession,
  ): Promise<VentaPos> {
    const sale = await this.posSaleRepo.getById(ventaPosId);
    if (!sale) {
      throw new PaymentApiError(
        404,
        "PAYMENT_POS_SALE_NOT_FOUND",
        `Venta POS ${ventaPosId} no encontrada`,
      );
    }

    if (sale.posSessionId !== session.id) {
      throw new PaymentApiError(
        409,
        "PAYMENT_VALIDATION_ERROR",
        "La venta POS no pertenece a la sesión de caja indicada",
      );
    }

    return sale;
  }

  private async createDraftPosSale(
    request: InStoreCreateRequest,
    session: PosSession,
  ): Promise<VentaPos> {
    if (!request.items || request.items.length === 0) {
      throw new PaymentApiError(
        400,
        "PAYMENT_VALIDATION_ERROR",
        "Se requieren items o ventaPosId para crear un intento in-store",
      );
    }

    const normalizedItems = await this.resolvePosItems(request.items);
    const subtotalMinor = normalizedItems.reduce(
      (acc, item) => acc + roundToMinor(item.subtotal),
      0,
    );
    const taxMinor = 0;
    const shippingMinor = 0;
    const totalMinor = subtotalMinor + taxMinor + shippingMinor;

    return this.posSaleRepo.create({
      posSessionId: session.id!,
      deviceId: session.deviceId,
      cajaId: session.cajaId,
      sucursalId: session.sucursalId,
      vendedorUid: session.vendedorUid,
      customerName: request.customer?.name,
      customerEmail: request.customer?.email,
      customerPhone: request.customer?.phone,
      currency: (request.currency || "mxn").toLowerCase(),
      subtotal: subtotalMinor / 100,
      tax: taxMinor / 100,
      shipping: shippingMinor / 100,
      total: totalMinor / 100,
      subtotalMinor,
      taxMinor,
      shippingMinor,
      totalMinor,
      status: EstadoVentaPos.BORRADOR,
      items: normalizedItems,
      metadata: request.metadata || {},
    });
  }

  private async resolvePosItems(items: PaymentItemInput[]): Promise<VentaPosItem[]> {
    const requestedByVariant = new Map<string, number>();
    const normalizedItems: VentaPosItem[] = [];

    for (const item of items) {
      const product = await productService.getProductById(item.productoId);
      if (!product || !product.activo) {
        throw new PaymentApiError(
          404,
          "PAYMENT_VALIDATION_ERROR",
          `Producto ${item.productoId} no encontrado o inactivo`,
        );
      }

      const stockContext = this.resolveProductStock(product, item);
      const variantKey = `${item.productoId}:${stockContext.tallaId || "_"}`;
      const requestedTotal =
        (requestedByVariant.get(variantKey) ?? 0) + item.cantidad;
      if (requestedTotal > stockContext.available) {
        throw new PaymentApiError(
          409,
          "PAYMENT_VALIDATION_ERROR",
          `Stock insuficiente para ${product.descripcion}`,
        );
      }
      requestedByVariant.set(variantKey, requestedTotal);

      normalizedItems.push({
        productoId: item.productoId,
        cantidad: item.cantidad,
        precioUnitario: product.precioPublico,
        subtotal: Number((product.precioPublico * item.cantidad).toFixed(2)),
        tallaId: stockContext.tallaId,
      });
    }

    return normalizedItems;
  }

  private resolveProductStock(
    product: Producto,
    item: PaymentItemInput,
  ): { available: number; tallaId?: string } {
    const normalizedTallaId = item.tallaId?.trim();
    if (!product.tallaIds.length) {
      if (normalizedTallaId) {
        throw new PaymentApiError(
          409,
          "PAYMENT_VALIDATION_ERROR",
          `El producto ${item.productoId} no maneja inventario por talla`,
        );
      }

      return {
        available: Math.max(0, Math.floor(Number(product.existencias || 0))),
      };
    }

    if (!normalizedTallaId) {
      throw new PaymentApiError(
        409,
        "PAYMENT_VALIDATION_ERROR",
        `Se requiere tallaId para ${product.descripcion}`,
      );
    }

    const variant = product.inventarioPorTalla.find(
      (entry) => entry.tallaId === normalizedTallaId,
    );

    return {
      available: Math.max(0, Math.floor(Number(variant?.cantidad || 0))),
      tallaId: normalizedTallaId,
    };
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
