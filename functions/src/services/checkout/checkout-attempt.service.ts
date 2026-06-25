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
import logger from "../../utils/logger";
import carritoService from "../carrito.service";
import checkoutAttemptRepository from "./checkout-attempt.repository";
import inventoryReservationService from "../inventory-reservation.service";
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
};

const ACTIVE_ATTEMPT_STATUSES = new Set<CheckoutAttemptStatus>([
  CheckoutAttemptStatus.CREATED,
  CheckoutAttemptStatus.PAYMENT_PENDING,
  CheckoutAttemptStatus.PROCESSING,
]);

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
        checkoutLogger.info("checkout_attempt_reuse_idempotency", {
          checkoutAttemptId: existingByKey.id,
          userId,
          cartId,
        });
        return this.rehydrateAttemptSession(existingByKey, false);
      }
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

    // 2) Reuso por usuario+carrito: solo si el carrito/pricing es idéntico.
    //    Un intento PAID/finalizado nunca se invalida ni recrea.
    const activeAttempt =
      await checkoutAttemptRepository.findActiveByUserAndCart(userId, cartId);
    if (activeAttempt) {
      const sameCart =
        this.resolveAttemptSignature(activeAttempt) === currentSignature;
      const canInvalidate = ACTIVE_ATTEMPT_STATUSES.has(activeAttempt.status);
      if (sameCart || !canInvalidate) {
        checkoutLogger.info("checkout_attempt_reuse_active", {
          checkoutAttemptId: activeAttempt.id,
          userId,
          cartId,
        });
        return this.rehydrateAttemptSession(activeAttempt, false);
      }
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

    try {
      await inventoryReservationService.reserveForCheckoutAttempt({
        checkoutAttemptId: attempt.id!,
        items: orderDraft.items.map((item) => ({
          productoId: item.productoId,
          tallaId: item.tallaId,
          cantidad: item.cantidad,
        })),
        usuarioId: userId,
        idempotencyPrefix: "checkout-attempt",
      });

      const successUrl = body.successUrl?.trim();
      const cancelUrl = body.cancelUrl?.trim();
      if (!successUrl || !cancelUrl) {
        throw new ApiError(400, "successUrl y cancelUrl son requeridos");
      }

      const resolvedSuccessUrl = successUrl.replace(
        "{CHECKOUT_ATTEMPT_ID}",
        attempt.id!,
      );

      const session = await pagoService.createStripeCheckoutSessionForAttempt({
        checkoutAttemptId: attempt.id!,
        userId,
        orderDraft,
        pricing,
        cartId,
        successUrl: resolvedSuccessUrl,
        cancelUrl,
        idempotencyKey,
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
        clientSecret: session.clientSecret,
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
      await this.releaseAttempt(attempt.id!, "Fallo al iniciar pago", {
        status: CheckoutAttemptStatus.FAILED,
        failureCode: "payment_start_failed",
        failureMessage:
          error instanceof Error ? error.message : "Error al iniciar pago",
      });
      throw error;
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

  private async rehydrateAttemptSession(
    attempt: Awaited<ReturnType<typeof checkoutAttemptRepository.getById>>,
    created: boolean,
  ): Promise<StartCheckoutAttemptResult> {
    if (!attempt?.id) {
      throw new ApiError(409, "Intento de checkout invalido");
    }

    if (!attempt.pagoId || !attempt.stripeCheckoutSessionId) {
      throw new ApiError(
        409,
        "El intento de checkout activo no tiene sesion de pago reutilizable",
      );
    }

    const session = await pagoService.getStripeCheckoutSessionForAttempt(
      attempt.stripeCheckoutSessionId,
      attempt.userId,
    );

    return {
      attemptId: attempt.id,
      status: attempt.status,
      clientSecret: session.clientSecret,
      sessionId: session.sessionId,
      pagoId: attempt.pagoId,
      total: attempt.total,
      currency: attempt.currency,
      created,
    };
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
      return attempt.orderId;
    }

    const lock = await checkoutAttemptRepository.tryFinalize(
      attempt.id!,
      input.eventId,
    );
    if (!lock.acquired && lock.attempt.orderId) {
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

  async expireStaleAttempts(): Promise<number> {
    const expiredIds = await checkoutAttemptRepository.findDueAttemptIds();
    for (const attemptId of expiredIds) {
      await this.releaseAttempt(attemptId, "Intento de checkout expirado", {
        status: CheckoutAttemptStatus.EXPIRED,
        failureCode: "attempt_expired",
        failureMessage: "El intento de checkout expiró",
      });
    }
    return expiredIds.length;
  }
}

const checkoutAttemptService = new CheckoutAttemptService();
export default checkoutAttemptService;
