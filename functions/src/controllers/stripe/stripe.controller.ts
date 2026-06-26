import { Request, Response } from "express";
import pagoService from "../../services/pago.service";
import { ApiError } from "../../utils/error-handler";
import { sendPublicError } from "../../utils/public-error.util";

const getAuthenticatedUid = (req: Request): string => {
  if (!req.user?.uid) {
    throw new ApiError(401, "No autorizado. Se requiere autenticación.");
  }

  return req.user.uid;
};

const getRawWebhookBody = (req: Request): Buffer => {
  if (Buffer.isBuffer(req.body) && req.body.length > 0) {
    return req.body;
  }

  if (req.rawBody && req.rawBody.length > 0) {
    return req.rawBody;
  }

  throw new ApiError(
    400,
    "No fue posible obtener el raw body del webhook para validar la firma",
  );
};

const respondStripeError = (
  res: Response,
  req: Request,
  error: unknown,
  fallbackMessage: string,
  fallbackCode: string,
  logLabel: string,
): Response => {
  if (error instanceof ApiError) {
    return sendPublicError(res, error, req.requestId, {
      fallbackCode: error.code ?? `HTTP_${error.statusCode}`,
      logLabel,
    });
  }

  return sendPublicError(res, error, req.requestId, {
    fallbackMessage,
    fallbackCode,
    logLabel,
  });
};

export const getConfig = async (_req: Request, res: Response) => {
  const config = pagoService.getPublicStripeConfig();
  return res.status(200).json({
    success: true,
    data: config,
  });
};

export const createPaymentIntent = async (req: Request, res: Response) => {
  return res.status(410).json({
    success: false,
    code: "LEGACY_STRIPE_PAYMENT_INTENT_DISABLED",
    message:
      "Este flujo de pago fue retirado. Usa POST /api/checkout/attempts para iniciar el pago con Stripe Hosted Checkout.",
  });
};

export const getPaymentIntent = async (req: Request, res: Response) => {
  try {
    const uid = getAuthenticatedUid(req);
    const result = await pagoService.getStripePaymentIntentById(req.params.id, {
      uid,
      rol: req.user?.rol,
    });

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    return respondStripeError(
      res,
      req,
      error,
      "Error interno al consultar PaymentIntent",
      "STRIPE_PAYMENT_INTENT_READ_FAILED",
      "stripe_get_payment_intent",
    );
  }
};

export const createCheckoutSession = async (req: Request, res: Response) => {
  return res.status(410).json({
    success: false,
    code: "LEGACY_STRIPE_CHECKOUT_SESSION_DISABLED",
    message:
      "Este flujo de pago fue retirado. Usa POST /api/checkout/attempts para iniciar el pago con Stripe Hosted Checkout.",
  });
};

export const getCheckoutSession = async (req: Request, res: Response) => {
  try {
    const uid = getAuthenticatedUid(req);
    const result = await pagoService.getStripeCheckoutSessionById(req.params.id, {
      uid,
      rol: req.user?.rol,
    });

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    return respondStripeError(
      res,
      req,
      error,
      "Error interno al consultar Checkout Session",
      "STRIPE_CHECKOUT_SESSION_READ_FAILED",
      "stripe_get_checkout_session",
    );
  }
};

export const createSetupIntent = async (req: Request, res: Response) => {
  try {
    const userId = getAuthenticatedUid(req);

    const result = await pagoService.createStripeSetupIntent({
      userId,
      customerId: req.body.customerId,
    });

    return res.status(201).json({
      success: true,
      data: result,
    });
  } catch (error) {
    return respondStripeError(
      res,
      req,
      error,
      "Error interno al crear SetupIntent",
      "STRIPE_SETUP_INTENT_FAILED",
      "stripe_create_setup_intent",
    );
  }
};

export const createBillingPortal = async (req: Request, res: Response) => {
  try {
    const userId = getAuthenticatedUid(req);

    const result = await pagoService.createStripeBillingPortal({
      userId,
      returnUrl: req.body.returnUrl,
    });

    return res.status(201).json({
      success: true,
      data: result,
    });
  } catch (error) {
    return respondStripeError(
      res,
      req,
      error,
      "Error interno al crear sesión de portal",
      "STRIPE_PORTAL_SESSION_FAILED",
      "stripe_create_portal_session",
    );
  }
};

export const createRefund = async (req: Request, res: Response) => {
  try {
    const uid = getAuthenticatedUid(req);
    const result = await pagoService.procesarReembolsoPorOrden({
      orderId: req.body.orderId,
      reason: req.body.reason,
      requestedByUid: uid,
    });

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    return respondStripeError(
      res,
      req,
      error,
      "Error interno al procesar el reembolso",
      "STRIPE_REFUND_FAILED",
      "stripe_refund",
    );
  }
};

export const webhook = async (req: Request, res: Response) => {
  try {
    const signature = req.header("Stripe-Signature");
    if (!signature) {
      throw new ApiError(
        400,
        "El header Stripe-Signature es obligatorio para validar el webhook",
      );
    }

    const result = await pagoService.procesarWebhookStripe(
      getRawWebhookBody(req),
      signature,
    );

    return res.status(200).json({
      success: true,
      message: "Webhook recibido",
      data: result,
    });
  } catch (error) {
    return respondStripeError(
      res,
      req,
      error,
      "Error interno al procesar webhook Stripe",
      "STRIPE_WEBHOOK_FAILED",
      "stripe_webhook",
    );
  }
};
