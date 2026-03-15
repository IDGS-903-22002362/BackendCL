import Stripe from "stripe";
import { firestoreTienda } from "../config/firebase";
import { admin } from "../config/firebase.admin";
import { firestoreApp } from "../config/app.firebase";
import { EstadoOrden, MetodoPago, Orden } from "../models/orden.model";
import {
  COLECCION_PAGOS,
  EstadoPago,
  Pago,
  ProveedorPago,
} from "../models/pago.model";
import { RolUsuario } from "../models/usuario.model";
import { ApiError } from "../utils/error-handler";
import {
  buildStripeIdempotencyKey,
  getAppUrl,
  getStripeClient,
  getStripeCurrency,
  getStripePublishableKey,
  getStripeWebhookSecret,
} from "../lib/stripe";

const ORDENES_COLLECTION = "ordenes";
const USERS_APP_COLLECTION = "usuariosApp";
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

export type CreateStripeCheckoutSessionInput = {
  orderId: string;
  userId: string;
  successUrl?: string;
  cancelUrl?: string;
  idempotencyKey?: string;
};

export type CreateStripeCheckoutSessionResult = {
  sessionId: string;
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

    const amount = Math.round(ordenData.total * 100);
    if (amount <= 0) {
      throw new ApiError(409, "La orden tiene un monto invalido para pago");
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
        ? userData.stripeCustomerId
        : undefined;
    if (existingCustomerId && existingCustomerId.trim().length > 0) {
      return existingCustomerId.trim();
    }

    const resolvedPreferred =
      preferredCustomerId && preferredCustomerId.trim().length > 0
        ? preferredCustomerId.trim()
        : undefined;

    if (resolvedPreferred) {
      await userRef.set(
        {
          stripeCustomerId: resolvedPreferred,
          updatedAt: admin.firestore.Timestamp.now(),
        },
        { merge: true },
      );
      return resolvedPreferred;
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
        const cartId =
          typeof ordenData.paymentMetadata?.cartId === "string"
            ? (ordenData.paymentMetadata.cartId as string)
            : undefined;

        const paymentMetadata = cartId
          ? { orderId, userId, cartId }
          : { orderId, userId };

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
          createdAt: now,
          updatedAt: now,
        };

        const pagoRef = await firestoreTienda
          .collection(COLECCION_PAGOS)
          .add(pagoDraft);

        try {
          const paymentIntent = await stripe.paymentIntents.create(
            {
              amount,
              currency,
              customer: stripeCustomerId,
              automatic_payment_methods: { enabled: true },
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
    const { orderId, userId, successUrl, cancelUrl, idempotencyKey } = input;
    const currency = getStripeCurrency();

    const { ordenDoc, ordenData, amount } = await this.getOrderForPayment(
      orderId,
      userId,
    );
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
          return {
            sessionId: existingSession.id,
            url: existingSession.url,
            pagoId: activePagoDoc.id,
            stripeCustomerId: activePago.stripeCustomerId || stripeCustomerId,
            created: false,
          };
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
          return {
            sessionId: existingSession.id,
            url: existingSession.url,
            pagoId: existingDoc.id,
            stripeCustomerId: existingPago.stripeCustomerId || stripeCustomerId,
            created: false,
          };
        }
      }

      const now = admin.firestore.Timestamp.now();
      const cartId =
        typeof ordenData.paymentMetadata?.cartId === "string"
          ? (ordenData.paymentMetadata.cartId as string)
          : undefined;

      const paymentMetadata = cartId
        ? { orderId, userId, cartId }
        : { orderId, userId };

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
      const resolvedCancelUrl = cancelUrl || `${baseUrl}/checkout/cancel`;

      const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] =
        ordenData.items.map((item) => ({
          quantity: item.cantidad,
          price_data: {
            currency,
            unit_amount: Math.round(item.precioUnitario * 100),
            product_data: {
              name: `Producto ${item.productoId}`,
              metadata: {
                productoId: item.productoId,
                tallaId: item.tallaId || "",
              },
            },
          },
        }));

      const session = await stripe.checkout.sessions.create(
        {
          mode: "payment",
          customer: stripeCustomerId,
          line_items: lineItems,
          success_url: resolvedSuccessUrl,
          cancel_url: resolvedCancelUrl,
          metadata: {
            ordenId: orderId,
            userId,
            pagoId: pagoRef.id,
            cartId: cartId || "",
          },
          payment_intent_data: {
            metadata: {
              ordenId: orderId,
              userId,
              pagoId: pagoRef.id,
              cartId: cartId || "",
            },
          },
        },
        { idempotencyKey: resolvedIdempotencyKey },
      );

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
        url: session.url,
        pagoId: pagoRef.id,
        stripeCustomerId,
        created: true,
      };
    });
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
      paymentIntentId:
        typeof session.payment_intent === "string"
          ? session.payment_intent
          : session.payment_intent?.id,
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
        estado: EstadoPago.COMPLETADO,
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

      tx.update(pagoMatch.ordenRef, {
        estado: EstadoOrden.CONFIRMADA,
        stripePaymentIntentId: paymentIntent.id,
        stripeCustomerId:
          typeof paymentIntent.customer === "string"
            ? paymentIntent.customer
            : undefined,
        updatedAt: now,
      });
    });

    const orderSnapshot = await pagoMatch.ordenRef.get();
    const orderData = orderSnapshot.data() as Orden | undefined;
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

      tx.update(pagoMatch.ordenRef, {
        estado: EstadoOrden.PENDIENTE,
        stripePaymentIntentId: paymentIntent.id,
        stripeCustomerId:
          typeof paymentIntent.customer === "string"
            ? paymentIntent.customer
            : undefined,
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
        estado: EstadoPago.COMPLETADO,
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

      tx.update(pagoMatch.ordenRef, {
        estado: EstadoOrden.CONFIRMADA,
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

    const orderSnapshot = await pagoMatch.ordenRef.get();
    const orderData = orderSnapshot.data() as Orden | undefined;
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

      tx.update(pagoMatch.ordenRef, {
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

    return {
      outcome: "processed",
      eventId: event.id,
      eventType: event.type,
      pagoId: pagoMatch.pagoId,
      ordenId: pagoMatch.ordenId,
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

      tx.update(pagoMatch.ordenRef, {
        estado: EstadoOrden.CANCELADA,
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
    pagoRef: FirebaseFirestore.DocumentReference;
    ordenRef: FirebaseFirestore.DocumentReference;
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
    pagoRef: FirebaseFirestore.DocumentReference;
    ordenRef: FirebaseFirestore.DocumentReference;
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
    pagoRef: FirebaseFirestore.DocumentReference;
    ordenRef: FirebaseFirestore.DocumentReference;
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
    pagoRef: FirebaseFirestore.DocumentReference;
    ordenRef: FirebaseFirestore.DocumentReference;
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

    if (!pagoData.ordenId) {
      return null;
    }

    return {
      pagoId: pagoDoc.id,
      ordenId: pagoData.ordenId,
      pagoRef: pagoDoc.ref,
      ordenRef: firestoreTienda
        .collection(ORDENES_COLLECTION)
        .doc(pagoData.ordenId),
    };
  }

  private async findPagoById(pagoId: string): Promise<{
    pagoId: string;
    ordenId: string;
    pagoRef: FirebaseFirestore.DocumentReference;
    ordenRef: FirebaseFirestore.DocumentReference;
  } | null> {
    const pagoRef = firestoreTienda.collection(COLECCION_PAGOS).doc(pagoId);
    const pagoDoc = await pagoRef.get();

    if (!pagoDoc.exists) {
      return null;
    }

    const pagoData = pagoDoc.data() as Pago;
    if (!pagoData.ordenId) {
      return null;
    }

    return {
      pagoId: pagoDoc.id,
      ordenId: pagoData.ordenId,
      pagoRef,
      ordenRef: firestoreTienda
        .collection(ORDENES_COLLECTION)
        .doc(pagoData.ordenId),
    };
  }
}

const pagoService = new PagoService();
export default pagoService;
