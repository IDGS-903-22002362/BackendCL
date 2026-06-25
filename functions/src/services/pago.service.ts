import Stripe from "stripe";
import { firestoreTienda } from "../config/firebase";
import { admin } from "../config/firebase.admin";
import { firestoreApp } from "../config/app.firebase";
import {
  EstadoOrden,
  FulfillmentMethod,
  FulfillmentStatus,
  MetodoPago,
  Orden,
  PaymentState,
  PreparationStatus,
  CrearOrdenDTO,
} from "../models/orden.model";
import {
  COLECCION_PAGOS,
  EstadoPago,
  Pago,
  PaymentStatus,
  PaymentPricingSnapshot,
  ProveedorPago,
} from "../models/pago.model";
import { RolUsuario } from "../models/usuario.model";
import { ApiError } from "../utils/error-handler";
import {
  buildEmbeddedCheckoutSessionBaseParams,
  buildStripeIdempotencyKey,
  buildStripePaymentIntentCardOptions,
  getAppUrl,
  getStripeClient,
  getStripeCurrency,
  getStripeMinimumAmountMinor,
  getStripePublishableKey,
  getStripeWebhookSecret,
  isStripeMissingResourceError,
} from "../lib/stripe";
import pickupOrderService from "./pickup-order.service";
import paidOrderFinalizerService from "./paid-order-finalizer.service";
import ordenService from "./orden.service";
import inventoryReservationService from "./inventory-reservation.service";
import {
  shippingRefundGuardService,
  ShippingRefundGuardError,
} from "./shipping-refund-guard.service";
import {
  MANUAL_FEDEX_METHOD,
  MANUAL_FEDEX_PROVIDER,
  MANUAL_FEDEX_STATUS,
} from "../config/manual-shipping.config";
import { CheckoutPricingSnapshot } from "../models/checkout-pricing.model";

const ORDENES_COLLECTION = "ordenes";
const USERS_APP_COLLECTION = "usuariosApp";
const SHIPPING_EVENTS_COLLECTION = "shipping_events";
const STRIPE_WEBHOOK_EVENTS_COLLECTION = "stripe_webhook_events";
const STRIPE_PAYMENT_START_LOCKS_COLLECTION = "stripe_payment_start_locks";

type IniciarPagoInput = {
  ordenId: string;
  userId: string;
  metodoPago: MetodoPago;
  idempotencyKey?: string;
};

type IniciarPagoResult = {
  pagoId: string;
  paymentIntentId: string;
  clientSecret: string;
  status: EstadoPago;
  created: boolean;
  stripeCustomerId?: string;
};

type ProcesarReembolsoInput = {
  pagoId: string;
  refundAmount?: number;
  refundReason?: string;
  requestedByUid: string;
};

type ProcesarReembolsoResult = {
  pagoId: string;
  ordenId: string;
  estadoPago: EstadoPago;
  estadoOrden: EstadoOrden;
  refundId: string;
  refundAmount: number;
  refundReason?: string;
};

type ShippingInput = {
  name: string;
  phone?: string;
  address: {
    line1: string;
    line2?: string;
    city?: string;
    state?: string;
    postal_code?: string;
    country?: string;
  };
};

export type CreateStripePaymentIntentInput = {
  orderId: string;
  userId: string;
  currency?: string;
  customerId?: string;
  savePaymentMethod?: boolean;
  shipping?: ShippingInput;
  idempotencyKey?: string;
};

export type CreateStripePaymentIntentResult = {
  clientSecret: string;
  paymentIntentId: string;
  pagoId: string;
  status: EstadoPago;
  stripeCustomerId?: string;
  created: boolean;
};

export type CreateStripeCheckoutSessionForAttemptInput = {
  checkoutAttemptId: string;
  userId: string;
  cartId: string;
  orderDraft: CrearOrdenDTO;
  pricing: CheckoutPricingSnapshot;
  successUrl: string;
  cancelUrl: string;
  idempotencyKey: string;
};

export type CreateStripeCheckoutSessionInput = {
  orderId: string;
  userId: string;
  successUrl?: string;
  cancelUrl?: string;
  idempotencyKey?: string;
};

export type CreateStripeCheckoutSessionResult = {
  sessionId: string;
  clientSecret: string;
  url?: string | null;
  pagoId: string;
  stripeCustomerId?: string;
  created: boolean;
};

export type CreateStripeSetupIntentInput = {
  userId: string;
  customerId?: string;
};

export type CreateStripeSetupIntentResult = {
  setupIntentId: string;
  clientSecret: string;
  stripeCustomerId?: string;
};

export type CreateStripeBillingPortalInput = {
  userId: string;
  returnUrl?: string;
};

export type CreateStripeBillingPortalResult = {
  url: string;
  stripeCustomerId?: string;
};

export type CreateStripeRefundByOrderInput = {
  orderId: string;
  reason?: string;
  requestedByUid: string;
};

export type StripeWebhookOutcome =
  | "processed"
  | "duplicate"
  | "unmatched"
  | "ignored";

export type StripeWebhookProcessResult = {
  outcome: StripeWebhookOutcome;
  eventId: string;
  eventType: string;
  pagoId?: string;
  ordenId?: string;
  reason?: string;
};

type AuthUser = {
  uid: string;
  rol?: string;
};

type PagoConsultaResult = {
  id: string;
  estado: EstadoPago;
  monto: number;
  currency: string;
  metodoPago: MetodoPago;
  provider: ProveedorPago;
  paymentIntentId?: string;
  checkoutSessionId?: string;
  stripeCustomerId?: string;
  fechaPago?: FirebaseFirestore.Timestamp;
  failureCode?: string;
  failureMessage?: string;
  orden: {
    id: string;
    estado: EstadoOrden;
    total: number;
  };
};

const mapPaymentIntentStatusToEstadoPago = (
  status: Stripe.PaymentIntent.Status,
): EstadoPago => {
  switch (status) {
    case "requires_action":
      return EstadoPago.REQUIERE_ACCION;
    case "processing":
      return EstadoPago.PROCESANDO;
    case "succeeded":
      return EstadoPago.COMPLETADO;
    case "canceled":
      return EstadoPago.FALLIDO;
    default:
      return EstadoPago.PENDIENTE;
  }
};

const isEstadoReutilizable = (estado: EstadoPago): boolean => {
  return (
    estado === EstadoPago.PENDIENTE ||
    estado === EstadoPago.PROCESANDO ||
    estado === EstadoPago.REQUIERE_ACCION
  );
};

const parseWebhookErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }

  return "Error desconocido";
};

const isAlreadyExistsError = (error: unknown): boolean => {
  const firestoreError = error as { code?: unknown; message?: unknown };
  const code = String(firestoreError?.code ?? "").toLowerCase();
  const message = String(firestoreError?.message ?? "").toLowerCase();

  return (
    code === "6" ||
    code === "already-exists" ||
    message.includes("already exists")
  );
};

const getMetadataString = (
  metadata: Stripe.Metadata | null | undefined,
  key: string,
): string | undefined => {
  const value = metadata?.[key];
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
};

const isAdminOrEmpleado = (rol?: string): boolean => {
  return rol === RolUsuario.ADMIN || rol === RolUsuario.EMPLEADO;
};

const ESTADOS_PAGO_ACTIVOS: EstadoPago[] = [
  EstadoPago.PENDIENTE,
  EstadoPago.PROCESANDO,
  EstadoPago.REQUIERE_ACCION,
];

const wait = (ms: number): Promise<void> => {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
};

class PagoService {
  private async enqueueOrderConfirmedNotification(
    ordenId: string,
    userId: string,
    sourceData: Record<string, unknown>,
  ): Promise<void> {
    try {
      const { default: notificationEventService } = await import(
        "./notifications/notification-event.service"
      );
      await notificationEventService.enqueueEvent({
        eventType: "order_confirmed",
        userId,
        orderId: ordenId,
        sourceData,
        triggerSource: "stripe_webhook",
      });
    } catch (error) {
      console.warn("notification_order_confirmed_enqueue_failed", {
        ordenId,
        userId,
        reason: parseWebhookErrorMessage(error),
      });
    }
  }

  getSupportedPaymentMethods(): Array<{
    code: MetodoPago;
    label: string;
    availableOnline: boolean;
  }> {
    return [
      {
        code: MetodoPago.TARJETA,
        label: "Tarjeta",
        availableOnline: true,
      },
      {
        code: MetodoPago.TRANSFERENCIA,
        label: "Transferencia",
        availableOnline: false,
      },
      {
        code: MetodoPago.EFECTIVO,
        label: "Efectivo",
        availableOnline: false,
      },
      {
        code: MetodoPago.PAYPAL,
        label: "PayPal",
        availableOnline: false,
      },
      {
        code: MetodoPago.MERCADOPAGO,
        label: "Mercado Pago",
        availableOnline: false,
      },
    ];
  }

  private getStartPaymentLockRef(
    ordenId: string,
    userId: string,
  ): FirebaseFirestore.DocumentReference {
    const lockId = `${ordenId}_${userId}`;
    return firestoreTienda
      .collection(STRIPE_PAYMENT_START_LOCKS_COLLECTION)
      .doc(lockId);
  }

  private async withStartPaymentLock<T>(
    ordenId: string,
    userId: string,
    operation: () => Promise<T>,
    onLockContention?: () => Promise<T | undefined>,
  ): Promise<T> {
    const lockRef = this.getStartPaymentLockRef(ordenId, userId);
    const now = admin.firestore.Timestamp.now();

    try {
      await lockRef.create({
        ordenId,
        userId,
        status: "acquired",
        createdAt: now,
        updatedAt: now,
      });
    } catch (error) {
      if (!isAlreadyExistsError(error)) {
        throw error;
      }

      if (onLockContention) {
        const fallbackResult = await onLockContention();
        if (fallbackResult !== undefined) {
          return fallbackResult;
        }
      }

      throw new ApiError(
        409,
        "Ya existe un inicio de pago en curso para esta orden. Reintenta en unos segundos",
      );
    }

    try {
      return await operation();
    } finally {
      try {
        await lockRef.delete();
      } catch (error) {
        console.warn("payment_start_lock_release_failed", {
          ordenId,
          userId,
          reason: parseWebhookErrorMessage(error),
        });
      }
    }
  }

  private async findLatestActivePagoDoc(
    ordenId: string,
    userId: string,
  ): Promise<FirebaseFirestore.QueryDocumentSnapshot | null> {
    const pagoActivoSnapshot = await firestoreTienda
      .collection(COLECCION_PAGOS)
      .where("ordenId", "==", ordenId)
      .where("userId", "==", userId)
      .where("estado", "in", ESTADOS_PAGO_ACTIVOS)
      .orderBy("createdAt", "desc")
      .limit(1)
      .get();

    if (pagoActivoSnapshot.empty) {
      return null;
    }

    return pagoActivoSnapshot.docs[0];
  }

  private async buildReusedPaymentResult(
    stripe: Stripe,
    pagoDoc: FirebaseFirestore.QueryDocumentSnapshot,
    context: {
      ordenId: string;
      userId: string;
      reason: string;
    },
  ): Promise<IniciarPagoResult> {
    const pago = pagoDoc.data() as Pago;

    if (!pago.paymentIntentId) {
      throw new ApiError(
        409,
        "Existe un pago activo inconsistente para esta orden. Revisa el estado antes de reintentar",
      );
    }

    try {
      const paymentIntent = await stripe.paymentIntents.retrieve(
        pago.paymentIntentId,
      );

      if (!paymentIntent.client_secret) {
        throw new ApiError(
          502,
          "No fue posible recuperar el client secret del intento activo",
        );
      }

      return {
        pagoId: pagoDoc.id,
        paymentIntentId: paymentIntent.id,
        clientSecret: paymentIntent.client_secret,
        status: mapPaymentIntentStatusToEstadoPago(paymentIntent.status),
        created: false,
        stripeCustomerId: pago.stripeCustomerId,
      };
    } catch (error) {
      console.error("Error al recuperar pago reutilizable", {
        ordenId: context.ordenId,
        userId: context.userId,
        pagoId: pagoDoc.id,
        paymentIntentId: pago.paymentIntentId,
        reason: context.reason,
        error: parseWebhookErrorMessage(error),
      });
      throw new ApiError(
        502,
        "No fue posible reutilizar el intento activo de pago",
      );
    }
  }

  private async waitForReusableActivePayment(
    stripe: Stripe,
    ordenId: string,
    userId: string,
  ): Promise<IniciarPagoResult | undefined> {
    for (let attempt = 1; attempt <= 4; attempt++) {
      await wait(75 * attempt);
      const activePagoDoc = await this.findLatestActivePagoDoc(ordenId, userId);
      if (activePagoDoc) {
        const activePago = activePagoDoc.data() as Pago;
        if (!activePago.paymentIntentId) {
          continue;
        }

        return this.buildReusedPaymentResult(stripe, activePagoDoc, {
          ordenId,
          userId,
          reason: "lock_contention_wait",
        });
      }
    }

    return undefined;
  }

  private resolveCurrency(inputCurrency?: string): string {
    const normalized = inputCurrency?.trim().toLowerCase();
    if (normalized && normalized.length > 0) {
      return normalized;
    }

    return getStripeCurrency();
  }

  private buildCompactPaymentMetadata(order: Orden): Record<string, string> {
    return {
      cartId:
        typeof order.paymentMetadata?.cartId === "string"
          ? String(order.paymentMetadata.cartId)
          : "",
      orderId: order.id || "",
      fulfillmentMethod: order.fulfillmentMethod || "DELIVERY",
      pickupLocationId: order.pickupLocationId || "",
      shippingProvider:
        typeof order.shipping?.provider === "string" ? order.shipping.provider : "",
      shippingCarrier:
        typeof order.shipping?.carrier === "string" ? order.shipping.carrier : "",
      shippingMethod:
        typeof order.shipping?.shippingMethod === "string"
          ? order.shipping.shippingMethod
          : typeof order.shipping?.method === "string"
            ? order.shipping.method
            : "",
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
    };
  }

  private buildManualFedexPaidOrderPatch(order?: Orden): Record<string, unknown> {
    const shipping = order?.shipping as Record<string, any> | undefined;
    const isManualFedexOrder =
      order?.fulfillmentMethod !== FulfillmentMethod.PICKUP &&
      (shipping?.provider === MANUAL_FEDEX_PROVIDER ||
        shipping?.shippingMethod === MANUAL_FEDEX_METHOD);

    // Estados comunes al confirmarse el pago (domicilio y pickup): el pago
    // queda PAGADO y la orden pasa a pendiente de preparacion. No se genera
    // guia ni se marca como enviado (eso lo hace el admin manualmente).
    const commonPaidPatch: Record<string, unknown> = {
      paymentStatus: PaymentState.PAGADO,
      preparationStatus: PreparationStatus.PENDING_PREPARATION,
    };

    if (!isManualFedexOrder) {
      return commonPaidPatch;
    }

    return {
      ...commonPaidPatch,
      fulfillmentStatus: FulfillmentStatus.PREPARING,
      shipping: {
        ...(shipping || {}),
        status: MANUAL_FEDEX_STATUS,
      },
    };
  }

  private buildOrderPricingSnapshot(order: Orden): PaymentPricingSnapshot {
    const snapshotItems = order.pricingSnapshot?.items || [];

    return {
      subtotalMinor: Math.round(order.subtotal * 100),
      taxMinor: Math.round(order.impuestos * 100),
      shippingMinor: Math.round((order.costoEnvio || 0) * 100),
      totalMinor: Math.round(order.total * 100),
      currency: (order.currency || "MXN").toUpperCase(),
      items: order.items.map((item) => {
        const snapshotItem = snapshotItems.find(
          (pricingItem) =>
            pricingItem.productId === item.productoId &&
            (pricingItem.tallaId || "") === (item.tallaId || ""),
        );

        return {
          productoId: item.productoId,
          cantidad: item.cantidad,
          precioUnitarioMinor: Math.round(item.precioUnitario * 100),
          subtotalMinor: Math.round(item.subtotal * 100),
          tallaId: item.tallaId,
          name: snapshotItem?.productName,
          sku: snapshotItem?.sku,
          precioUnitarioOriginalMinor:
            typeof snapshotItem?.unitPriceOriginal === "number"
              ? Math.round(snapshotItem.unitPriceOriginal * 100)
              : Math.round(item.precioUnitario * 100),
          precioUnitarioFinalMinor:
            typeof snapshotItem?.unitPriceFinal === "number"
              ? Math.round(snapshotItem.unitPriceFinal * 100)
              : Math.round(item.precioUnitario * 100),
          subtotalOriginalMinor:
            typeof snapshotItem?.subtotalOriginal === "number"
              ? Math.round(snapshotItem.subtotalOriginal * 100)
              : Math.round(item.subtotal * 100),
          subtotalFinalMinor:
            typeof snapshotItem?.subtotalFinal === "number"
              ? Math.round(snapshotItem.subtotalFinal * 100)
              : Math.round(item.subtotal * 100),
          discountMinor:
            typeof snapshotItem?.discountTotal === "number"
              ? Math.round(snapshotItem.discountTotal * 100)
              : 0,
          weightKg: snapshotItem?.weightKg,
          lengthCm: snapshotItem?.lengthCm,
          widthCm: snapshotItem?.widthCm,
          heightCm: snapshotItem?.heightCm,
          requiresShipping: snapshotItem?.requiereEnvio,
        };
      }),
      subtotalOriginalMinor:
        typeof order.subtotalOriginal === "number"
          ? Math.round(order.subtotalOriginal * 100)
          : Math.round(order.subtotal * 100),
      subtotalFinalMinor:
        typeof order.subtotalFinal === "number"
          ? Math.round(order.subtotalFinal * 100)
          : Math.round(order.subtotal * 100),
      discountMinor:
        typeof order.discountTotal === "number"
          ? Math.round(order.discountTotal * 100)
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
            amountMinor: Math.round((order.costoEnvio || 0) * 100),
            currency: (order.currency || "MXN").toUpperCase(),
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

  private async getOrderForPayment(
    orderId: string,
    userId: string,
  ): Promise<{
    ordenDoc: FirebaseFirestore.DocumentSnapshot;
    ordenData: Orden;
    amount: number;
  }> {
    const ordenDoc = await firestoreTienda
      .collection(ORDENES_COLLECTION)
      .doc(orderId)
      .get();

    if (!ordenDoc.exists) {
      throw new ApiError(404, `Orden con ID "${orderId}" no encontrada`);
    }

    const ordenData = ordenDoc.data() as Orden;
    if (ordenData.usuarioId !== userId) {
      throw new ApiError(403, "No tienes permisos para iniciar este pago");
    }

    if (ordenData.estado !== EstadoOrden.PENDIENTE) {
      throw new ApiError(
        409,
        `La orden no esta en estado pagable. Estado actual: ${ordenData.estado}`,
      );
    }

    if (ordenData.metodoPago !== MetodoPago.TARJETA) {
      throw new ApiError(
        400,
        "Metodo de pago no valido para Stripe en este endpoint. Usa TARJETA",
      );
    }

    if (typeof ordenData.total !== "number" || ordenData.total <= 0) {
      throw new ApiError(409, "La orden tiene un monto invalido para pago");
    }

    const currency = getStripeCurrency();
    const amount = Math.round(ordenData.total * 100);
    if (amount <= 0) {
      throw new ApiError(409, "La orden tiene un monto invalido para pago");
    }

    const minimumAmountMinor = getStripeMinimumAmountMinor(currency);
    if (amount < minimumAmountMinor) {
      throw new ApiError(
        409,
        `El total de la orden debe ser al menos ${(minimumAmountMinor / 100).toFixed(2)} ${currency.toUpperCase()} para procesar el pago con Stripe`,
      );
    }

    return { ordenDoc, ordenData, amount };
  }

  private async getOrCreateStripeCustomerId(
    stripe: Stripe,
    userId: string,
    preferredCustomerId?: string,
  ): Promise<string> {
    const directUserRef = firestoreApp
      .collection(USERS_APP_COLLECTION)
      .doc(userId);
    const directUserDoc = await directUserRef.get();

    let userRef = directUserRef;
    let userData: Record<string, unknown> | undefined = directUserDoc.data() as
      | Record<string, unknown>
      | undefined;

    if (!directUserDoc.exists) {
      const snapshot = await firestoreApp
        .collection(USERS_APP_COLLECTION)
        .where("uid", "==", userId)
        .limit(1)
        .get();

      if (!snapshot.empty) {
        userRef = snapshot.docs[0].ref;
        userData = snapshot.docs[0].data() as Record<string, unknown>;
      }
    }

    if (!userData) {
      throw new ApiError(
        404,
        "No se encontro el usuario para mapear stripeCustomerId",
      );
    }

    const existingCustomerId =
      typeof userData.stripeCustomerId === "string"
        ? userData.stripeCustomerId.trim()
        : undefined;

    if (existingCustomerId && existingCustomerId.length > 0) {
      try {
        await stripe.customers.retrieve(existingCustomerId);
        return existingCustomerId;
      } catch (error) {
        if (!isStripeMissingResourceError(error)) {
          throw error;
        }

        console.warn("stripe_customer_stale", {
          userId,
          stripeCustomerId: existingCustomerId,
        });
      }
    }

    const resolvedPreferred =
      preferredCustomerId && preferredCustomerId.trim().length > 0
        ? preferredCustomerId.trim()
        : undefined;

    if (resolvedPreferred) {
      try {
        await stripe.customers.retrieve(resolvedPreferred);
        await userRef.set(
          {
            stripeCustomerId: resolvedPreferred,
            updatedAt: admin.firestore.Timestamp.now(),
          },
          { merge: true },
        );
        return resolvedPreferred;
      } catch (error) {
        if (!isStripeMissingResourceError(error)) {
          throw error;
        }

        console.warn("stripe_customer_preferred_stale", {
          userId,
          stripeCustomerId: resolvedPreferred,
        });
      }
    }

    const customer = await stripe.customers.create({
      email: typeof userData.email === "string" ? userData.email : undefined,
      name: typeof userData.nombre === "string" ? userData.nombre : undefined,
      metadata: { userId },
    });

    await userRef.set(
      {
        stripeCustomerId: customer.id,
        updatedAt: admin.firestore.Timestamp.now(),
      },
      { merge: true },
    );

    return customer.id;
  }

  private async generateServerIdempotencyKey(
    ordenId: string,
    userId: string,
    amount: number,
    currency: string,
    operation: "payment_intent" | "checkout_session",
  ): Promise<string> {
    const pagosSnapshot = await firestoreTienda
      .collection(COLECCION_PAGOS)
      .where("ordenId", "==", ordenId)
      .where("userId", "==", userId)
      .get();

    const attempt = pagosSnapshot.size + 1;
    return buildStripeIdempotencyKey({
      operation,
      orderId: ordenId,
      userId,
      amount,
      currency,
      extra: String(attempt),
    });
  }

  async createStripePaymentIntent(
    input: CreateStripePaymentIntentInput,
  ): Promise<CreateStripePaymentIntentResult> {
    const stripe = getStripeClient();
    const {
      orderId,
      userId,
      currency: inputCurrency,
      customerId,
      savePaymentMethod,
      shipping,
      idempotencyKey,
    } = input;
    const currency = this.resolveCurrency(inputCurrency);

    const { ordenDoc, ordenData, amount } = await this.getOrderForPayment(
      orderId,
      userId,
    );
    const stripeCustomerId = await this.getOrCreateStripeCustomerId(
      stripe,
      userId,
      customerId,
    );

    const reusable = await this.findLatestActivePagoDoc(orderId, userId);
    if (reusable) {
      const reused = await this.buildReusedPaymentResult(stripe, reusable, {
        ordenId: orderId,
        userId,
        reason: "existing_active_payment",
      });
      return {
        ...reused,
        stripeCustomerId:
          (reusable.data() as Pago).stripeCustomerId || stripeCustomerId,
      };
    }

    return this.withStartPaymentLock<CreateStripePaymentIntentResult>(
      orderId,
      userId,
      async () => {
        const existing = await this.findLatestActivePagoDoc(orderId, userId);
        if (existing) {
          const reused = await this.buildReusedPaymentResult(stripe, existing, {
            ordenId: orderId,
            userId,
            reason: "existing_active_payment",
          });
          return {
            ...reused,
            stripeCustomerId:
              (existing.data() as Pago).stripeCustomerId || stripeCustomerId,
          };
        }

        const resolvedIdempotencyKey =
          idempotencyKey ||
          (await this.generateServerIdempotencyKey(
            orderId,
            userId,
            amount,
            currency,
            "payment_intent",
          ));

        const idemSnapshot = await firestoreTienda
          .collection(COLECCION_PAGOS)
          .where("idempotencyKey", "==", resolvedIdempotencyKey)
          .limit(1)
          .get();

        if (!idemSnapshot.empty) {
          const pagoExistenteDoc = idemSnapshot.docs[0];
          const pagoExistente = pagoExistenteDoc.data() as Pago;

          if (
            pagoExistente.ordenId !== orderId ||
            pagoExistente.userId !== userId
          ) {
            throw new ApiError(
              409,
              "La idempotency key ya fue usada en otra operacion de pago",
            );
          }

          if (
            pagoExistente.paymentIntentId &&
            isEstadoReutilizable(pagoExistente.estado)
          ) {
            const reused = await this.buildReusedPaymentResult(
              stripe,
              pagoExistenteDoc,
              {
                ordenId: orderId,
                userId,
                reason: "existing_idempotency_key",
              },
            );
            return {
              ...reused,
              stripeCustomerId:
                pagoExistente.stripeCustomerId || stripeCustomerId,
            };
          }

          throw new ApiError(
            409,
            "La idempotency key ya tiene un intento registrado no reutilizable",
          );
        }

        const now = admin.firestore.Timestamp.now();
        const paymentMetadata = this.buildCompactPaymentMetadata({
          ...ordenData,
          id: orderId,
        });
        const pricingSnapshot = this.buildOrderPricingSnapshot({
          ...ordenData,
          id: orderId,
        });
        const cartId = paymentMetadata.cartId || undefined;

        const pagoDraft: Omit<Pago, "id"> = {
          ordenId: orderId,
          userId,
          provider: ProveedorPago.STRIPE,
          metodoPago: MetodoPago.TARJETA,
          monto: ordenData.total,
          currency,
          estado: EstadoPago.PROCESANDO,
          idempotencyKey: resolvedIdempotencyKey,
          stripeCustomerId,
          metadata: paymentMetadata,
          pricingSnapshot,
          createdAt: now,
          updatedAt: now,
        };

        const pagoRef = await firestoreTienda
          .collection(COLECCION_PAGOS)
          .add(pagoDraft);

        try {
          const cardPaymentOptions = buildStripePaymentIntentCardOptions(currency);

          const paymentIntent = await stripe.paymentIntents.create(
            {
              amount,
              currency,
              customer: stripeCustomerId,
              automatic_payment_methods: { enabled: true },
              ...(cardPaymentOptions
                ? { payment_method_options: cardPaymentOptions }
                : {}),
              setup_future_usage: savePaymentMethod ? "off_session" : undefined,
              shipping: shipping as
                | Stripe.PaymentIntentCreateParams.Shipping
                | undefined,
              metadata: {
                ordenId: orderId,
                userId,
                metodoPago: MetodoPago.TARJETA,
                pagoId: pagoRef.id,
                cartId: cartId || "",
                fulfillmentMethod: ordenData.fulfillmentMethod || "DELIVERY",
              pickupLocationId: ordenData.pickupLocationId || "",
              shippingProvider: paymentMetadata.shippingProvider,
              shippingServiceType: paymentMetadata.shippingServiceType,
              carrierCode: paymentMetadata.carrierCode,
              shippingTotal: paymentMetadata.shippingTotal,
              discountTotal: paymentMetadata.discountTotal,
            },
          },
          { idempotencyKey: resolvedIdempotencyKey },
          );

          const estadoPago = mapPaymentIntentStatusToEstadoPago(
            paymentIntent.status,
          );
          await pagoRef.update({
            paymentIntentId: paymentIntent.id,
            providerStatus: paymentIntent.status,
            estado: estadoPago,
            stripeCustomerId,
            updatedAt: admin.firestore.Timestamp.now(),
          });

          await ordenDoc.ref.set(
            {
              stripePaymentIntentId: paymentIntent.id,
              stripeCustomerId,
              paymentMetadata,
              updatedAt: admin.firestore.Timestamp.now(),
            },
            { merge: true },
          );

          if (!paymentIntent.client_secret) {
            throw new ApiError(
              502,
              "Stripe no devolvio client secret para el intento de pago",
            );
          }

          return {
            pagoId: pagoRef.id,
            paymentIntentId: paymentIntent.id,
            clientSecret: paymentIntent.client_secret,
            status: estadoPago,
            created: true,
            stripeCustomerId,
          };
        } catch (error) {
          const stripeError = error as {
            code?: string;
            message?: string;
            type?: string;
          };
          const failureCode = stripeError?.code || "stripe_error";
          const failureMessage =
            stripeError?.message || "No fue posible crear el intento de pago";
          const providerStatus = stripeError?.type || "stripe_error";

          await pagoRef.update({
            estado: EstadoPago.FALLIDO,
            failureCode,
            failureMessage,
            providerStatus,
            stripeCustomerId,
            updatedAt: admin.firestore.Timestamp.now(),
          });

          console.error("Error al crear PaymentIntent", {
            orderId,
            userId,
            pagoId: pagoRef.id,
            failureCode,
            failureMessage,
          });

          if (error instanceof ApiError) {
            throw error;
          }

          throw new ApiError(502, "Error al iniciar el pago con Stripe");
        }
      },
      () => this.waitForReusableActivePayment(stripe, orderId, userId),
    );
  }

  async iniciarPago(input: IniciarPagoInput): Promise<IniciarPagoResult> {
    const { ordenId, userId, metodoPago, idempotencyKey } = input;

    const ordenDoc = await firestoreTienda
      .collection(ORDENES_COLLECTION)
      .doc(ordenId)
      .get();

    if (!ordenDoc.exists) {
      throw new ApiError(404, `Orden con ID "${ordenId}" no encontrada`);
    }

    const ordenData = ordenDoc.data() as Orden;
    if (metodoPago !== ordenData.metodoPago) {
      throw new ApiError(
        400,
        "El metodo de pago no coincide con el metodo configurado en la orden",
      );
    }

    if (metodoPago !== MetodoPago.TARJETA) {
      throw new ApiError(
        400,
        "Metodo de pago no valido para Stripe en este endpoint. Usa TARJETA",
      );
    }

    return this.createStripePaymentIntent({
      orderId: ordenId,
      userId,
      idempotencyKey,
    });
  }

  getPublicStripeConfig(): { publishableKey?: string } {
    return {
      publishableKey: getStripePublishableKey(),
    };
  }

  async getStripePaymentIntentById(
    paymentIntentId: string,
    user: AuthUser,
  ): Promise<{
    id: string;
    status: string;
    amount: number;
    currency: string;
    orderId?: string;
    paymentId?: string;
  }> {
    const stripe = getStripeClient();
    const pagoMatch = await this.findPagoByField(
      "paymentIntentId",
      paymentIntentId,
    );

    if (!pagoMatch) {
      throw new ApiError(404, "PaymentIntent no encontrado en la base interna");
    }

    const pagoDoc = await pagoMatch.pagoRef.get();
    const pagoData = pagoDoc.data() as Pago;
    if (!isAdminOrEmpleado(user.rol) && pagoData.userId !== user.uid) {
      throw new ApiError(
        403,
        "No tienes permisos para consultar este PaymentIntent",
      );
    }

    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
    return {
      id: paymentIntent.id,
      status: paymentIntent.status,
      amount: paymentIntent.amount,
      currency: paymentIntent.currency,
      orderId: pagoMatch.ordenId,
      paymentId: pagoMatch.pagoId,
    };
  }

async createStripeCheckoutSession(
  input: CreateStripeCheckoutSessionInput,
): Promise<CreateStripeCheckoutSessionResult> {
  const stripe = getStripeClient();
  const { orderId, userId, successUrl, idempotencyKey } = input;
  const currency = getStripeCurrency();

  const { ordenDoc, ordenData, amount } = await this.getOrderForPayment(
    orderId,
    userId,
  );

    await inventoryReservationService.reserveForOrder({
      ordenId: orderId,
      usuarioId: userId,
      idempotencyPrefix: "stripe",
    });

  const stripeCustomerId = await this.getOrCreateStripeCustomerId(
    stripe,
    userId,
  );

  return this.withStartPaymentLock(orderId, userId, async () => {
    const activePagoDoc = await this.findLatestActivePagoDoc(orderId, userId);

    if (activePagoDoc) {
      const activePago = activePagoDoc.data() as Pago;

      if (activePago.checkoutSessionId) {
        const existingSession = await stripe.checkout.sessions.retrieve(
          activePago.checkoutSessionId,
        );

        if (existingSession.client_secret) {
          return {
            sessionId: existingSession.id,
            clientSecret: existingSession.client_secret,
            url: existingSession.url,
            pagoId: activePagoDoc.id,
            stripeCustomerId: activePago.stripeCustomerId || stripeCustomerId,
            created: false,
          };
        }

        await activePagoDoc.ref.set(
          {
            estado: EstadoPago.FALLIDO,
            failureCode: "stripe_checkout_session_without_client_secret",
            failureMessage:
              "La sesion existente de Stripe no tiene client_secret para Embedded Checkout",
            updatedAt: admin.firestore.Timestamp.now(),
          },
          { merge: true },
        );
      }
    }

    const resolvedIdempotencyKey =
      idempotencyKey ||
      (await this.generateServerIdempotencyKey(
        orderId,
        userId,
        amount,
        currency,
        "checkout_session",
      ));

    const idemSnapshot = await firestoreTienda
      .collection(COLECCION_PAGOS)
      .where("idempotencyKey", "==", resolvedIdempotencyKey)
      .limit(1)
      .get();

    if (!idemSnapshot.empty) {
      const existingDoc = idemSnapshot.docs[0];
      const existingPago = existingDoc.data() as Pago;

      if (
        existingPago.ordenId === orderId &&
        existingPago.userId === userId &&
        existingPago.checkoutSessionId &&
        isEstadoReutilizable(existingPago.estado)
      ) {
        const existingSession = await stripe.checkout.sessions.retrieve(
          existingPago.checkoutSessionId,
        );

        if (existingSession.client_secret) {
          return {
            sessionId: existingSession.id,
            clientSecret: existingSession.client_secret,
            url: existingSession.url,
            pagoId: existingDoc.id,
            stripeCustomerId: existingPago.stripeCustomerId || stripeCustomerId,
            created: false,
          };
        }

        await existingDoc.ref.set(
          {
            estado: EstadoPago.FALLIDO,
            failureCode: "stripe_checkout_session_without_client_secret",
            failureMessage:
              "La sesion existente de Stripe no tiene client_secret para Embedded Checkout",
            updatedAt: admin.firestore.Timestamp.now(),
          },
          { merge: true },
        );
      }
    }

    const now = admin.firestore.Timestamp.now();

    const paymentMetadata = this.buildCompactPaymentMetadata({
      ...ordenData,
      id: orderId,
    });

    const pricingSnapshot = this.buildOrderPricingSnapshot({
      ...ordenData,
      id: orderId,
    });

    const cartId = paymentMetadata.cartId || undefined;

    const pagoDraft: Omit<Pago, "id"> = {
      ordenId: orderId,
      userId,
      provider: ProveedorPago.STRIPE,
      metodoPago: MetodoPago.TARJETA,
      monto: ordenData.total,
      currency,
      estado: EstadoPago.PROCESANDO,
      idempotencyKey: resolvedIdempotencyKey,
      stripeCustomerId,
      metadata: paymentMetadata,
      pricingSnapshot,
      createdAt: now,
      updatedAt: now,
    };

    const pagoRef = await firestoreTienda
      .collection(COLECCION_PAGOS)
      .add(pagoDraft);

    const baseUrl = getAppUrl();

    const resolvedSuccessUrl =
      successUrl ||
      `${baseUrl}/checkout/success?session_id={CHECKOUT_SESSION_ID}`;

    const orderTotalMinor = Math.round(Number(ordenData.total || 0) * 100);

    if (orderTotalMinor <= 0 || orderTotalMinor !== amount) {
      throw new ApiError(
        409,
        "La orden tiene un total inválido para Stripe Checkout",
      );
    }

    const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [
      {
        quantity: 1,
        price_data: {
          currency,
          unit_amount: orderTotalMinor,
          product_data: {
            name: `Pedido ${orderId}`,
            description: "Compra en tienda Club León",
            metadata: {
              ordenId: orderId,
              cartId: cartId || "",
              fulfillmentMethod: ordenData.fulfillmentMethod || "DELIVERY",
              discountTotal: paymentMetadata.discountTotal,
              shippingTotal: paymentMetadata.shippingTotal,
            },
          },
        },
      },
    ];

    const embeddedCheckoutBase = buildEmbeddedCheckoutSessionBaseParams(currency);

    const session = await stripe.checkout.sessions.create(
      {
        mode: "payment",
        ui_mode: "embedded",
        customer: stripeCustomerId,
        line_items: lineItems,
        return_url: resolvedSuccessUrl,
        ...embeddedCheckoutBase,
        metadata: {
          ordenId: orderId,
          userId,
          pagoId: pagoRef.id,
          cartId: cartId || "",
          fulfillmentMethod: ordenData.fulfillmentMethod || "DELIVERY",
          pickupLocationId: ordenData.pickupLocationId || "",
          shippingProvider: paymentMetadata.shippingProvider,
          shippingServiceType: paymentMetadata.shippingServiceType,
          carrierCode: paymentMetadata.carrierCode,
          shippingTotal: paymentMetadata.shippingTotal,
          discountTotal: paymentMetadata.discountTotal,
        },
        payment_intent_data: {
          metadata: {
            ordenId: orderId,
            userId,
            pagoId: pagoRef.id,
            cartId: cartId || "",
            fulfillmentMethod: ordenData.fulfillmentMethod || "DELIVERY",
            pickupLocationId: ordenData.pickupLocationId || "",
            shippingProvider: paymentMetadata.shippingProvider,
            shippingServiceType: paymentMetadata.shippingServiceType,
            carrierCode: paymentMetadata.carrierCode,
            shippingTotal: paymentMetadata.shippingTotal,
            discountTotal: paymentMetadata.discountTotal,
          },
        },
      },
      { idempotencyKey: resolvedIdempotencyKey },
    );

    if (!session.client_secret) {
      await pagoRef.set(
        {
          estado: EstadoPago.FALLIDO,
          failureCode: "stripe_embedded_checkout_without_client_secret",
          failureMessage:
            "Stripe no devolvio client_secret para Embedded Checkout",
          updatedAt: admin.firestore.Timestamp.now(),
        },
        { merge: true },
      );

      throw new ApiError(
        502,
        "Stripe no devolvio client secret para Embedded Checkout",
      );
    }

    const checkoutUpdate: Record<string, unknown> = {
      checkoutSessionId: session.id,
      providerStatus: session.payment_status || "open",
      stripeCustomerId,
      updatedAt: admin.firestore.Timestamp.now(),
    };

    if (typeof session.payment_intent === "string") {
      checkoutUpdate.paymentIntentId = session.payment_intent;
    }

    await pagoRef.update(checkoutUpdate);

    await ordenDoc.ref.set(
      {
        stripeCheckoutSessionId: session.id,
        stripeCustomerId,
        paymentMetadata,
        updatedAt: admin.firestore.Timestamp.now(),
      },
      { merge: true },
    );

    return {
      sessionId: session.id,
      clientSecret: session.client_secret,
      url: session.url,
      pagoId: pagoRef.id,
      stripeCustomerId,
      created: true,
    };
  });
}

  async createStripeCheckoutSessionForAttempt(
    input: CreateStripeCheckoutSessionForAttemptInput,
  ): Promise<CreateStripeCheckoutSessionResult> {
    const stripe = getStripeClient();
    const currency = getStripeCurrency();
    const amount = Math.round(input.pricing.total * 100);

    if (amount <= 0) {
      throw new ApiError(409, "El total del checkout es inválido para Stripe");
    }

    const stripeCustomerId = await this.getOrCreateStripeCustomerId(
      stripe,
      input.userId,
    );

    const idemSnapshot = await firestoreTienda
      .collection(COLECCION_PAGOS)
      .where("idempotencyKey", "==", input.idempotencyKey)
      .limit(1)
      .get();

    if (!idemSnapshot.empty) {
      const existingDoc = idemSnapshot.docs[0];
      const existingPago = existingDoc.data() as Pago;
      if (
        existingPago.checkoutAttemptId === input.checkoutAttemptId &&
        existingPago.checkoutSessionId &&
        isEstadoReutilizable(existingPago.estado)
      ) {
        const existingSession = await stripe.checkout.sessions.retrieve(
          existingPago.checkoutSessionId,
        );
        if (existingSession.client_secret) {
          return {
            sessionId: existingSession.id,
            clientSecret: existingSession.client_secret,
            url: existingSession.url,
            pagoId: existingDoc.id,
            stripeCustomerId:
              existingPago.stripeCustomerId || stripeCustomerId,
            created: false,
          };
        }
      }
    }

    const now = admin.firestore.Timestamp.now();
    const paymentMetadata = {
      cartId: input.cartId,
      checkoutAttemptId: input.checkoutAttemptId,
      fulfillmentMethod: input.orderDraft.fulfillmentMethod || "DELIVERY",
      pickupLocationId: input.orderDraft.pickupLocationId || "",
      shippingTotal: String(input.pricing.shippingTotal || 0),
      discountTotal: String(input.pricing.discountTotal || 0),
    };

    const pagoRef = await firestoreTienda.collection(COLECCION_PAGOS).add({
      ordenId: "",
      checkoutAttemptId: input.checkoutAttemptId,
      userId: input.userId,
      provider: ProveedorPago.STRIPE,
      metodoPago: MetodoPago.TARJETA,
      monto: input.pricing.total,
      amountMinor: amount,
      currency,
      estado: EstadoPago.PROCESANDO,
      status: PaymentStatus.PENDING_CUSTOMER,
      idempotencyKey: input.idempotencyKey,
      stripeCustomerId,
      metadata: paymentMetadata,
      createdAt: now,
      updatedAt: now,
    } satisfies Omit<Pago, "id">);

    const embeddedCheckoutBase = buildEmbeddedCheckoutSessionBaseParams(currency);

    const session = await stripe.checkout.sessions.create(
      {
        mode: "payment",
        ui_mode: "embedded",
        customer: stripeCustomerId,
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency,
              unit_amount: amount,
              product_data: {
                name: "Compra Club León",
                description: "Checkout seguro",
                metadata: {
                  checkoutAttemptId: input.checkoutAttemptId,
                  cartId: input.cartId,
                  fulfillmentMethod: paymentMetadata.fulfillmentMethod,
                },
              },
            },
          },
        ],
        return_url: input.successUrl,
        ...embeddedCheckoutBase,
        metadata: {
          checkoutAttemptId: input.checkoutAttemptId,
          userId: input.userId,
          pagoId: pagoRef.id,
          cartId: input.cartId,
          fulfillmentMethod: paymentMetadata.fulfillmentMethod,
          pickupLocationId: paymentMetadata.pickupLocationId,
          shippingTotal: paymentMetadata.shippingTotal,
          discountTotal: paymentMetadata.discountTotal,
        },
        payment_intent_data: {
          metadata: {
            checkoutAttemptId: input.checkoutAttemptId,
            userId: input.userId,
            pagoId: pagoRef.id,
            cartId: input.cartId,
            fulfillmentMethod: paymentMetadata.fulfillmentMethod,
            pickupLocationId: paymentMetadata.pickupLocationId,
            shippingTotal: paymentMetadata.shippingTotal,
            discountTotal: paymentMetadata.discountTotal,
          },
        },
      },
      { idempotencyKey: input.idempotencyKey },
    );

    if (!session.client_secret) {
      throw new ApiError(
        502,
        "Stripe no devolvio client secret para Embedded Checkout",
      );
    }

    const checkoutUpdate: Record<string, unknown> = {
      checkoutSessionId: session.id,
      providerStatus: session.payment_status || "open",
      updatedAt: admin.firestore.Timestamp.now(),
    };
    if (typeof session.payment_intent === "string") {
      checkoutUpdate.paymentIntentId = session.payment_intent;
    }
    await pagoRef.update(checkoutUpdate);

    console.log("stripe_checkout_session_for_attempt", {
      checkoutAttemptId: input.checkoutAttemptId,
      pagoId: pagoRef.id,
      stripeSessionId: session.id,
    });

    return {
      sessionId: session.id,
      clientSecret: session.client_secret,
      url: session.url,
      pagoId: pagoRef.id,
      stripeCustomerId,
      created: true,
    };
  }

  async getStripeCheckoutSessionForAttempt(
    sessionId: string,
    userId: string,
  ): Promise<{ sessionId: string; clientSecret: string }> {
    const stripe = getStripeClient();
    const pagoMatch = await this.findPagoByField("checkoutSessionId", sessionId);
    if (!pagoMatch) {
      throw new ApiError(404, "Sesión de pago no encontrada");
    }
    const pagoDoc = await pagoMatch.pagoRef.get();
    const pagoData = pagoDoc.data() as Pago;
    if (pagoData.userId !== userId) {
      throw new ApiError(403, "No tienes permisos para esta sesión de pago");
    }
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (!session.client_secret) {
      throw new ApiError(409, "La sesión de Stripe no tiene client_secret");
    }
    return { sessionId: session.id, clientSecret: session.client_secret };
  }

  async getPaymentStatusSummary(
    pagoId: string,
  ): Promise<{ status?: string } | null> {
    const doc = await firestoreTienda.collection(COLECCION_PAGOS).doc(pagoId).get();
    if (!doc.exists) {
      return null;
    }
    const data = doc.data() as Pago;
    return {
      status: data.status || data.estado,
    };
  }

  async linkPaymentToOrder(pagoId: string, ordenId: string): Promise<void> {
    await firestoreTienda.collection(COLECCION_PAGOS).doc(pagoId).set(
      {
        ordenId,
        updatedAt: admin.firestore.Timestamp.now(),
      },
      { merge: true },
    );
  }

  private getPaymentIntentIdFromCheckoutSession(
    session: Stripe.Checkout.Session,
  ): string | undefined {
    if (typeof session.payment_intent === "string") {
      return session.payment_intent;
    }

    return session.payment_intent?.id;
  }

  async getStripeCheckoutSessionById(
    sessionId: string,
    user: AuthUser,
  ): Promise<{
    id: string;
    paymentStatus: string | null;
    status: string | null;
    orderId?: string;
    paymentIntentId?: string;
    paymentId?: string;
  }> {
    const stripe = getStripeClient();
    const pagoMatch = await this.findPagoByField(
      "checkoutSessionId",
      sessionId,
    );
    if (!pagoMatch) {
      throw new ApiError(
        404,
        "Checkout Session no encontrada en la base interna",
      );
    }

    const pagoDoc = await pagoMatch.pagoRef.get();
    const pagoData = pagoDoc.data() as Pago;
    if (!isAdminOrEmpleado(user.rol) && pagoData.userId !== user.uid) {
      throw new ApiError(
        403,
        "No tienes permisos para consultar esta Checkout Session",
      );
    }

    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ["payment_intent"],
    });

    return {
      id: session.id,
      paymentStatus: session.payment_status,
      status: session.status,
      orderId: pagoMatch.ordenId,
      paymentIntentId: this.getPaymentIntentIdFromCheckoutSession(session),
      paymentId: pagoMatch.pagoId,
    };
  }

  async createStripeSetupIntent(
    input: CreateStripeSetupIntentInput,
  ): Promise<CreateStripeSetupIntentResult> {
    const stripe = getStripeClient();
    const stripeCustomerId = await this.getOrCreateStripeCustomerId(
      stripe,
      input.userId,
      input.customerId,
    );

    const setupIntent = await stripe.setupIntents.create({
      customer: stripeCustomerId,
      payment_method_types: ["card"],
      metadata: {
        userId: input.userId,
      },
    });

    if (!setupIntent.client_secret) {
      throw new ApiError(
        502,
        "Stripe no devolvio client secret para SetupIntent",
      );
    }

    return {
      setupIntentId: setupIntent.id,
      clientSecret: setupIntent.client_secret,
      stripeCustomerId,
    };
  }

  async createStripeBillingPortal(
    input: CreateStripeBillingPortalInput,
  ): Promise<CreateStripeBillingPortalResult> {
    const stripe = getStripeClient();
    const stripeCustomerId = await this.getOrCreateStripeCustomerId(
      stripe,
      input.userId,
    );

    const portalSession = await stripe.billingPortal.sessions.create({
      customer: stripeCustomerId,
      return_url: input.returnUrl || getAppUrl(),
    });

    return {
      url: portalSession.url,
      stripeCustomerId,
    };
  }

  async procesarReembolsoPorOrden(
    input: CreateStripeRefundByOrderInput,
  ): Promise<ProcesarReembolsoResult> {
    const snapshot = await firestoreTienda
      .collection(COLECCION_PAGOS)
      .where("ordenId", "==", input.orderId)
      .orderBy("createdAt", "desc")
      .limit(20)
      .get();

    const pagoCompletado = snapshot.docs.find((doc) => {
      const pago = doc.data() as Pago;
      return pago.estado === EstadoPago.COMPLETADO;
    });

    if (!pagoCompletado) {
      throw new ApiError(
        404,
        "No se encontro un pago completado para reembolsar en esta orden",
      );
    }

    return this.procesarReembolso({
      pagoId: pagoCompletado.id,
      refundReason: input.reason,
      requestedByUid: input.requestedByUid,
    });
  }

  async procesarWebhookStripe(
    rawBody: Buffer,
    signature: string,
  ): Promise<StripeWebhookProcessResult> {
    const stripe = getStripeClient();
    const webhookSecret = getStripeWebhookSecret();

    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
    } catch (error) {
      throw new ApiError(
        400,
        `Firma de webhook invalida: ${parseWebhookErrorMessage(error)}`,
      );
    }

    const wasReserved = await this.reserveWebhookEvent(event);
    if (!wasReserved) {
      return {
        outcome: "duplicate",
        eventId: event.id,
        eventType: event.type,
        reason: "event_id_already_processed",
      };
    }

    try {
      const result = await this.handleStripeEvent(event);

      await this.updateWebhookEventRecord(event.id, {
        status: result.outcome,
        pagoId: result.pagoId,
        ordenId: result.ordenId,
        reason: result.reason,
      });

      console.info("stripe_webhook_processed", {
        eventId: result.eventId,
        eventType: result.eventType,
        outcome: result.outcome,
        pagoId: result.pagoId,
        ordenId: result.ordenId,
        reason: result.reason,
      });

      return result;
    } catch (error) {
      const errorMessage = parseWebhookErrorMessage(error);
      await this.updateWebhookEventRecord(event.id, {
        status: "error",
        reason: errorMessage,
      });

      console.error("stripe_webhook_error", {
        eventId: event.id,
        eventType: event.type,
        reason: errorMessage,
      });

      throw error;
    }
  }

  async procesarReembolso(
    input: ProcesarReembolsoInput,
  ): Promise<ProcesarReembolsoResult> {
    const { pagoId, refundAmount, refundReason, requestedByUid } = input;
    const stripe = getStripeClient();

    const pagoRef = firestoreTienda.collection(COLECCION_PAGOS).doc(pagoId);
    const pagoDoc = await pagoRef.get();
    if (!pagoDoc.exists) {
      throw new ApiError(404, `Pago con ID "${pagoId}" no encontrado`);
    }

    const pago = pagoDoc.data() as Pago;
    if (pago.estado !== EstadoPago.COMPLETADO) {
      throw new ApiError(
        409,
        `El pago debe estar COMPLETADO para reembolso. Estado actual: ${pago.estado}`,
      );
    }

    if (!pago.paymentIntentId) {
      throw new ApiError(
        409,
        "El pago no tiene paymentIntentId para procesar reembolso en Stripe",
      );
    }

    if (typeof pago.monto !== "number" || pago.monto <= 0) {
      throw new ApiError(409, "El pago tiene un monto inválido para reembolso");
    }

    const refundAmountToApply = refundAmount ?? pago.monto;
    if (refundAmountToApply > pago.monto) {
      throw new ApiError(
        400,
        "El monto de reembolso no puede ser mayor al monto original del pago",
      );
    }

    const refundAmountInCents = Math.round(refundAmountToApply * 100);
    if (refundAmountInCents <= 0) {
      throw new ApiError(400, "El monto de reembolso debe ser mayor a 0");
    }

    const ordenGuardDoc = await firestoreTienda
      .collection(ORDENES_COLLECTION)
      .doc(pago.ordenId)
      .get();
    if (!ordenGuardDoc.exists) {
      throw new ApiError(
        404,
        `Orden asociada con ID "${pago.ordenId}" no encontrada`,
      );
    }

    try {
      await shippingRefundGuardService.ensureShipmentCanProceedToRefund({
        orderId: pago.ordenId,
        order: ordenGuardDoc.data() as Orden,
        reason: refundReason,
        requestedByUid,
      });
    } catch (error) {
      if (error instanceof ShippingRefundGuardError) {
        throw new ApiError(error.statusCode, error.message);
      }
      throw error;
    }

    await firestoreTienda.collection(SHIPPING_EVENTS_COLLECTION).add({
      orderId: pago.ordenId,
      provider: ProveedorPago.STRIPE,
      type: "REFUND_REQUESTED",
      reason: refundReason,
      refundAmount: refundAmountToApply,
      createdBy: requestedByUid,
      createdAt: admin.firestore.Timestamp.now(),
    });

    let refund: Stripe.Refund;
    try {
      refund = await stripe.refunds.create({
        payment_intent: pago.paymentIntentId,
        amount: refundAmount ? refundAmountInCents : undefined,
        reason: refundReason ? "requested_by_customer" : undefined,
        metadata: refundReason ? { refundReason } : undefined,
      });
    } catch (error) {
      const stripeError = error as {
        code?: string;
        message?: string;
        type?: string;
      };
      const failureCode = stripeError?.code || "stripe_refund_error";
      const failureMessage =
        stripeError?.message || "No fue posible procesar el reembolso";
      const providerStatus = stripeError?.type || "stripe_refund_error";

      await pagoRef.update({
        failureCode,
        failureMessage,
        providerStatus,
        updatedAt: admin.firestore.Timestamp.now(),
      });

      console.error("stripe_refund_error", {
        pagoId,
        ordenId: pago.ordenId,
        requestedByUid,
        failureCode,
        failureMessage,
      });

      throw new ApiError(502, "Error al procesar el reembolso con Stripe");
    }

    const now = admin.firestore.Timestamp.now();
    const ordenRef = firestoreTienda
      .collection(ORDENES_COLLECTION)
      .doc(pago.ordenId);

    await firestoreTienda.runTransaction(async (tx) => {
      const ordenDoc = await tx.get(ordenRef);
      if (!ordenDoc.exists) {
        throw new ApiError(
          404,
          `Orden asociada con ID "${pago.ordenId}" no encontrada`,
        );
      }

      tx.update(pagoRef, {
        estado: EstadoPago.REEMBOLSADO,
        providerStatus: refund.status,
        paymentIntentId: pago.paymentIntentId,
        stripeCustomerId: pago.stripeCustomerId,
        refundId: refund.id,
        refundAmount: refund.amount / 100,
        refundReason:
          refundReason ||
          refund.metadata?.refundReason ||
          refund.reason ||
          undefined,
        failureCode: admin.firestore.FieldValue.delete(),
        failureMessage: admin.firestore.FieldValue.delete(),
        updatedAt: now,
      });

      tx.update(ordenRef, {
        estado: EstadoOrden.CANCELADA,
        stripePaymentIntentId: pago.paymentIntentId,
        stripeCustomerId: pago.stripeCustomerId,
        updatedAt: now,
      });
    });

    console.info("stripe_refund_processed", {
      pagoId,
      ordenId: pago.ordenId,
      refundId: refund.id,
      refundAmount: refund.amount / 100,
      requestedByUid,
    });

    await firestoreTienda.collection(SHIPPING_EVENTS_COLLECTION).add({
      orderId: pago.ordenId,
      provider: ProveedorPago.STRIPE,
      type: "REFUND_COMPLETED",
      refundId: refund.id,
      refundAmount: refund.amount / 100,
      reason: refundReason,
      createdBy: requestedByUid,
      createdAt: admin.firestore.Timestamp.now(),
    });

    return {
      pagoId,
      ordenId: pago.ordenId,
      estadoPago: EstadoPago.REEMBOLSADO,
      estadoOrden: EstadoOrden.CANCELADA,
      refundId: refund.id,
      refundAmount: refund.amount / 100,
      refundReason:
        refundReason ||
        refund.metadata?.refundReason ||
        refund.reason ||
        undefined,
    };
  }

  async getPagoById(
    pagoId: string,
    user: AuthUser,
  ): Promise<PagoConsultaResult> {
    const pagoRef = firestoreTienda.collection(COLECCION_PAGOS).doc(pagoId);
    const pagoDoc = await pagoRef.get();

    if (!pagoDoc.exists) {
      console.info("pago_query_not_found", {
        pagoId,
        uid: user.uid,
        rol: user.rol,
        reason: "pago_not_found",
      });
      throw new ApiError(404, `Pago con ID "${pagoId}" no encontrado`);
    }

    const pago = pagoDoc.data() as Pago;

    if (!isAdminOrEmpleado(user.rol) && pago.userId !== user.uid) {
      console.warn("pago_query_denied", {
        pagoId,
        ordenId: pago.ordenId,
        uid: user.uid,
        rol: user.rol,
        reason: "ownership_denied",
      });
      throw new ApiError(403, "No tienes permisos para consultar este pago");
    }

    const ordenRef = firestoreTienda
      .collection(ORDENES_COLLECTION)
      .doc(pago.ordenId);
    const ordenDoc = await ordenRef.get();
    if (!ordenDoc.exists) {
      console.error("pago_query_not_found", {
        pagoId,
        ordenId: pago.ordenId,
        uid: user.uid,
        rol: user.rol,
        reason: "orden_related_not_found",
      });
      throw new ApiError(
        404,
        `Orden asociada con ID "${pago.ordenId}" no encontrada`,
      );
    }

    const orden = ordenDoc.data() as Orden;

    const result: PagoConsultaResult = {
      id: pagoDoc.id,
      estado: pago.estado,
      monto: pago.monto,
      currency: pago.currency,
      metodoPago: pago.metodoPago,
      provider: pago.provider,
      paymentIntentId: pago.paymentIntentId,
      checkoutSessionId: pago.checkoutSessionId,
      stripeCustomerId: pago.stripeCustomerId,
      fechaPago: pago.fechaPago,
      failureCode: pago.failureCode,
      failureMessage: pago.failureMessage,
      orden: {
        id: ordenDoc.id,
        estado: orden.estado,
        total: orden.total,
      },
    };

    console.info("pago_query_success", {
      pagoId,
      ordenId: ordenDoc.id,
      uid: user.uid,
      rol: user.rol,
    });

    return result;
  }

  async getPagoByOrdenId(
    ordenId: string,
    user: AuthUser,
  ): Promise<PagoConsultaResult> {
    const pagosSnapshot = await firestoreTienda
      .collection(COLECCION_PAGOS)
      .where("ordenId", "==", ordenId)
      .orderBy("createdAt", "desc")
      .limit(1)
      .get();

    if (pagosSnapshot.empty) {
      console.info("pago_query_not_found", {
        ordenId,
        uid: user.uid,
        rol: user.rol,
        reason: "pago_not_found_by_orden",
      });
      throw new ApiError(404, `No se encontró pago para la orden "${ordenId}"`);
    }

    const pagoId = pagosSnapshot.docs[0].id;
    return this.getPagoById(pagoId, user);
  }

  private async reserveWebhookEvent(event: Stripe.Event): Promise<boolean> {
    const eventRef = firestoreTienda
      .collection(STRIPE_WEBHOOK_EVENTS_COLLECTION)
      .doc(event.id);

    const now = admin.firestore.Timestamp.now();

    try {
      await eventRef.create({
        eventId: event.id,
        eventType: event.type,
        livemode: event.livemode,
        status: "received",
        createdAt: now,
        updatedAt: now,
      });

      return true;
    } catch (error) {
      if (isAlreadyExistsError(error)) {
        const existingSnapshot = await eventRef.get();
        const existingData = existingSnapshot.data() as
          | {
              status?: string;
              retryCount?: number;
            }
          | undefined;

        if (existingData?.status === "error") {
          const retryCount =
            typeof existingData.retryCount === "number"
              ? existingData.retryCount + 1
              : 1;

          await eventRef.set(
            {
              status: "received",
              retryCount,
              updatedAt: now,
            },
            { merge: true },
          );

          return true;
        }

        return false;
      }

      throw error;
    }
  }

  private async updateWebhookEventRecord(
    eventId: string,
    data: {
      status: "processed" | "duplicate" | "unmatched" | "ignored" | "error";
      pagoId?: string;
      ordenId?: string;
      reason?: string;
    },
  ): Promise<void> {
    await firestoreTienda
      .collection(STRIPE_WEBHOOK_EVENTS_COLLECTION)
      .doc(eventId)
      .set(
        {
          status: data.status,
          pagoId: data.pagoId,
          ordenId: data.ordenId,
          reason: data.reason,
          updatedAt: admin.firestore.Timestamp.now(),
        },
        { merge: true },
      );
  }

  private assertStripeAmountMatchesOrder(
    stripeAmountMinor: number | null | undefined,
    ordenData: Orden,
    context: {
      eventId: string;
      pagoId?: string;
      ordenId: string;
      source: string;
    },
  ): void {
    const expectedMinor = Math.round(Number(ordenData.total || 0) * 100);

    if (
      typeof stripeAmountMinor !== "number" ||
      !Number.isFinite(stripeAmountMinor) ||
      stripeAmountMinor !== expectedMinor
    ) {
      console.error("stripe_payment_amount_mismatch", {
        eventId: context.eventId,
        pagoId: context.pagoId,
        ordenId: context.ordenId,
        source: context.source,
        expectedMinor,
        receivedMinor: stripeAmountMinor ?? null,
        orderTotal: ordenData.total,
      });

      throw new ApiError(
        409,
        "El monto pagado en Stripe no coincide con el total de la orden",
      );
    }
  }

  private assertStripeAmountMatchesPago(
    stripeAmountMinor: number | null | undefined,
    pagoData: Pago,
    context: {
      eventId: string;
      pagoId?: string;
      checkoutAttemptId?: string;
      source: string;
    },
  ): void {
    const expectedMinor =
      typeof pagoData.amountMinor === "number" && pagoData.amountMinor > 0
        ? pagoData.amountMinor
        : Math.round(Number(pagoData.monto || 0) * 100);

    if (
      typeof stripeAmountMinor !== "number" ||
      !Number.isFinite(stripeAmountMinor) ||
      stripeAmountMinor !== expectedMinor
    ) {
      console.error("stripe_payment_amount_mismatch", {
        eventId: context.eventId,
        pagoId: context.pagoId,
        checkoutAttemptId: context.checkoutAttemptId,
        source: context.source,
        expectedMinor,
        receivedMinor: stripeAmountMinor ?? null,
        pagoTotal: pagoData.monto,
      });

      throw new ApiError(
        409,
        "El monto pagado en Stripe no coincide con el total del checkout",
      );
    }
  }

  private async handleStripeEvent(
    event: Stripe.Event,
  ): Promise<StripeWebhookProcessResult> {
    switch (event.type) {
      case "payment_intent.succeeded": {
        const paymentIntent = event.data.object as Stripe.PaymentIntent;
        return this.handlePaymentIntentSucceeded(event, paymentIntent);
      }
      case "payment_intent.payment_failed": {
        const paymentIntent = event.data.object as Stripe.PaymentIntent;
        return this.handlePaymentIntentFailed(event, paymentIntent);
      }
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        return this.handleCheckoutSuccess(event, session);
      }
      case "checkout.session.async_payment_succeeded": {
        const session = event.data.object as Stripe.Checkout.Session;
        return this.handleCheckoutSuccess(event, session);
      }
      case "checkout.session.async_payment_failed": {
        const session = event.data.object as Stripe.Checkout.Session;
        return this.handleCheckoutFailed(event, session);
      }
      case "checkout.session.expired": {
        const session = event.data.object as Stripe.Checkout.Session;
        return this.handleCheckoutExpired(event, session);
      }
      case "payment_intent.canceled": {
        const paymentIntent = event.data.object as Stripe.PaymentIntent;
        return this.handlePaymentIntentCanceled(event, paymentIntent);
      }
      case "charge.refunded": {
        const charge = event.data.object as Stripe.Charge;
        return this.handleChargeRefunded(event, charge);
      }
      default:
        return {
          outcome: "ignored",
          eventId: event.id,
          eventType: event.type,
          reason: "event_not_supported",
        };
    }
  }

  private async emitAdminPaymentFailedNotification(
    pagoId: string,
    ordenId: string,
  ): Promise<void> {
    try {
      const { default: adminNotificationService } = await import(
        "./admin-notification.service"
      );
      await adminNotificationService.notifyPaymentFailed(ordenId, pagoId);
    } catch (error) {
      console.error("admin_notification_payment_failed_emit_error", {
        pagoId,
        ordenId,
        message: error instanceof Error ? error.message : error,
      });
    }
  }

  private async recordWebhookEventIfNotFinalized(
    pagoRef: FirebaseFirestore.DocumentReference,
    eventId: string,
    pagoData: Pago,
    ordenData?: Orden,
  ): Promise<boolean> {
    if (
      pagoData.estado !== EstadoPago.COMPLETADO &&
      ordenData?.estado !== EstadoOrden.CONFIRMADA
    ) {
      return false;
    }

    const now = admin.firestore.Timestamp.now();

    await firestoreTienda.runTransaction(async (tx) => {
      const pagoSnapshot = await tx.get(pagoRef);
      if (!pagoSnapshot.exists) {
        return;
      }

      const latestPago = pagoSnapshot.data() as Pago;
      if (latestPago.webhookEventIdsProcesados?.includes(eventId)) {
        return;
      }

      tx.update(pagoRef, {
        webhookEventIdsProcesados: admin.firestore.FieldValue.arrayUnion(
          eventId,
        ),
        updatedAt: now,
      });
    });

    return true;
  }

  private async handlePaymentIntentSucceeded(
    event: Stripe.Event,
    paymentIntent: Stripe.PaymentIntent,
  ): Promise<StripeWebhookProcessResult> {
    const pagoMatch = await this.resolvePagoFromPaymentIntent(paymentIntent);

    if (!pagoMatch) {
      return {
        outcome: "unmatched",
        eventId: event.id,
        eventType: event.type,
        reason: "pago_not_found_by_payment_intent",
      };
    }

    if (!pagoMatch.ordenRef) {
      const initialPagoDoc = await pagoMatch.pagoRef.get();
      const initialPagoData = initialPagoDoc.data() as Pago;
      const checkoutAttemptId =
        pagoMatch.checkoutAttemptId ||
        initialPagoData.checkoutAttemptId ||
        getMetadataString(paymentIntent.metadata, "checkoutAttemptId");

      if (checkoutAttemptId) {
        return this.handlePaymentIntentSucceededForCheckoutAttempt(
          event,
          paymentIntent,
          pagoMatch,
          checkoutAttemptId,
          initialPagoData,
        );
      }

      throw new ApiError(
        404,
        "Orden no encontrada al procesar webhook de PaymentIntent",
      );
    }
    const ordenRef = pagoMatch.ordenRef;

    const ordenSnapshot = await ordenRef.get();
    const ordenDataForValidation = ordenSnapshot.data() as Orden | undefined;
    if (!ordenDataForValidation) {
      throw new ApiError(404, "Orden no encontrada al procesar webhook");
    }

    const initialPagoDoc = await pagoMatch.pagoRef.get();
    const initialPagoData = initialPagoDoc.data() as Pago;

    if (
      await this.recordWebhookEventIfNotFinalized(
        pagoMatch.pagoRef,
        event.id,
        initialPagoData,
        ordenDataForValidation,
      )
    ) {
      return {
        outcome: "processed",
        eventId: event.id,
        eventType: event.type,
        pagoId: pagoMatch.pagoId,
        ordenId: pagoMatch.ordenId,
        reason: "payment_already_finalized",
      };
    }

    this.assertStripeAmountMatchesOrder(
      paymentIntent.amount,
      ordenDataForValidation,
      {
        eventId: event.id,
        pagoId: pagoMatch.pagoId,
        ordenId: pagoMatch.ordenId,
        source: "payment_intent.succeeded",
      },
    );

    const now = admin.firestore.Timestamp.now();

    await firestoreTienda.runTransaction(async (tx) => {
      const pagoSnapshot = await tx.get(pagoMatch.pagoRef);
      if (!pagoSnapshot.exists) {
        throw new ApiError(404, "Pago no encontrado al procesar webhook");
      }

      const pagoData = pagoSnapshot.data() as Pago;
      if (pagoData.webhookEventIdsProcesados?.includes(event.id)) {
        return;
      }
      const ordenSnapshotTx = await tx.get(ordenRef);
      const ordenData = ordenSnapshotTx.data() as Orden | undefined;

      tx.update(pagoMatch.pagoRef, {
        estado: EstadoPago.COMPLETADO,
        status: PaymentStatus.PAID,
        providerStatus: paymentIntent.status,
        paymentIntentId: paymentIntent.id,
        stripeCustomerId:
          typeof paymentIntent.customer === "string"
            ? paymentIntent.customer
            : pagoData.stripeCustomerId,
        fechaPago: now,
        failureCode: admin.firestore.FieldValue.delete(),
        failureMessage: admin.firestore.FieldValue.delete(),
        rawEventId: event.id,
        webhookEventIdsProcesados: admin.firestore.FieldValue.arrayUnion(
          event.id,
        ),
        updatedAt: now,
      });

      tx.update(ordenRef, {
        estado: EstadoOrden.CONFIRMADA,
        ...this.buildManualFedexPaidOrderPatch(ordenData),
        stripePaymentIntentId: paymentIntent.id,
        stripeCustomerId:
          typeof paymentIntent.customer === "string"
            ? paymentIntent.customer
            : undefined,
        updatedAt: now,
      });
    });

    const orderSnapshot = await ordenRef.get();
    const orderData = orderSnapshot.data() as Orden | undefined;
    await pickupOrderService.finalizePaidPickupOrder({
      orderId: pagoMatch.ordenId,
      source: "stripe",
      sourceEventId: event.id,
    });
    await paidOrderFinalizerService.finalizePaidOrder({
      orderId: pagoMatch.ordenId,
      provider: "stripe",
      sourceEventId: event.id,
    });
    if (orderData?.usuarioId) {
      await this.enqueueOrderConfirmedNotification(
        pagoMatch.ordenId,
        orderData.usuarioId,
        {
          paymentIntentId: paymentIntent.id,
          providerStatus: paymentIntent.status,
        },
      );
    }

    return {
      outcome: "processed",
      eventId: event.id,
      eventType: event.type,
      pagoId: pagoMatch.pagoId,
      ordenId: pagoMatch.ordenId,
    };
  }

  private async handlePaymentIntentFailed(
    event: Stripe.Event,
    paymentIntent: Stripe.PaymentIntent,
  ): Promise<StripeWebhookProcessResult> {
    const pagoMatch = await this.resolvePagoFromPaymentIntent(paymentIntent);

    if (!pagoMatch) {
      return {
        outcome: "unmatched",
        eventId: event.id,
        eventType: event.type,
        reason: "pago_not_found_by_payment_intent",
      };
    }

    const failureCode =
      paymentIntent.last_payment_error?.code || "payment_failed";
    const failureMessage =
      paymentIntent.last_payment_error?.message ||
      "Stripe reporto fallo al confirmar el pago";

    if (!pagoMatch.ordenRef) {
      if (pagoMatch.checkoutAttemptId) {
        const { default: checkoutAttemptService } = await import(
          "./checkout/checkout-attempt.service"
        );
        await checkoutAttemptService.releaseAttempt(
          pagoMatch.checkoutAttemptId,
          "PaymentIntent fallido",
          { failureCode },
        );
      }
      return {
        outcome: "processed",
        eventId: event.id,
        eventType: event.type,
        pagoId: pagoMatch.pagoId,
        reason: "checkout_attempt_payment_failed",
      };
    }
    const ordenRef = pagoMatch.ordenRef;

    const now = admin.firestore.Timestamp.now();

    await firestoreTienda.runTransaction(async (tx) => {
      const pagoSnapshot = await tx.get(pagoMatch.pagoRef);
      if (!pagoSnapshot.exists) {
        throw new ApiError(404, "Pago no encontrado al procesar webhook");
      }

      const pagoData = pagoSnapshot.data() as Pago;
      if (pagoData.webhookEventIdsProcesados?.includes(event.id)) {
        return;
      }
      tx.update(pagoMatch.pagoRef, {
        estado: EstadoPago.FALLIDO,
        providerStatus: paymentIntent.status,
        paymentIntentId: paymentIntent.id,
        stripeCustomerId:
          typeof paymentIntent.customer === "string"
            ? paymentIntent.customer
            : pagoData.stripeCustomerId,
        failureCode,
        failureMessage,
        rawEventId: event.id,
        webhookEventIdsProcesados: admin.firestore.FieldValue.arrayUnion(
          event.id,
        ),
        updatedAt: now,
      });

      tx.update(ordenRef, {
        estado: EstadoOrden.PENDIENTE,
        paymentStatus: PaymentState.FALLIDO,
        stripePaymentIntentId: paymentIntent.id,
        stripeCustomerId:
          typeof paymentIntent.customer === "string"
            ? paymentIntent.customer
            : undefined,
        updatedAt: now,
      });
    });

    await ordenService.releaseUnpaidOrder(pagoMatch.ordenId);
    await this.emitAdminPaymentFailedNotification(
      pagoMatch.pagoId,
      pagoMatch.ordenId,
    );

    return {
      outcome: "processed",
      eventId: event.id,
      eventType: event.type,
      pagoId: pagoMatch.pagoId,
      ordenId: pagoMatch.ordenId,
    };
  }

  private async handlePaymentIntentSucceededForCheckoutAttempt(
    event: Stripe.Event,
    paymentIntent: Stripe.PaymentIntent,
    pagoMatch: {
      pagoId: string;
      pagoRef: FirebaseFirestore.DocumentReference;
    },
    checkoutAttemptId: string,
    initialPagoData: Pago,
  ): Promise<StripeWebhookProcessResult> {
    if (
      initialPagoData.webhookEventIdsProcesados?.includes(event.id) ||
      initialPagoData.estado === EstadoPago.COMPLETADO
    ) {
      return {
        outcome: "processed",
        eventId: event.id,
        eventType: event.type,
        pagoId: pagoMatch.pagoId,
        reason: "checkout_attempt_payment_already_finalized",
      };
    }

    this.assertStripeAmountMatchesPago(paymentIntent.amount, initialPagoData, {
      eventId: event.id,
      pagoId: pagoMatch.pagoId,
      checkoutAttemptId,
      source: "payment_intent.succeeded",
    });

    const now = admin.firestore.Timestamp.now();
    const { default: checkoutAttemptService } = await import(
      "./checkout/checkout-attempt.service"
    );

    const orderId = await checkoutAttemptService.finalizePaidFromWebhook({
      checkoutAttemptId,
      pagoId: pagoMatch.pagoId,
      eventId: event.id,
    });

    await pagoMatch.pagoRef.set(
      {
        estado: EstadoPago.COMPLETADO,
        status: PaymentStatus.PAID,
        providerStatus: paymentIntent.status,
        paymentIntentId: paymentIntent.id,
        stripeCustomerId:
          typeof paymentIntent.customer === "string"
            ? paymentIntent.customer
            : initialPagoData.stripeCustomerId,
        fechaPago: now,
        failureCode: admin.firestore.FieldValue.delete(),
        failureMessage: admin.firestore.FieldValue.delete(),
        rawEventId: event.id,
        webhookEventIdsProcesados: admin.firestore.FieldValue.arrayUnion(
          event.id,
        ),
        updatedAt: now,
      },
      { merge: true },
    );

    console.log("stripe_checkout_attempt_paid_via_payment_intent", {
      checkoutAttemptId,
      orderId,
      pagoId: pagoMatch.pagoId,
      eventId: event.id,
    });

    return {
      outcome: "processed",
      eventId: event.id,
      eventType: event.type,
      pagoId: pagoMatch.pagoId,
      ordenId: orderId,
      reason: "checkout_attempt_finalized_via_payment_intent",
    };
  }

  private async handleCheckoutAttemptSessionEvent(
    event: Stripe.Event,
    session: Stripe.Checkout.Session,
    pagoMatch: {
      pagoId: string;
      pagoRef: FirebaseFirestore.DocumentReference;
    },
    checkoutAttemptId: string,
  ): Promise<StripeWebhookProcessResult> {
    const now = admin.firestore.Timestamp.now();
    const { default: checkoutAttemptService } = await import(
      "./checkout/checkout-attempt.service"
    );

    if (
      event.type === "checkout.session.expired" ||
      event.type === "checkout.session.async_payment_failed"
    ) {
      await checkoutAttemptService.releaseAttempt(
        checkoutAttemptId,
        `Webhook Stripe: ${event.type}`,
        {
          status:
            event.type === "checkout.session.expired"
              ? undefined
              : undefined,
          failureCode: event.type,
        },
      );
      await pagoMatch.pagoRef.set(
        {
          estado: EstadoPago.FALLIDO,
          status:
            event.type === "checkout.session.expired"
              ? PaymentStatus.EXPIRED
              : PaymentStatus.FAILED,
          updatedAt: now,
        },
        { merge: true },
      );
      return {
        outcome: "processed",
        eventId: event.id,
        eventType: event.type,
        pagoId: pagoMatch.pagoId,
        reason: "checkout_attempt_released",
      };
    }

    if (session.payment_status !== "paid") {
      await firestoreTienda.runTransaction(async (tx) => {
        const pagoSnapshot = await tx.get(pagoMatch.pagoRef);
        if (!pagoSnapshot.exists) {
          return;
        }
        const pagoData = pagoSnapshot.data() as Pago;
        if (pagoData.webhookEventIdsProcesados?.includes(event.id)) {
          return;
        }
        tx.update(pagoMatch.pagoRef, {
          estado: EstadoPago.PROCESANDO,
          status: PaymentStatus.PENDING_CUSTOMER,
          providerStatus: session.payment_status || "unpaid",
          rawEventId: event.id,
          webhookEventIdsProcesados: admin.firestore.FieldValue.arrayUnion(
            event.id,
          ),
          updatedAt: now,
        });
      });
      return {
        outcome: "processed",
        eventId: event.id,
        eventType: event.type,
        pagoId: pagoMatch.pagoId,
        reason: "checkout_attempt_payment_pending",
      };
    }

    const orderId = await checkoutAttemptService.finalizePaidFromWebhook({
      checkoutAttemptId,
      pagoId: pagoMatch.pagoId,
      eventId: event.id,
    });

    await pagoMatch.pagoRef.set(
      {
        estado: EstadoPago.COMPLETADO,
        status: PaymentStatus.PAID,
        providerStatus: session.payment_status || "paid",
        checkoutSessionId: session.id,
        paymentIntentId:
          typeof session.payment_intent === "string"
            ? session.payment_intent
            : undefined,
        fechaPago: now,
        rawEventId: event.id,
        webhookEventIdsProcesados: admin.firestore.FieldValue.arrayUnion(
          event.id,
        ),
        updatedAt: now,
      },
      { merge: true },
    );

    console.log("stripe_checkout_attempt_paid", {
      checkoutAttemptId,
      orderId,
      pagoId: pagoMatch.pagoId,
      eventId: event.id,
    });

    return {
      outcome: "processed",
      eventId: event.id,
      eventType: event.type,
      pagoId: pagoMatch.pagoId,
      ordenId: orderId,
    };
  }

  private async handleCheckoutSuccess(
    event: Stripe.Event,
    session: Stripe.Checkout.Session,
  ): Promise<StripeWebhookProcessResult> {
    const pagoMatch = await this.resolvePagoFromCheckoutSession(session);

    if (!pagoMatch) {
      return {
        outcome: "unmatched",
        eventId: event.id,
        eventType: event.type,
        reason: "pago_not_found_by_checkout_session",
      };
    }

    const initialPagoDoc = await pagoMatch.pagoRef.get();
    const initialPagoData = initialPagoDoc.data() as Pago;
    const checkoutAttemptId =
      pagoMatch.checkoutAttemptId ||
      initialPagoData.checkoutAttemptId ||
      getMetadataString(session.metadata, "checkoutAttemptId");

    if (checkoutAttemptId && !pagoMatch.ordenId) {
      return this.handleCheckoutAttemptSessionEvent(
        event,
        session,
        pagoMatch,
        checkoutAttemptId,
      );
    }

    if (!pagoMatch.ordenRef) {
      throw new ApiError(404, "Orden no encontrada al procesar webhook");
    }

    if (session.payment_status !== "paid") {
      const now = admin.firestore.Timestamp.now();

      await firestoreTienda.runTransaction(async (tx) => {
        const pagoSnapshot = await tx.get(pagoMatch.pagoRef);
        if (!pagoSnapshot.exists) {
          throw new ApiError(404, "Pago no encontrado al procesar webhook");
        }

        const pagoData = pagoSnapshot.data() as Pago;
        if (pagoData.webhookEventIdsProcesados?.includes(event.id)) {
          return;
        }

        tx.update(pagoMatch.pagoRef, {
          estado: EstadoPago.PROCESANDO,
          status: PaymentStatus.PENDING_CUSTOMER,
          providerStatus: session.payment_status || "unpaid",
          checkoutSessionId: session.id,
          paymentIntentId:
            typeof session.payment_intent === "string"
              ? session.payment_intent
              : pagoData.paymentIntentId,
          stripeCustomerId:
            typeof session.customer === "string"
              ? session.customer
              : pagoData.stripeCustomerId,
          rawEventId: event.id,
          webhookEventIdsProcesados: admin.firestore.FieldValue.arrayUnion(
            event.id,
          ),
          updatedAt: now,
        });
      });

      return {
        outcome: "processed",
        eventId: event.id,
        eventType: event.type,
        pagoId: pagoMatch.pagoId,
        ordenId: pagoMatch.ordenId,
        reason: "checkout_completed_payment_pending",
      };
    }

    if (!pagoMatch.ordenRef) {
      throw new ApiError(
        404,
        "Orden no encontrada al procesar webhook de PaymentIntent",
      );
    }
    const ordenRef = pagoMatch.ordenRef;

    const ordenSnapshot = await ordenRef.get();
    const ordenDataForValidation = ordenSnapshot.data() as Orden | undefined;
    if (!ordenDataForValidation) {
      throw new ApiError(404, "Orden no encontrada al procesar webhook");
    }

    if (
      await this.recordWebhookEventIfNotFinalized(
        pagoMatch.pagoRef,
        event.id,
        initialPagoData,
        ordenDataForValidation,
      )
    ) {
      return {
        outcome: "processed",
        eventId: event.id,
        eventType: event.type,
        pagoId: pagoMatch.pagoId,
        ordenId: pagoMatch.ordenId,
        reason: "payment_already_finalized",
      };
    }

    this.assertStripeAmountMatchesOrder(
      session.amount_total,
      ordenDataForValidation,
      {
        eventId: event.id,
        pagoId: pagoMatch.pagoId,
        ordenId: pagoMatch.ordenId,
        source: event.type,
      },
    );

    const now = admin.firestore.Timestamp.now();

    await firestoreTienda.runTransaction(async (tx) => {
      const pagoSnapshot = await tx.get(pagoMatch.pagoRef);
      if (!pagoSnapshot.exists) {
        throw new ApiError(404, "Pago no encontrado al procesar webhook");
      }

      const pagoData = pagoSnapshot.data() as Pago;
      if (pagoData.webhookEventIdsProcesados?.includes(event.id)) {
        return;
      }
      const ordenSnapshotTx = await tx.get(ordenRef);
      const ordenData = ordenSnapshotTx.data() as Orden | undefined;

      tx.update(pagoMatch.pagoRef, {
        estado: EstadoPago.COMPLETADO,
        status: PaymentStatus.PAID,
        providerStatus: session.payment_status || "paid",
        checkoutSessionId: session.id,
        paymentIntentId:
          typeof session.payment_intent === "string"
            ? session.payment_intent
            : pagoData.paymentIntentId,
        stripeCustomerId:
          typeof session.customer === "string"
            ? session.customer
            : pagoData.stripeCustomerId,
        fechaPago: now,
        failureCode: admin.firestore.FieldValue.delete(),
        failureMessage: admin.firestore.FieldValue.delete(),
        rawEventId: event.id,
        webhookEventIdsProcesados: admin.firestore.FieldValue.arrayUnion(
          event.id,
        ),
        updatedAt: now,
      });

      tx.update(ordenRef, {
        estado: EstadoOrden.CONFIRMADA,
        ...this.buildManualFedexPaidOrderPatch(ordenData),
        stripeCheckoutSessionId: session.id,
        stripePaymentIntentId:
          typeof session.payment_intent === "string"
            ? session.payment_intent
            : undefined,
        stripeCustomerId:
          typeof session.customer === "string" ? session.customer : undefined,
        updatedAt: now,
      });
    });

    const orderSnapshot = await ordenRef.get();
    const orderData = orderSnapshot.data() as Orden | undefined;
    await pickupOrderService.finalizePaidPickupOrder({
      orderId: pagoMatch.ordenId,
      source: "stripe",
      sourceEventId: event.id,
    });
    await paidOrderFinalizerService.finalizePaidOrder({
      orderId: pagoMatch.ordenId,
      provider: "stripe",
      sourceEventId: event.id,
    });
    if (orderData?.usuarioId) {
      await this.enqueueOrderConfirmedNotification(
        pagoMatch.ordenId,
        orderData.usuarioId,
        {
          checkoutSessionId: session.id,
          paymentIntentId:
            typeof session.payment_intent === "string"
              ? session.payment_intent
              : undefined,
          providerStatus: session.payment_status || "paid",
        },
      );
    }

    return {
      outcome: "processed",
      eventId: event.id,
      eventType: event.type,
      pagoId: pagoMatch.pagoId,
      ordenId: pagoMatch.ordenId,
    };
  }

  private async handleCheckoutFailed(
    event: Stripe.Event,
    session: Stripe.Checkout.Session,
  ): Promise<StripeWebhookProcessResult> {
    const pagoMatch = await this.resolvePagoFromCheckoutSession(session);

    if (!pagoMatch) {
      return {
        outcome: "unmatched",
        eventId: event.id,
        eventType: event.type,
        reason: "pago_not_found_by_checkout_session",
      };
    }

    const initialPagoDoc = await pagoMatch.pagoRef.get();
    const checkoutAttemptId =
      pagoMatch.checkoutAttemptId ||
      (initialPagoDoc.data() as Pago).checkoutAttemptId ||
      getMetadataString(session.metadata, "checkoutAttemptId");

    if (checkoutAttemptId && !pagoMatch.ordenId) {
      return this.handleCheckoutAttemptSessionEvent(
        event,
        session,
        pagoMatch,
        checkoutAttemptId,
      );
    }

    if (!pagoMatch.ordenRef) {
      throw new ApiError(404, "Orden no encontrada al procesar webhook");
    }
    const ordenRef = pagoMatch.ordenRef;

    const now = admin.firestore.Timestamp.now();

    await firestoreTienda.runTransaction(async (tx) => {
      const pagoSnapshot = await tx.get(pagoMatch.pagoRef);
      if (!pagoSnapshot.exists) {
        throw new ApiError(404, "Pago no encontrado al procesar webhook");
      }

      const pagoData = pagoSnapshot.data() as Pago;
      if (pagoData.webhookEventIdsProcesados?.includes(event.id)) {
        return;
      }

      tx.update(pagoMatch.pagoRef, {
        estado: EstadoPago.FALLIDO,
        providerStatus: session.payment_status || "failed",
        checkoutSessionId: session.id,
        paymentIntentId:
          typeof session.payment_intent === "string"
            ? session.payment_intent
            : pagoData.paymentIntentId,
        stripeCustomerId:
          typeof session.customer === "string"
            ? session.customer
            : pagoData.stripeCustomerId,
        failureCode: "checkout_async_payment_failed",
        failureMessage: "Stripe reporto fallo en el pago async de Checkout",
        rawEventId: event.id,
        webhookEventIdsProcesados: admin.firestore.FieldValue.arrayUnion(
          event.id,
        ),
        updatedAt: now,
      });

      tx.update(ordenRef, {
        estado: EstadoOrden.PENDIENTE,
        stripeCheckoutSessionId: session.id,
        stripePaymentIntentId:
          typeof session.payment_intent === "string"
            ? session.payment_intent
            : undefined,
        stripeCustomerId:
          typeof session.customer === "string" ? session.customer : undefined,
        updatedAt: now,
      });
    });

    await ordenService.releaseUnpaidOrder(pagoMatch.ordenId);
    await this.emitAdminPaymentFailedNotification(
      pagoMatch.pagoId,
      pagoMatch.ordenId,
    );

    return {
      outcome: "processed",
      eventId: event.id,
      eventType: event.type,
      pagoId: pagoMatch.pagoId,
      ordenId: pagoMatch.ordenId,
    };
  }

  private async handleCheckoutExpired(
    event: Stripe.Event,
    session: Stripe.Checkout.Session,
  ): Promise<StripeWebhookProcessResult> {
    const pagoMatch = await this.resolvePagoFromCheckoutSession(session);

    if (!pagoMatch) {
      return {
        outcome: "unmatched",
        eventId: event.id,
        eventType: event.type,
        reason: "pago_not_found_by_checkout_session",
      };
    }

    const initialPagoDoc = await pagoMatch.pagoRef.get();
    const checkoutAttemptId =
      pagoMatch.checkoutAttemptId ||
      (initialPagoDoc.data() as Pago).checkoutAttemptId ||
      getMetadataString(session.metadata, "checkoutAttemptId");

    if (checkoutAttemptId && !pagoMatch.ordenId) {
      return this.handleCheckoutAttemptSessionEvent(
        event,
        session,
        pagoMatch,
        checkoutAttemptId,
      );
    }

    if (!pagoMatch.ordenRef) {
      throw new ApiError(404, "Orden no encontrada al procesar webhook");
    }
    const ordenRef = pagoMatch.ordenRef;

    const now = admin.firestore.Timestamp.now();

    await firestoreTienda.runTransaction(async (tx) => {
      const pagoSnapshot = await tx.get(pagoMatch.pagoRef);
      if (!pagoSnapshot.exists) {
        throw new ApiError(404, "Pago no encontrado al procesar webhook");
      }

      const pagoData = pagoSnapshot.data() as Pago;
      if (pagoData.webhookEventIdsProcesados?.includes(event.id)) {
        return;
      }

      tx.update(pagoMatch.pagoRef, {
        estado: EstadoPago.FALLIDO,
        status: PaymentStatus.EXPIRED,
        providerStatus: session.status || "expired",
        checkoutSessionId: session.id,
        failureCode: "checkout_session_expired",
        failureMessage: "La sesión de Stripe Checkout expiró sin completar el pago",
        rawEventId: event.id,
        webhookEventIdsProcesados: admin.firestore.FieldValue.arrayUnion(
          event.id,
        ),
        updatedAt: now,
      });

      tx.update(ordenRef, {
        estado: EstadoOrden.PENDIENTE,
        paymentStatus: PaymentState.PENDIENTE,
        stripeCheckoutSessionId: session.id,
        updatedAt: now,
      });
    });

    await ordenService.releaseUnpaidOrder(pagoMatch.ordenId);
    await this.emitAdminPaymentFailedNotification(
      pagoMatch.pagoId,
      pagoMatch.ordenId,
    );

    return {
      outcome: "processed",
      eventId: event.id,
      eventType: event.type,
      pagoId: pagoMatch.pagoId,
      ordenId: pagoMatch.ordenId,
      reason: "checkout_session_expired",
    };
  }

  private async handlePaymentIntentCanceled(
    event: Stripe.Event,
    paymentIntent: Stripe.PaymentIntent,
  ): Promise<StripeWebhookProcessResult> {
    const pagoMatch = await this.resolvePagoFromPaymentIntent(paymentIntent);

    if (!pagoMatch) {
      return {
        outcome: "unmatched",
        eventId: event.id,
        eventType: event.type,
        reason: "pago_not_found_by_payment_intent",
      };
    }

    if (!pagoMatch.ordenRef) {
      return {
        outcome: "processed",
        eventId: event.id,
        eventType: event.type,
        pagoId: pagoMatch.pagoId,
        reason: "checkout_attempt_payment_canceled",
      };
    }
    const ordenRef = pagoMatch.ordenRef;

    const now = admin.firestore.Timestamp.now();

    await firestoreTienda.runTransaction(async (tx) => {
      const pagoSnapshot = await tx.get(pagoMatch.pagoRef);
      if (!pagoSnapshot.exists) {
        throw new ApiError(404, "Pago no encontrado al procesar webhook");
      }

      const pagoData = pagoSnapshot.data() as Pago;
      if (pagoData.webhookEventIdsProcesados?.includes(event.id)) {
        return;
      }

      tx.update(pagoMatch.pagoRef, {
        estado: EstadoPago.FALLIDO,
        status: PaymentStatus.CANCELED,
        providerStatus: paymentIntent.status,
        paymentIntentId: paymentIntent.id,
        failureCode: "payment_intent_canceled",
        failureMessage: "El intento de pago fue cancelado en Stripe",
        rawEventId: event.id,
        webhookEventIdsProcesados: admin.firestore.FieldValue.arrayUnion(
          event.id,
        ),
        updatedAt: now,
      });

      tx.update(ordenRef, {
        estado: EstadoOrden.PENDIENTE,
        paymentStatus: PaymentState.PENDIENTE,
        stripePaymentIntentId: paymentIntent.id,
        updatedAt: now,
      });
    });

    await ordenService.releaseUnpaidOrder(pagoMatch.ordenId);
    await this.emitAdminPaymentFailedNotification(
      pagoMatch.pagoId,
      pagoMatch.ordenId,
    );

    return {
      outcome: "processed",
      eventId: event.id,
      eventType: event.type,
      pagoId: pagoMatch.pagoId,
      ordenId: pagoMatch.ordenId,
      reason: "payment_intent_canceled",
    };
  }

  private async handleChargeRefunded(
    event: Stripe.Event,
    charge: Stripe.Charge,
  ): Promise<StripeWebhookProcessResult> {
    const pagoMatch = await this.resolvePagoFromRefundCharge(charge);

    if (!pagoMatch) {
      return {
        outcome: "unmatched",
        eventId: event.id,
        eventType: event.type,
        reason: "pago_not_found_by_refund_charge",
      };
    }

    if (!pagoMatch.ordenRef) {
      return {
        outcome: "processed",
        eventId: event.id,
        eventType: event.type,
        pagoId: pagoMatch.pagoId,
        reason: "checkout_attempt_refund_without_order",
      };
    }
    const ordenRef = pagoMatch.ordenRef;

    const refundData = charge.refunds?.data?.[0];
    const now = admin.firestore.Timestamp.now();

    await firestoreTienda.runTransaction(async (tx) => {
      const pagoSnapshot = await tx.get(pagoMatch.pagoRef);
      if (!pagoSnapshot.exists) {
        throw new ApiError(404, "Pago no encontrado al procesar webhook");
      }

      const pagoData = pagoSnapshot.data() as Pago;
      if (pagoData.webhookEventIdsProcesados?.includes(event.id)) {
        return;
      }

      tx.update(pagoMatch.pagoRef, {
        estado: EstadoPago.REEMBOLSADO,
        providerStatus: charge.status || "refunded",
        paymentIntentId:
          typeof charge.payment_intent === "string"
            ? charge.payment_intent
            : pagoData.paymentIntentId,
        stripeCustomerId:
          typeof charge.customer === "string"
            ? charge.customer
            : pagoData.stripeCustomerId,
        refundId: refundData?.id,
        refundAmount:
          typeof charge.amount_refunded === "number"
            ? charge.amount_refunded / 100
            : undefined,
        refundReason:
          refundData?.reason ||
          (charge.refunded ? "refund_processed_by_stripe" : undefined),
        rawEventId: event.id,
        webhookEventIdsProcesados: admin.firestore.FieldValue.arrayUnion(
          event.id,
        ),
        updatedAt: now,
      });

      tx.update(ordenRef, {
        estado: EstadoOrden.CANCELADA,
        paymentStatus: PaymentState.REEMBOLSADO,
        stripePaymentIntentId:
          typeof charge.payment_intent === "string"
            ? charge.payment_intent
            : undefined,
        stripeCustomerId:
          typeof charge.customer === "string" ? charge.customer : undefined,
        updatedAt: now,
      });
    });

    return {
      outcome: "processed",
      eventId: event.id,
      eventType: event.type,
      pagoId: pagoMatch.pagoId,
      ordenId: pagoMatch.ordenId,
    };
  }

  private async resolvePagoFromPaymentIntent(
    paymentIntent: Stripe.PaymentIntent,
  ): Promise<{
    pagoId: string;
    ordenId: string;
    checkoutAttemptId?: string;
    pagoRef: FirebaseFirestore.DocumentReference;
    ordenRef: FirebaseFirestore.DocumentReference | null;
  } | null> {
    const byIntent = await this.findPagoByField(
      "paymentIntentId",
      paymentIntent.id,
    );
    if (byIntent) {
      return byIntent;
    }

    const pagoIdFromMetadata = getMetadataString(
      paymentIntent.metadata,
      "pagoId",
    );
    if (!pagoIdFromMetadata) {
      return null;
    }

    return this.findPagoById(pagoIdFromMetadata);
  }

  private async resolvePagoFromCheckoutSession(
    session: Stripe.Checkout.Session,
  ): Promise<{
    pagoId: string;
    ordenId: string;
    checkoutAttemptId?: string;
    pagoRef: FirebaseFirestore.DocumentReference;
    ordenRef: FirebaseFirestore.DocumentReference | null;
  } | null> {
    const byCheckoutSession = await this.findPagoByField(
      "checkoutSessionId",
      session.id,
    );
    if (byCheckoutSession) {
      return byCheckoutSession;
    }

    const pagoIdFromMetadata = getMetadataString(session.metadata, "pagoId");
    if (pagoIdFromMetadata) {
      const byMetadataPagoId = await this.findPagoById(pagoIdFromMetadata);
      if (byMetadataPagoId) {
        return byMetadataPagoId;
      }
    }

    if (typeof session.payment_intent === "string") {
      return this.findPagoByField("paymentIntentId", session.payment_intent);
    }

    return null;
  }

  private async resolvePagoFromRefundCharge(charge: Stripe.Charge): Promise<{
    pagoId: string;
    ordenId: string;
    checkoutAttemptId?: string;
    pagoRef: FirebaseFirestore.DocumentReference;
    ordenRef: FirebaseFirestore.DocumentReference | null;
  } | null> {
    if (typeof charge.payment_intent === "string") {
      const byIntent = await this.findPagoByField(
        "paymentIntentId",
        charge.payment_intent,
      );
      if (byIntent) {
        return byIntent;
      }
    }

    return null;
  }

  private async findPagoByField(
    field: "paymentIntentId" | "checkoutSessionId",
    value: string,
  ): Promise<{
    pagoId: string;
    ordenId: string;
    checkoutAttemptId?: string;
    pagoRef: FirebaseFirestore.DocumentReference;
    ordenRef: FirebaseFirestore.DocumentReference | null;
  } | null> {
    const snapshot = await firestoreTienda
      .collection(COLECCION_PAGOS)
      .where(field, "==", value)
      .limit(1)
      .get();

    if (snapshot.empty) {
      return null;
    }

    const pagoDoc = snapshot.docs[0];
    const pagoData = pagoDoc.data() as Pago;

    if (!pagoData.ordenId && !pagoData.checkoutAttemptId) {
      return null;
    }

    return {
      pagoId: pagoDoc.id,
      ordenId: pagoData.ordenId || "",
      checkoutAttemptId: pagoData.checkoutAttemptId,
      pagoRef: pagoDoc.ref,
      ordenRef: pagoData.ordenId
        ? firestoreTienda.collection(ORDENES_COLLECTION).doc(pagoData.ordenId)
        : null,
    };
  }

  private async findPagoById(pagoId: string): Promise<{
    pagoId: string;
    ordenId: string;
    checkoutAttemptId?: string;
    pagoRef: FirebaseFirestore.DocumentReference;
    ordenRef: FirebaseFirestore.DocumentReference | null;
  } | null> {
    const pagoRef = firestoreTienda.collection(COLECCION_PAGOS).doc(pagoId);
    const pagoDoc = await pagoRef.get();

    if (!pagoDoc.exists) {
      return null;
    }

    const pagoData = pagoDoc.data() as Pago;
    if (!pagoData.ordenId && !pagoData.checkoutAttemptId) {
      return null;
    }

    return {
      pagoId: pagoDoc.id,
      ordenId: pagoData.ordenId || "",
      checkoutAttemptId: pagoData.checkoutAttemptId,
      pagoRef,
      ordenRef: pagoData.ordenId
        ? firestoreTienda.collection(ORDENES_COLLECTION).doc(pagoData.ordenId)
        : null,
    };
  }
}

const pagoService = new PagoService();
export default pagoService;
