import Stripe from "stripe";
import { firestoreTienda } from "../config/firebase";
import { admin } from "../config/firebase.admin";
import { EstadoOrden, MetodoPago, Orden } from "../models/orden.model";
import {
  CURRENCY_DEFAULT,
  COLECCION_PAGOS,
  EstadoPago,
  Pago,
  ProveedorPago,
} from "../models/pago.model";
import { RolUsuario } from "../models/usuario.model";
import { ApiError } from "../utils/error-handler";

const ORDENES_COLLECTION = "ordenes";
const STRIPE_WEBHOOK_EVENTS_COLLECTION = "stripe_webhook_events";

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
  fechaPago?: FirebaseFirestore.Timestamp;
  failureCode?: string;
  failureMessage?: string;
  orden: {
    id: string;
    estado: EstadoOrden;
    total: number;
  };
};

const getStripeClient = (): Stripe => {
  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeSecretKey) {
    throw new ApiError(
      500,
      "La configuracion de pagos no esta disponible en este entorno",
    );
  }

  return new Stripe(stripeSecretKey);
};

const getStripeWebhookSecret = (): string => {
  const stripeWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!stripeWebhookSecret) {
    throw new ApiError(
      500,
      "La configuracion del webhook de Stripe no esta disponible",
    );
  }

  return stripeWebhookSecret;
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

class PagoService {
  private async generateServerIdempotencyKey(
    ordenId: string,
    userId: string,
  ): Promise<string> {
    const pagosSnapshot = await firestoreTienda
      .collection(COLECCION_PAGOS)
      .where("ordenId", "==", ordenId)
      .where("userId", "==", userId)
      .get();

    const attempt = pagosSnapshot.size + 1;
    return `pay_${ordenId}_${userId}_${attempt}`;
  }

  async iniciarPago(input: IniciarPagoInput): Promise<IniciarPagoResult> {
    const { ordenId, userId, metodoPago, idempotencyKey } = input;
    const stripe = getStripeClient();

    const ordenDoc = await firestoreTienda
      .collection(ORDENES_COLLECTION)
      .doc(ordenId)
      .get();

    if (!ordenDoc.exists) {
      throw new ApiError(404, `Orden con ID "${ordenId}" no encontrada`);
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

    if (typeof ordenData.total !== "number" || ordenData.total <= 0) {
      throw new ApiError(409, "La orden tiene un monto invalido para pago");
    }

    const amount = Math.round(ordenData.total * 100);
    if (amount <= 0) {
      throw new ApiError(409, "La orden tiene un monto invalido para pago");
    }

    const pagoActivoSnapshot = await firestoreTienda
      .collection(COLECCION_PAGOS)
      .where("ordenId", "==", ordenId)
      .where("userId", "==", userId)
      .where("estado", "in", ESTADOS_PAGO_ACTIVOS)
      .orderBy("createdAt", "desc")
      .limit(1)
      .get();

    if (!pagoActivoSnapshot.empty) {
      const pagoActivoDoc = pagoActivoSnapshot.docs[0];
      const pagoActivo = pagoActivoDoc.data() as Pago;

      if (!pagoActivo.paymentIntentId) {
        throw new ApiError(
          409,
          "Existe un pago activo inconsistente para esta orden. Revisa el estado antes de reintentar",
        );
      }

      try {
        const paymentIntent = await stripe.paymentIntents.retrieve(
          pagoActivo.paymentIntentId,
        );

        if (!paymentIntent.client_secret) {
          throw new ApiError(
            502,
            "No fue posible recuperar el client secret del intento activo",
          );
        }

        return {
          pagoId: pagoActivoDoc.id,
          paymentIntentId: paymentIntent.id,
          clientSecret: paymentIntent.client_secret,
          status: mapPaymentIntentStatusToEstadoPago(paymentIntent.status),
          created: false,
        };
      } catch (error) {
        console.error("Error al recuperar pago activo por orden", {
          ordenId,
          userId,
          pagoId: pagoActivoDoc.id,
          paymentIntentId: pagoActivo.paymentIntentId,
          error: parseWebhookErrorMessage(error),
        });
        throw new ApiError(
          502,
          "No fue posible reutilizar el intento activo de pago",
        );
      }
    }

    const resolvedIdempotencyKey =
      idempotencyKey || (await this.generateServerIdempotencyKey(ordenId, userId));

    const idemSnapshot = await firestoreTienda
      .collection(COLECCION_PAGOS)
      .where("idempotencyKey", "==", resolvedIdempotencyKey)
      .limit(1)
      .get();

    if (!idemSnapshot.empty) {
      const pagoExistenteDoc = idemSnapshot.docs[0];
      const pagoExistente = pagoExistenteDoc.data() as Pago;

      if (pagoExistente.ordenId !== ordenId || pagoExistente.userId !== userId) {
        throw new ApiError(
          409,
          "La idempotency key ya fue usada en otra operacion de pago",
        );
      }

      if (pagoExistente.estado === EstadoPago.FALLIDO) {
        throw new ApiError(
          409,
          "La idempotency key corresponde a un intento fallido. Usa una nueva",
        );
      }

      if (
        pagoExistente.paymentIntentId &&
        isEstadoReutilizable(pagoExistente.estado)
      ) {
        try {
          const paymentIntent = await stripe.paymentIntents.retrieve(
            pagoExistente.paymentIntentId,
          );
          if (!paymentIntent.client_secret) {
            throw new ApiError(
              502,
              "No fue posible recuperar el client secret del intento existente",
            );
          }

          return {
            pagoId: pagoExistenteDoc.id,
            paymentIntentId: paymentIntent.id,
            clientSecret: paymentIntent.client_secret,
            status: mapPaymentIntentStatusToEstadoPago(paymentIntent.status),
            created: false,
          };
        } catch (error) {
          console.error("Error al recuperar PaymentIntent existente", {
            ordenId,
            userId,
            pagoId: pagoExistenteDoc.id,
            paymentIntentId: pagoExistente.paymentIntentId,
            error: parseWebhookErrorMessage(error),
          });
          throw new ApiError(
            502,
            "No fue posible reutilizar el intento de pago existente",
          );
        }
      }

      throw new ApiError(
        409,
        "La idempotency key ya tiene un intento registrado no reutilizable",
      );
    }

    const now = admin.firestore.Timestamp.now();
    const pagoDraft: Omit<Pago, "id"> = {
      ordenId,
      userId,
      provider: ProveedorPago.STRIPE,
      metodoPago,
      monto: ordenData.total,
      currency: CURRENCY_DEFAULT,
      estado: EstadoPago.PROCESANDO,
      idempotencyKey: resolvedIdempotencyKey,
      createdAt: now,
      updatedAt: now,
    };

    const pagoRef = await firestoreTienda.collection(COLECCION_PAGOS).add(pagoDraft);

    try {
      const paymentIntent = await stripe.paymentIntents.create(
        {
          amount,
          currency: CURRENCY_DEFAULT,
          automatic_payment_methods: { enabled: true },
          metadata: {
            ordenId,
            userId,
            metodoPago,
            pagoId: pagoRef.id,
          },
        },
        { idempotencyKey: resolvedIdempotencyKey },
      );

      const estadoPago = mapPaymentIntentStatusToEstadoPago(paymentIntent.status);
      await pagoRef.update({
        paymentIntentId: paymentIntent.id,
        providerStatus: paymentIntent.status,
        estado: estadoPago,
        updatedAt: admin.firestore.Timestamp.now(),
      });

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
        updatedAt: admin.firestore.Timestamp.now(),
      });

      console.error("Error al crear PaymentIntent", {
        ordenId,
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
    const ordenRef = firestoreTienda.collection(ORDENES_COLLECTION).doc(pago.ordenId);

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
        refundId: refund.id,
        refundAmount: refund.amount / 100,
        refundReason:
          refundReason || refund.metadata?.refundReason || refund.reason || undefined,
        failureCode: admin.firestore.FieldValue.delete(),
        failureMessage: admin.firestore.FieldValue.delete(),
        updatedAt: now,
      });

      tx.update(ordenRef, {
        estado: EstadoOrden.CANCELADA,
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
        refundReason || refund.metadata?.refundReason || refund.reason || undefined,
    };
  }

  async getPagoById(pagoId: string, user: AuthUser): Promise<PagoConsultaResult> {
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
      throw new ApiError(
        403,
        "No tienes permisos para consultar este pago",
      );
    }

    const ordenRef = firestoreTienda.collection(ORDENES_COLLECTION).doc(pago.ordenId);
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
      throw new ApiError(
        404,
        `No se encontró pago para la orden "${ordenId}"`,
      );
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
        fechaPago: now,
        failureCode: admin.firestore.FieldValue.delete(),
        failureMessage: admin.firestore.FieldValue.delete(),
        webhookEventIdsProcesados: admin.firestore.FieldValue.arrayUnion(event.id),
        updatedAt: now,
      });

      tx.update(pagoMatch.ordenRef, {
        estado: EstadoOrden.CONFIRMADA,
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

    const failureCode = paymentIntent.last_payment_error?.code || "payment_failed";
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
        failureCode,
        failureMessage,
        webhookEventIdsProcesados: admin.firestore.FieldValue.arrayUnion(event.id),
        updatedAt: now,
      });

      tx.update(pagoMatch.ordenRef, {
        estado: EstadoOrden.PENDIENTE,
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
        fechaPago: now,
        failureCode: admin.firestore.FieldValue.delete(),
        failureMessage: admin.firestore.FieldValue.delete(),
        webhookEventIdsProcesados: admin.firestore.FieldValue.arrayUnion(event.id),
        updatedAt: now,
      });

      tx.update(pagoMatch.ordenRef, {
        estado: EstadoOrden.CONFIRMADA,
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
        failureCode: "checkout_async_payment_failed",
        failureMessage: "Stripe reporto fallo en el pago async de Checkout",
        webhookEventIdsProcesados: admin.firestore.FieldValue.arrayUnion(event.id),
        updatedAt: now,
      });

      tx.update(pagoMatch.ordenRef, {
        estado: EstadoOrden.PENDIENTE,
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
        refundId: refundData?.id,
        refundAmount:
          typeof charge.amount_refunded === "number"
            ? charge.amount_refunded / 100
            : undefined,
        refundReason:
          refundData?.reason ||
          (charge.refunded ? "refund_processed_by_stripe" : undefined),
        webhookEventIdsProcesados: admin.firestore.FieldValue.arrayUnion(event.id),
        updatedAt: now,
      });

      tx.update(pagoMatch.ordenRef, {
        estado: EstadoOrden.CANCELADA,
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
    const byIntent = await this.findPagoByField("paymentIntentId", paymentIntent.id);
    if (byIntent) {
      return byIntent;
    }

    const pagoIdFromMetadata = getMetadataString(paymentIntent.metadata, "pagoId");
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

  private async resolvePagoFromRefundCharge(
    charge: Stripe.Charge,
  ): Promise<{
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
      ordenRef: firestoreTienda.collection(ORDENES_COLLECTION).doc(pagoData.ordenId),
    };
  }

  private async findPagoById(
    pagoId: string,
  ): Promise<{
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
      ordenRef: firestoreTienda.collection(ORDENES_COLLECTION).doc(pagoData.ordenId),
    };
  }
}

const pagoService = new PagoService();
export default pagoService;
