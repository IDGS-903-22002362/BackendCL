// checkout attempt service
import { Timestamp } from "firebase-admin/firestore";
import {
  CheckoutAttempt,
  CheckoutAttemptStatus,
  StartCheckoutAttemptResult,
  TERMINAL_CHECKOUT_ATTEMPT_STATUSES,
} from "../../models/checkout-attempt.model";
import { CrearOrdenDTO, MetodoPago } from "../../models/orden.model";
import { CheckoutPricingSnapshot } from "../../models/checkout-pricing.model";
import { ApiError } from "../../utils/error-handler";
import { mapCheckoutErrorToApiError } from "../../utils/checkout-error.util";
import logger from "../../utils/logger";
import carritoService from "../carrito.service";
import checkoutAttemptRepository from "./checkout-attempt.repository";
import { CHECKOUT_STALE_PAYMENT_PENDING_MINUTES } from "../../config/inventory.config";
import inventoryReservationService, {
  InventoryStockUnavailableError,
} from "../inventory-reservation.service";
import ordenService from "../orden.service";
import pagoService from "../pago.service";
import paidOrderFinalizerService from "../paid-order-finalizer.service";
import pickupOrderService from "../pickup-order.service";

const checkoutLogger = logger.child({ component: "checkout-attempt-service" });

type CheckoutBody = {
  fulfillmentMethod?: string;
  direccionEnvio?: Record<string, unknown>;
  pickupLocationId?: string;
  pickupContact?: Record<string, unknown>;
  metodoPago?: string;
  codigoPromocion?: string;
  costoEnvio?: number;
  shippingQuoteId?: string;
  selectedShippingOptionId?: string;
  selectedServiceType?: string;
  shippingSelection?: Record<string, unknown>;
  notas?: string;
  successUrl?: string;
  cancelUrl?: string;
  retryPayment?: boolean;
};

const ACTIVE_ATTEMPT_STATUSES = new Set<CheckoutAttemptStatus>([
  CheckoutAttemptStatus.CREATED,
  CheckoutAttemptStatus.PAYMENT_PENDING,
  CheckoutAttemptStatus.PROCESSING,
]);

function mapCheckoutStartError(error: unknown): never {
  const mapped = mapCheckoutErrorToApiError(error);
  if (mapped) {
    throw mapped;
  }
  if (error instanceof ApiError) {
    throw error;
  }
  throw error;
}

function roundMoney(value: number): number {
  return Math.round((Number(value) || 0) * 100) / 100;
}

/**
 * Genera una firma comparable del carrito + pricing del intento.
 * Incluye items (producto/talla/cantidad/precio unitario), total, subtotal con
 * ofertas y con código, código aplicado, envío y método de fulfillment.
 * Si dos firmas difieren, el monto de Stripe debe recalcularse con una sesión
 * nueva (el amount de una Checkout Session es inmutable tras crearse).
 */
function computeCartSignature(
  orderDraft: Pick<CrearOrdenDTO, "items" | "fulfillmentMethod">,
  pricing: CheckoutPricingSnapshot,
): string {
  const items = [...(orderDraft.items ?? [])]
    .map((item) =>
      [
        item.productoId,
        item.tallaId ?? "",
        item.cantidad,
        roundMoney(item.precioUnitario),
      ].join(":"),
    )
    .sort()
    .join("|");

  return [
    `items=${items}`,
    `total=${roundMoney(pricing.total)}`,
    `subtotalFinal=${roundMoney(pricing.subtotalFinal)}`,
    `subtotalConCodigo=${roundMoney(
      pricing.subtotalConCodigo ?? pricing.subtotalFinal,
    )}`,
    `codigo=${pricing.codigoPromocion ?? ""}`,
    `envio=${roundMoney(pricing.shippingTotal)}`,
    `fulfillment=${orderDraft.fulfillmentMethod ?? ""}`,
  ].join("||");
}

export class CheckoutAttemptService {
  async startCheckout(
    userId: string,
    body: CheckoutBody,
    idempotencyKey: string,
  ): Promise<StartCheckoutAttemptResult> {
    if (!idempotencyKey || idempotencyKey.length < 8) {
      throw new ApiError(
        400,
        "Idempotency-Key debe tener entre 8 y 255 caracteres",
      );
    }

    const metodoPago =
      body.metodoPago === MetodoPago.APLAZO
        ? MetodoPago.APLAZO
        : MetodoPago.TARJETA;

    if (metodoPago !== MetodoPago.TARJETA) {
      throw new ApiError(
        400,
        "Este endpoint solo soporta pago con tarjeta (Stripe). Usa el flujo Aplazo existente.",
      );
    }

    // Recalculamos SIEMPRE el carrito/pricing actual (backend es la fuente de
    // verdad) antes de decidir si reutilizamos un intento previo. Sin esto, un
    // carrito modificado reutilizaría una sesión de Stripe con el monto viejo.
    const { cartId, orderDraft, pricing } =
      await carritoService.buildCheckoutOrderDraft(userId, {
        ...body,
        metodoPago,
      } as Parameters<typeof carritoService.buildCheckoutOrderDraft>[1]);

    const currentSignature = computeCartSignature(orderDraft, pricing);

    // 1) Reuso por Idempotency-Key: solo si el carrito/pricing es idéntico.
    //    Si el cliente reusa la misma key con un carrito distinto, gana el
    //    carrito nuevo: liberamos el intento viejo y creamos uno nuevo.
    const existingByKey =
      await checkoutAttemptRepository.findByIdempotencyKey(idempotencyKey);
    if (existingByKey && ACTIVE_ATTEMPT_STATUSES.has(existingByKey.status)) {
      if (this.resolveAttemptSignature(existingByKey) === currentSignature) {
        if (body.retryPayment) {
          return this.refreshPaymentSessionForRetry(existingByKey, {
            userId,
            cartId,
            orderDraft,
            pricing,
            body,
            idempotencyKey,
          });
        }
        const rehydrated = await this.tryRehydrateAttemptSession(
          existingByKey,
          false,
        );
        if (rehydrated) {
          checkoutLogger.info("checkout_attempt_reuse_idempotency", {
            checkoutAttemptId: existingByKey.id,
            userId,
            cartId,
          });
          return rehydrated;
        }
      } else {
        checkoutLogger.info("checkout_attempt_invalidate_idempotency", {
          checkoutAttemptId: existingByKey.id,
          userId,
          cartId,
        });
        await this.releaseAttempt(
          existingByKey.id!,
          "Carrito cambió; se recrea el intento de checkout",
          {
            status: CheckoutAttemptStatus.CANCELED,
            failureCode: "cart_changed",
            failureMessage:
              "El carrito cambió respecto al intento previo; se generó uno nuevo",
          },
        );
      }
    }

    // 2) Reuso por usuario+carrito: solo si el carrito/pricing es idéntico.
    //    Un intento PAID/finalizado nunca se invalida ni recrea.
    const activeAttempt =
      await checkoutAttemptRepository.findActiveByUserAndCart(userId, cartId);
    if (activeAttempt) {
      const sameCart =
        this.resolveAttemptSignature(activeAttempt) === currentSignature;
      const canInvalidate = ACTIVE_ATTEMPT_STATUSES.has(activeAttempt.status);
      if (sameCart || !canInvalidate) {
        if (body.retryPayment) {
          return this.refreshPaymentSessionForRetry(activeAttempt, {
            userId,
            cartId,
            orderDraft,
            pricing,
            body,
            idempotencyKey,
          });
        }
        const rehydrated = await this.tryRehydrateAttemptSession(
          activeAttempt,
          false,
        );
        if (rehydrated) {
          checkoutLogger.info("checkout_attempt_reuse_active", {
            checkoutAttemptId: activeAttempt.id,
            userId,
            cartId,
          });
          return rehydrated;
        }
      } else {
        checkoutLogger.info("checkout_attempt_invalidate_active", {
          checkoutAttemptId: activeAttempt.id,
          userId,
          cartId,
        });
        await this.releaseAttempt(
          activeAttempt.id!,
          "Carrito cambió; se recrea el intento de checkout",
          {
            status: CheckoutAttemptStatus.CANCELED,
            failureCode: "cart_changed",
            failureMessage:
              "El carrito cambió respecto al intento previo; se generó uno nuevo",
          },
        );
      }
    }

    const attempt = await checkoutAttemptRepository.create({
      userId,
      cartId,
      status: CheckoutAttemptStatus.CREATED,
      orderDraft,
      pricingSnapshot: pricing,
      total: pricing.total,
      currency: pricing.currency,
      metodoPago,
      fulfillmentMethod: orderDraft.fulfillmentMethod,
      idempotencyKey,
      cartSignature: currentSignature,
    });

    checkoutLogger.info("checkout_attempt_created", {
      checkoutAttemptId: attempt.id,
      userId,
      cartId,
      total: pricing.total,
    });

    return this.createPaymentSessionForAttempt({
      attempt,
      userId,
      cartId,
      orderDraft,
      pricing,
      body,
      idempotencyKey,
    });
  }

  private async refreshPaymentSessionForRetry(
    attempt: CheckoutAttempt,
    input: {
      userId: string;
      cartId: string;
      orderDraft: CrearOrdenDTO;
      pricing: CheckoutPricingSnapshot;
      body: CheckoutBody;
      idempotencyKey: string;
    },
  ): Promise<StartCheckoutAttemptResult> {
    if (!attempt.id) {
      throw new ApiError(409, "Intento de checkout inválido");
    }

    if (attempt.stripeCheckoutSessionId) {
      await pagoService.expireStripeCheckoutSessionIfOpen(
        attempt.stripeCheckoutSessionId,
      );
    }

    checkoutLogger.info("checkout_attempt_retry_payment", {
      checkoutAttemptId: attempt.id,
      userId: input.userId,
      cartId: input.cartId,
    });

    return this.createPaymentSessionForAttempt({
      attempt,
      ...input,
    });
  }

  private async createPaymentSessionForAttempt(input: {
    attempt: Awaited<ReturnType<typeof checkoutAttemptRepository.create>>;
    userId: string;
    cartId: string;
    orderDraft: CrearOrdenDTO;
    pricing: CheckoutPricingSnapshot;
    body: CheckoutBody;
    idempotencyKey: string;
  }): Promise<StartCheckoutAttemptResult> {
    const { attempt, userId, cartId, orderDraft, pricing, body, idempotencyKey } =
      input;

    try {
      const reservas = await inventoryReservationService.reserveForCheckoutAttempt({
        checkoutAttemptId: attempt.id!,
        items: orderDraft.items.map((item) => ({
          productoId: item.productoId,
          tallaId: item.tallaId,
          cantidad: item.cantidad,
        })),
        usuarioId: userId,
        idempotencyPrefix: "checkout-attempt",
      });

      const reservationId =
        reservas.find((reserva) => reserva.id)?.id ??
        reservas[0]?.id ??
        "";

      const successUrl = body.successUrl?.trim();
      const cancelUrl = body.cancelUrl?.trim();
      if (!successUrl || !cancelUrl) {
        throw new ApiError(400, "successUrl y cancelUrl son requeridos");
      }

      const resolvedSuccessUrl = successUrl.replace(
        "{CHECKOUT_ATTEMPT_ID}",
        attempt.id!,
      );

      const stripeIdempotencyKey = body.retryPayment
        ? `${idempotencyKey}:retry:${Date.now()}`
        : idempotencyKey;

      const session = await pagoService.createStripeCheckoutSessionForAttempt({
        checkoutAttemptId: attempt.id!,
        userId,
        orderDraft,
        pricing,
        cartId,
        successUrl: resolvedSuccessUrl,
        cancelUrl,
        idempotencyKey: stripeIdempotencyKey,
        reservationId,
        paymentAttemptId: attempt.id!,
      });

      await checkoutAttemptRepository.update(attempt.id!, {
        status: CheckoutAttemptStatus.PAYMENT_PENDING,
        pagoId: session.pagoId,
        stripeCheckoutSessionId: session.sessionId,
      });

      checkoutLogger.info("checkout_attempt_payment_pending", {
        checkoutAttemptId: attempt.id,
        pagoId: session.pagoId,
        stripeSessionId: session.sessionId,
      });

      return {
        attemptId: attempt.id!,
        status: CheckoutAttemptStatus.PAYMENT_PENDING,
        url: session.url,
        sessionId: session.sessionId,
        pagoId: session.pagoId,
        total: pricing.total,
        currency: pricing.currency,
        created: session.created,
      };
    } catch (error) {
      checkoutLogger.error("checkout_attempt_start_failed", {
        checkoutAttemptId: attempt.id,
        userId,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      const isStockConflict =
        error instanceof InventoryStockUnavailableError ||
        (error instanceof Error && /Stock insuficiente/i.test(error.message));
      if (!isStockConflict) {
        await this.releaseAttempt(attempt.id!, "Fallo al iniciar pago", {
          status: CheckoutAttemptStatus.FAILED,
          failureCode: "payment_start_failed",
          failureMessage:
            error instanceof Error ? error.message : "Error al iniciar pago",
        });
      }
      mapCheckoutStartError(error);
    }
  }

  /**
   * Obtiene la firma del carrito guardada en el intento. Para documentos
   * legacy sin `cartSignature`, la deriva del snapshot persistido para
   * mantener compatibilidad.
   */
  private resolveAttemptSignature(attempt: CheckoutAttempt): string {
    if (attempt.cartSignature) {
      return attempt.cartSignature;
    }
    return computeCartSignature(attempt.orderDraft, attempt.pricingSnapshot);
  }

  private async tryRehydrateAttemptSession(
    attempt: Awaited<ReturnType<typeof checkoutAttemptRepository.getById>>,
    created: boolean,
  ): Promise<StartCheckoutAttemptResult | null> {
    if (!attempt?.id || !attempt.pagoId || !attempt.stripeCheckoutSessionId) {
      return null;
    }

    try {
      const session = await pagoService.getStripeCheckoutSessionForAttempt(
        attempt.stripeCheckoutSessionId,
        attempt.userId,
      );

      if (session.status !== "open" || !session.url) {
        throw new ApiError(
          409,
          "La sesión de pago ya no está disponible para reutilizar",
        );
      }

      return {
        attemptId: attempt.id,
        status: attempt.status,
        url: session.url,
        sessionId: session.sessionId,
        pagoId: attempt.pagoId,
        total: attempt.total,
        currency: attempt.currency,
        created,
      };
    } catch (error) {
      checkoutLogger.warn("checkout_attempt_rehydrate_failed", {
        checkoutAttemptId: attempt.id,
        stripeSessionId: attempt.stripeCheckoutSessionId,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      await this.releaseAttempt(
        attempt.id,
        "Sesión Stripe no reutilizable; se crea un intento nuevo",
        {
          status: CheckoutAttemptStatus.EXPIRED,
          failureCode: "checkout_session_not_reusable",
          failureMessage:
            "La sesión de pago expiró o ya no está disponible",
        },
      );
      return null;
    }
  }

  async getStatusForUser(
    attemptId: string,
    userId: string,
  ): Promise<{
    attemptId: string;
    status: CheckoutAttemptStatus;
    orderId?: string;
    pagoId?: string;
    total: number;
    currency: string;
    paymentStatus?: string;
  }> {
    const attempt = await checkoutAttemptRepository.getById(attemptId);
    if (!attempt) {
      throw new ApiError(404, "Intento de checkout no encontrado");
    }
    if (attempt.userId !== userId) {
      throw new ApiError(403, "No tienes permisos para consultar este intento");
    }

    let paymentStatus: string | undefined;
    if (attempt.pagoId) {
      const payment = await pagoService.getPaymentStatusSummary(attempt.pagoId);
      paymentStatus = payment?.status;
    }

    return {
      attemptId: attempt.id!,
      status: attempt.status,
      orderId: attempt.orderId,
      pagoId: attempt.pagoId,
      total: attempt.total,
      currency: attempt.currency,
      paymentStatus,
    };
  }

  async finalizePaidFromWebhook(input: {
    checkoutAttemptId: string;
    pagoId: string;
    eventId: string;
  }): Promise<string> {
    const attempt = await checkoutAttemptRepository.getById(
      input.checkoutAttemptId,
    );
    if (!attempt) {
      throw new ApiError(404, "CheckoutAttempt no encontrado al finalizar pago");
    }

    if (attempt.orderId && attempt.status === CheckoutAttemptStatus.FINALIZED) {
      await paidOrderFinalizerService.applyPaidOrderStatePatch(attempt.orderId);
      return attempt.orderId;
    }

    const lock = await checkoutAttemptRepository.tryFinalize(
      attempt.id!,
      input.eventId,
    );
    if (!lock.acquired && lock.attempt.orderId) {
      await paidOrderFinalizerService.applyPaidOrderStatePatch(
        lock.attempt.orderId,
      );
      return lock.attempt.orderId;
    }

    const hasAttemptReservations =
      await inventoryReservationService.checkoutAttemptHasActiveReservations(
        attempt.id!,
      );

    const orden = await ordenService.createOrden(attempt.orderDraft, {
      skipStockRevalidation: hasAttemptReservations,
    });
    await inventoryReservationService.migrateReservationsToOrder(
      attempt.id!,
      orden.id!,
    );

    await pagoService.linkPaymentToOrder(input.pagoId, orden.id!);

    await checkoutAttemptRepository.update(attempt.id!, {
      status: CheckoutAttemptStatus.FINALIZED,
      orderId: orden.id,
      finalizedAt: Timestamp.now(),
    });

    checkoutLogger.info("checkout_attempt_finalized", {
      checkoutAttemptId: attempt.id,
      orderId: orden.id,
      pagoId: input.pagoId,
      stripeEventId: input.eventId,
    });

    await pickupOrderService.finalizePaidPickupOrder({
      orderId: orden.id!,
      source: "stripe",
      sourceEventId: input.eventId,
      paymentAttemptId: input.pagoId,
    });
    await paidOrderFinalizerService.finalizePaidOrder({
      orderId: orden.id!,
      provider: "stripe",
      sourceEventId: input.eventId,
      paymentAttemptId: input.pagoId,
      paymentConfirmed: true,
    });

    return orden.id!;
  }

  async abandonAttemptForUser(
    attemptId: string,
    userId: string,
  ): Promise<{
    attemptId: string;
    status: CheckoutAttemptStatus;
    orderId?: string;
    alreadyAbandoned?: boolean;
  }> {
    const attempt = await checkoutAttemptRepository.getById(attemptId);
    if (!attempt) {
      throw new ApiError(404, "Intento de checkout no encontrado");
    }
    if (attempt.userId !== userId) {
      throw new ApiError(
        403,
        "No tienes permisos para abandonar este intento",
      );
    }

    checkoutLogger.info("checkout_attempt_abandon_started", {
      checkoutAttemptId: attemptId,
      userId,
      priorStatus: attempt.status,
    });

    if (
      attempt.status === CheckoutAttemptStatus.FINALIZED ||
      attempt.status === CheckoutAttemptStatus.PAID ||
      attempt.status === CheckoutAttemptStatus.PROCESSING ||
      attempt.orderId
    ) {
      return {
        attemptId,
        status: attempt.status,
        orderId: attempt.orderId,
      };
    }

    const reconciliation = await this.reconcileStripeBeforeRelease(attemptId);
    if (reconciliation.action === "finalized") {
      checkoutLogger.info("checkout_attempt_abandon_finalized_paid", {
        checkoutAttemptId: attemptId,
        orderId: reconciliation.orderId,
      });
      return {
        attemptId,
        status: CheckoutAttemptStatus.FINALIZED,
        orderId: reconciliation.orderId,
      };
    }

    const hasActiveReservations =
      await inventoryReservationService.checkoutAttemptHasActiveReservations(
        attemptId,
      );

    if (
      TERMINAL_CHECKOUT_ATTEMPT_STATUSES.has(attempt.status) &&
      !hasActiveReservations
    ) {
      return {
        attemptId,
        status: attempt.status,
        alreadyAbandoned: true,
      };
    }

    await this.releaseAttempt(
      attemptId,
      "Checkout abandonado al cancelar pago en Stripe",
      {
        status: CheckoutAttemptStatus.CANCELED,
        failureCode: "payment_abandoned",
        failureMessage:
          "El usuario volvió desde Stripe sin completar el pago",
      },
    );

    checkoutLogger.info("checkout_attempt_abandoned", {
      checkoutAttemptId: attemptId,
      userId,
    });

    return {
      attemptId,
      status: CheckoutAttemptStatus.CANCELED,
    };
  }

  async cancelAttemptForUser(
    attemptId: string,
    userId: string,
  ): Promise<{ attemptId: string; status: CheckoutAttemptStatus }> {
    const attempt = await checkoutAttemptRepository.getById(attemptId);
    if (!attempt) {
      throw new ApiError(404, "Intento de checkout no encontrado");
    }
    if (attempt.userId !== userId) {
      throw new ApiError(403, "No tienes permisos para cancelar este intento");
    }
    if (attempt.status === CheckoutAttemptStatus.FINALIZED) {
      throw new ApiError(
        409,
        "El intento de checkout ya fue finalizado con una orden pagada",
      );
    }
    if (attempt.orderId) {
      throw new ApiError(
        409,
        "El intento de checkout ya tiene un pedido asociado",
      );
    }

    if (attempt.stripeCheckoutSessionId) {
      await pagoService
        .expireStripeCheckoutSessionIfOpen(attempt.stripeCheckoutSessionId)
        .catch((error) => {
          checkoutLogger.warn("checkout_attempt_stripe_expire_failed", {
            checkoutAttemptId: attemptId,
            stripeSessionId: attempt.stripeCheckoutSessionId,
            errorMessage:
              error instanceof Error ? error.message : String(error),
          });
        });
    }

    await this.releaseAttempt(attemptId, "Cancelado por el usuario", {
      status: CheckoutAttemptStatus.CANCELED,
      failureCode: "user_canceled",
      failureMessage: "El usuario canceló el intento de checkout",
    });

    return {
      attemptId,
      status: CheckoutAttemptStatus.CANCELED,
    };
  }

  async releaseAttempt(
    checkoutAttemptId: string,
    motivo: string,
    patch?: {
      status?: CheckoutAttemptStatus;
      failureCode?: string;
      failureMessage?: string;
    },
  ): Promise<void> {
    const attempt = await checkoutAttemptRepository.getById(checkoutAttemptId);
    if (!attempt) {
      return;
    }

    if (attempt.status === CheckoutAttemptStatus.FINALIZED) {
      return;
    }

    const hasActiveReservations =
      await inventoryReservationService.checkoutAttemptHasActiveReservations(
        checkoutAttemptId,
      );

    if (TERMINAL_CHECKOUT_ATTEMPT_STATUSES.has(attempt.status)) {
      if (!hasActiveReservations) {
        return;
      }
      await inventoryReservationService.releaseCheckoutAttemptReservations({
        checkoutAttemptId,
        motivo: `${motivo} (reparación de reservas huérfanas)`,
        usuarioId: attempt.userId,
      });
      checkoutLogger.info("checkout_attempt_orphan_reservations_released", {
        checkoutAttemptId,
        motivo,
        priorStatus: attempt.status,
      });
      return;
    }

    await inventoryReservationService.releaseCheckoutAttemptReservations({
      checkoutAttemptId,
      motivo,
      usuarioId: attempt.userId,
    });

    await checkoutAttemptRepository.update(checkoutAttemptId, {
      status: patch?.status ?? CheckoutAttemptStatus.CANCELED,
      failureCode: patch?.failureCode,
      failureMessage: patch?.failureMessage,
    });

    checkoutLogger.info("checkout_attempt_released", {
      checkoutAttemptId,
      motivo,
      status: patch?.status ?? CheckoutAttemptStatus.CANCELED,
    });
  }

  /**
   * Consulta Stripe antes de liberar reservas vencidas o abandonadas.
   * Si el pago ya quedó confirmado, finaliza la orden sin liberar stock.
   */
  async reconcileStripeBeforeRelease(attemptId: string): Promise<{
    action: "finalized" | "expired_session" | "release";
    orderId?: string;
  }> {
    const attempt = await checkoutAttemptRepository.getById(attemptId);
    if (!attempt) {
      return { action: "release" };
    }

    if (
      attempt.status === CheckoutAttemptStatus.FINALIZED ||
      attempt.orderId
    ) {
      if (attempt.orderId) {
        await paidOrderFinalizerService.applyPaidOrderStatePatch(attempt.orderId);
      }
      return { action: "finalized", orderId: attempt.orderId };
    }

    if (!attempt.stripeCheckoutSessionId || !attempt.pagoId) {
      return { action: "release" };
    }

    try {
      const session = await pagoService.getStripeCheckoutSessionForAttempt(
        attempt.stripeCheckoutSessionId,
        attempt.userId,
      );

      if (
        session.paymentStatus === "paid" ||
        session.status === "complete"
      ) {
        const eventId = `reconcile:${attemptId}`;
        const orderId = await this.finalizePaidFromWebhook({
          checkoutAttemptId: attemptId,
          pagoId: attempt.pagoId,
          eventId,
        });
        await pagoService.completeCheckoutAttemptPayment({
          pagoId: attempt.pagoId,
          checkoutSessionId: attempt.stripeCheckoutSessionId,
          eventId,
        });
        return { action: "finalized", orderId };
      }

      if (session.status === "open" && session.paymentStatus !== "paid") {
        await pagoService.expireStripeCheckoutSessionIfOpen(
          attempt.stripeCheckoutSessionId,
        );
        return { action: "expired_session" };
      }
    } catch (error) {
      checkoutLogger.warn("checkout_attempt_stripe_reconcile_failed", {
        checkoutAttemptId: attemptId,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
    }

    return { action: "release" };
  }

  async reconcilePendingAttemptsForUser(userId: string): Promise<{
    reconciled: number;
    finalized: string[];
    released: string[];
  }> {
    const attempts =
      await checkoutAttemptRepository.findPaymentPendingByUser(userId);
    const finalized: string[] = [];
    const released: string[] = [];

    for (const attempt of attempts) {
      if (!attempt.id) {
        continue;
      }

      const reconciliation = await this.reconcileStripeBeforeRelease(attempt.id);
      if (reconciliation.action === "finalized") {
        finalized.push(attempt.id);
        continue;
      }

      const hasActiveReservations =
        await inventoryReservationService.checkoutAttemptHasActiveReservations(
          attempt.id,
        );
      if (!hasActiveReservations) {
        continue;
      }

      await this.releaseAttempt(attempt.id, "Reconciliación de intento pendiente", {
        status: CheckoutAttemptStatus.CANCELED,
        failureCode: "pending_reconciled",
        failureMessage:
          "Intento de pago pendiente reconciliado al volver al sitio",
      });
      released.push(attempt.id);
    }

    checkoutLogger.info("checkout_pending_attempts_reconciled", {
      userId,
      finalizedCount: finalized.length,
      releasedCount: released.length,
    });

    return {
      reconciled: finalized.length + released.length,
      finalized,
      released,
    };
  }

  async reconcileStalePaymentPendingAttempts(limit = 50): Promise<number> {
    const staleIds =
      await checkoutAttemptRepository.findStalePaymentPendingIds(
        CHECKOUT_STALE_PAYMENT_PENDING_MINUTES,
        limit,
      );
    let processed = 0;

    for (const attemptId of staleIds) {
      const reconciliation = await this.reconcileStripeBeforeRelease(attemptId);
      if (reconciliation.action === "finalized") {
        processed += 1;
        continue;
      }

      const hasActiveReservations =
        await inventoryReservationService.checkoutAttemptHasActiveReservations(
          attemptId,
        );
      if (!hasActiveReservations) {
        continue;
      }

      await this.releaseAttempt(
        attemptId,
        "Intento payment_pending obsoleto reconciliado por cron",
        {
          status: CheckoutAttemptStatus.EXPIRED,
          failureCode: "stale_payment_pending",
          failureMessage:
            "El intento de pago quedó inactivo y la reserva fue liberada",
        },
      );
      processed += 1;
    }

    if (processed > 0) {
      checkoutLogger.info("checkout_stale_payment_pending_reconciled", {
        count: processed,
        staleMinutes: CHECKOUT_STALE_PAYMENT_PENDING_MINUTES,
      });
    }

    return processed;
  }

  async adminReconcileStripePayment(input: {
    sessionId?: string;
    checkoutAttemptId?: string;
    requestedByUid: string;
  }): Promise<{
    action:
      | "finalized"
      | "repaired"
      | "already_ok"
      | "not_paid"
      | "pending";
    checkoutAttemptId?: string;
    orderId?: string;
    stripePaymentStatus?: string;
  }> {
    if (!input.sessionId?.trim() && !input.checkoutAttemptId?.trim()) {
      throw new ApiError(400, "Indica sessionId o checkoutAttemptId");
    }

    let attempt: Awaited<
      ReturnType<typeof checkoutAttemptRepository.getById>
    > = null;

    if (input.checkoutAttemptId?.trim()) {
      attempt = await checkoutAttemptRepository.getById(
        input.checkoutAttemptId.trim(),
      );
    } else if (input.sessionId?.trim()) {
      attempt = await checkoutAttemptRepository.findByStripeCheckoutSessionId(
        input.sessionId.trim(),
      );
    }

    if (!attempt?.id) {
      throw new ApiError(404, "Intento de checkout no encontrado");
    }

    const sessionId =
      attempt.stripeCheckoutSessionId || input.sessionId?.trim() || "";
    if (!sessionId) {
      throw new ApiError(409, "El intento no tiene sesión de Stripe asociada");
    }
    if (!attempt.pagoId) {
      throw new ApiError(409, "El intento no tiene pago asociado");
    }

    const stripeSession =
      await pagoService.retrieveStripeCheckoutSessionPaymentStatus(sessionId);

    if (
      stripeSession.paymentStatus !== "paid" &&
      stripeSession.status !== "complete"
    ) {
      return {
        action: "not_paid",
        checkoutAttemptId: attempt.id,
        orderId: attempt.orderId,
        stripePaymentStatus: stripeSession.paymentStatus,
      };
    }

    const eventId = `admin_reconcile:${attempt.id}:${input.requestedByUid}`;

    if (
      attempt.status === CheckoutAttemptStatus.FINALIZED &&
      attempt.orderId
    ) {
      const repaired = await paidOrderFinalizerService.applyPaidOrderStatePatch(
        attempt.orderId,
      );
      await pagoService.completeCheckoutAttemptPayment({
        pagoId: attempt.pagoId,
        checkoutSessionId: sessionId,
        paymentIntentId: stripeSession.paymentIntentId,
        eventId,
      });
      return {
        action: repaired ? "repaired" : "already_ok",
        checkoutAttemptId: attempt.id,
        orderId: attempt.orderId,
        stripePaymentStatus: stripeSession.paymentStatus,
      };
    }

    const orderId = await this.finalizePaidFromWebhook({
      checkoutAttemptId: attempt.id,
      pagoId: attempt.pagoId,
      eventId,
    });

    await pagoService.completeCheckoutAttemptPayment({
      pagoId: attempt.pagoId,
      checkoutSessionId: sessionId,
      paymentIntentId: stripeSession.paymentIntentId,
      eventId,
    });

    checkoutLogger.info("checkout_attempt_admin_reconciled", {
      checkoutAttemptId: attempt.id,
      orderId,
      sessionId,
      requestedByUid: input.requestedByUid,
    });

    return {
      action: "finalized",
      checkoutAttemptId: attempt.id,
      orderId,
      stripePaymentStatus: stripeSession.paymentStatus,
    };
  }

  async expireStaleAttempts(): Promise<number> {
    const expiredIds = await checkoutAttemptRepository.findDueAttemptIds();
    let released = 0;
    for (const attemptId of expiredIds) {
      const reconciliation =
        await this.reconcileStripeBeforeRelease(attemptId);
      if (reconciliation.action === "finalized") {
        continue;
      }

      await this.releaseAttempt(attemptId, "Intento de checkout expirado", {
        status: CheckoutAttemptStatus.EXPIRED,
        failureCode: "attempt_expired",
        failureMessage: "El intento de checkout expiró",
      });
      released += 1;
    }
    return released;
  }
}

const checkoutAttemptService = new CheckoutAttemptService();
export default checkoutAttemptService;
