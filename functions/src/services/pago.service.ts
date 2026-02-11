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
import { ApiError } from "../utils/error-handler";

const ORDENES_COLLECTION = "ordenes";

type IniciarPagoInput = {
  ordenId: string;
  userId: string;
  metodoPago: MetodoPago;
  idempotencyKey: string;
};

type IniciarPagoResult = {
  pagoId: string;
  paymentIntentId: string;
  clientSecret: string;
  status: EstadoPago;
  created: boolean;
};

const getStripeClient = (): Stripe => {
  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeSecretKey) {
    throw new ApiError(
      500,
      "La configuración de pagos no está disponible en este entorno",
    );
  }

  return new Stripe(stripeSecretKey);
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

class PagoService {
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
        `La orden no está en estado pagable. Estado actual: ${ordenData.estado}`,
      );
    }

    if (metodoPago !== ordenData.metodoPago) {
      throw new ApiError(
        400,
        "El método de pago no coincide con el método configurado en la orden",
      );
    }

    if (metodoPago !== MetodoPago.TARJETA) {
      throw new ApiError(
        400,
        "Método de pago no válido para Stripe en este endpoint. Usa TARJETA",
      );
    }

    if (typeof ordenData.total !== "number" || ordenData.total <= 0) {
      throw new ApiError(409, "La orden tiene un monto inválido para pago");
    }

    const amount = Math.round(ordenData.total * 100);
    if (amount <= 0) {
      throw new ApiError(409, "La orden tiene un monto inválido para pago");
    }

    const idemSnapshot = await firestoreTienda
      .collection(COLECCION_PAGOS)
      .where("idempotencyKey", "==", idempotencyKey)
      .limit(1)
      .get();

    if (!idemSnapshot.empty) {
      const pagoExistenteDoc = idemSnapshot.docs[0];
      const pagoExistente = pagoExistenteDoc.data() as Pago;

      if (pagoExistente.ordenId !== ordenId || pagoExistente.userId !== userId) {
        throw new ApiError(
          409,
          "La idempotency key ya fue usada en otra operación de pago",
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
            error: error instanceof Error ? error.message : "Error desconocido",
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
      idempotencyKey,
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
        { idempotencyKey },
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
          "Stripe no devolvió client secret para el intento de pago",
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
}

const pagoService = new PagoService();
export default pagoService;
