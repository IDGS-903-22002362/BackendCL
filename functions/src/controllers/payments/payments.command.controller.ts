import { Request, Response } from "express";
import { MetodoPago } from "../../models/orden.model";
import pagoService from "../../services/pago.service";
import { ApiError } from "../../utils/error-handler";

const IDEMPOTENCY_KEY_MIN_LENGTH = 8;
const IDEMPOTENCY_KEY_MAX_LENGTH = 255;

const getOptionalIdempotencyKey = (req: Request): string | undefined => {
  const rawKey = req.header("Idempotency-Key");

  if (!rawKey) {
    return undefined;
  }

  const idempotencyKey = rawKey.trim();
  if (
    idempotencyKey.length < IDEMPOTENCY_KEY_MIN_LENGTH ||
    idempotencyKey.length > IDEMPOTENCY_KEY_MAX_LENGTH
  ) {
    throw new ApiError(
      400,
      `Idempotency-Key debe tener entre ${IDEMPOTENCY_KEY_MIN_LENGTH} y ${IDEMPOTENCY_KEY_MAX_LENGTH} caracteres`,
    );
  }

  return idempotencyKey;
};

export const iniciar = async (req: Request, res: Response) => {
  try {
    if (!req.user?.uid) {
      return res.status(401).json({
        success: false,
        message: "No autorizado. Se requiere autenticación.",
      });
    }

    const idempotencyKey = getOptionalIdempotencyKey(req);
    const { ordenId, metodoPago } = req.body as {
      ordenId: string;
      metodoPago: MetodoPago;
    };

    const result = await pagoService.iniciarPago({
      ordenId,
      userId: req.user.uid,
      metodoPago,
      idempotencyKey,
    });

    return res.status(result.created ? 201 : 200).json({
      success: true,
      message: result.created
        ? "Pago iniciado exitosamente"
        : "Intento de pago reutilizado por idempotencia",
      data: {
        pagoId: result.pagoId,
        paymentIntentId: result.paymentIntentId,
        clientSecret: result.clientSecret,
        status: result.status,
      },
    });
  } catch (error) {
    if (error instanceof ApiError) {
      return res.status(error.statusCode).json({
        success: false,
        message: error.message,
      });
    }

    return res.status(500).json({
      success: false,
      message: "Error interno al iniciar el pago",
      error: error instanceof Error ? error.message : "Error desconocido",
    });
  }
};

export const webhook = async (req: Request, res: Response) => {
  try {
    const stripeSignature = req.header("Stripe-Signature");
    if (!stripeSignature) {
      throw new ApiError(
        400,
        "El header Stripe-Signature es obligatorio para validar el webhook",
      );
    }

    if (!req.rawBody || req.rawBody.length === 0) {
      throw new ApiError(
        400,
        "No fue posible obtener el raw body del webhook para validar la firma",
      );
    }

    const result = await pagoService.procesarWebhookStripe(
      req.rawBody,
      stripeSignature,
    );

    return res.status(200).json({
      success: true,
      message: "Webhook recibido",
      data: result,
    });
  } catch (error) {
    if (error instanceof ApiError) {
      return res.status(error.statusCode).json({
        success: false,
        message: error.message,
      });
    }

    return res.status(500).json({
      success: false,
      message: "Error interno al procesar el webhook de Stripe",
      error: error instanceof Error ? error.message : "Error desconocido",
    });
  }
};

export const reembolso = async (req: Request, res: Response) => {
  try {
    if (!req.user?.uid) {
      return res.status(401).json({
        success: false,
        message: "No autorizado. Se requiere autenticación.",
      });
    }

    const { id: pagoId } = req.params;
    const { refundAmount, refundReason } = req.body as {
      refundAmount?: number;
      refundReason?: string;
    };

    const result = await pagoService.procesarReembolso({
      pagoId,
      refundAmount,
      refundReason,
      requestedByUid: req.user.uid,
    });

    return res.status(200).json({
      success: true,
      message: "Reembolso procesado exitosamente",
      data: result,
    });
  } catch (error) {
    if (error instanceof ApiError) {
      return res.status(error.statusCode).json({
        success: false,
        message: error.message,
      });
    }

    return res.status(500).json({
      success: false,
      message: "Error interno al procesar el reembolso",
      error: error instanceof Error ? error.message : "Error desconocido",
    });
  }
};
