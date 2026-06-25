import { Request, Response } from "express";
import pagoService from "../../services/pago.service";
import { ApiError } from "../../utils/error-handler";

export const iniciar = async (req: Request, res: Response) => {
  return res.status(410).json({
    success: false,
    code: "LEGACY_PAYMENT_START_DISABLED",
    message:
      "El inicio de pago legacy fue retirado. Usa POST /api/checkout/attempts para pagos con tarjeta (Stripe).",
  });
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

    const rawBody =
      Buffer.isBuffer(req.body) && req.body.length > 0
        ? req.body
        : req.rawBody;

    if (!rawBody || rawBody.length === 0) {
      throw new ApiError(
        400,
        "No fue posible obtener el raw body del webhook para validar la firma",
      );
    }

    const result = await pagoService.procesarWebhookStripe(
      rawBody,
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
