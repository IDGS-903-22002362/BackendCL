import { Request, Response } from "express";
import checkoutAttemptService from "../../services/checkout/checkout-attempt.service";
import { ApiError } from "../../utils/error-handler";
import { sendPublicError } from "../../utils/public-error.util";

const getAuthenticatedUid = (req: Request): string => {
  if (!req.user?.uid) {
    throw new ApiError(401, "No autorizado. Se requiere autenticacion.");
  }
  return req.user.uid;
};

const getIdempotencyKey = (req: Request): string => {
  const raw = req.header("Idempotency-Key");
  if (!raw) {
    throw new ApiError(400, "El header Idempotency-Key es obligatorio");
  }
  const normalized = raw.trim();
  if (normalized.length < 8 || normalized.length > 255) {
    throw new ApiError(
      400,
      "Idempotency-Key debe tener entre 8 y 255 caracteres",
    );
  }
  return normalized;
};

export const startCheckout = async (req: Request, res: Response) => {
  try {
    const userId = getAuthenticatedUid(req);
    const idempotencyKey = getIdempotencyKey(req);
    const result = await checkoutAttemptService.startCheckout(
      userId,
      req.body,
      idempotencyKey,
    );

    return res.status(result.created ? 201 : 200).json({
      success: true,
      message: result.created
        ? "Checkout iniciado exitosamente"
        : "Checkout reutilizado por idempotencia",
      data: result,
    });
  } catch (error) {
    if (error instanceof ApiError) {
      return sendPublicError(res, error, req.requestId, {
        fallbackCode: error.code ?? `HTTP_${error.statusCode}`,
        logLabel: "checkout_start",
      });
    }

    return sendPublicError(res, error, req.requestId, {
      fallbackMessage: "Error al iniciar checkout",
      fallbackCode: "CHECKOUT_START_FAILED",
      logLabel: "checkout_start",
    });
  }
};

export const getAttemptStatus = async (req: Request, res: Response) => {
  try {
    const userId = getAuthenticatedUid(req);
    const status = await checkoutAttemptService.getStatusForUser(
      req.params.attemptId,
      userId,
    );

    return res.status(200).json({
      success: true,
      data: status,
    });
  } catch (error) {
    if (error instanceof ApiError) {
      return sendPublicError(res, error, req.requestId, {
        fallbackCode: error.code ?? `HTTP_${error.statusCode}`,
        logLabel: "checkout_status",
      });
    }

    return sendPublicError(res, error, req.requestId, {
      fallbackMessage: "Error al consultar estado del checkout",
      fallbackCode: "CHECKOUT_STATUS_FAILED",
      logLabel: "checkout_status",
    });
  }
};

export const abandonAttempt = async (req: Request, res: Response) => {
  try {
    const userId = getAuthenticatedUid(req);
    const result = await checkoutAttemptService.abandonAttemptForUser(
      req.params.attemptId,
      userId,
    );

    return res.status(200).json({
      success: true,
      message: result.alreadyAbandoned
        ? "El intento de checkout ya estaba abandonado"
        : "Intento de checkout abandonado",
      data: result,
    });
  } catch (error) {
    if (error instanceof ApiError) {
      return sendPublicError(res, error, req.requestId, {
        fallbackCode: error.code ?? `HTTP_${error.statusCode}`,
        logLabel: "checkout_abandon",
      });
    }

    return sendPublicError(res, error, req.requestId, {
      fallbackMessage: "Error al abandonar el intento de checkout",
      fallbackCode: "CHECKOUT_ABANDON_FAILED",
      logLabel: "checkout_abandon",
    });
  }
};

export const cancelAttempt = async (req: Request, res: Response) => {
  try {
    const userId = getAuthenticatedUid(req);
    const result = await checkoutAttemptService.cancelAttemptForUser(
      req.params.attemptId,
      userId,
    );

    return res.status(200).json({
      success: true,
      message: "Intento de checkout cancelado",
      data: result,
    });
  } catch (error) {
    if (error instanceof ApiError) {
      return sendPublicError(res, error, req.requestId, {
        fallbackCode: error.code ?? `HTTP_${error.statusCode}`,
        logLabel: "checkout_cancel",
      });
    }

    return sendPublicError(res, error, req.requestId, {
      fallbackMessage: "Error al cancelar el intento de checkout",
      fallbackCode: "CHECKOUT_CANCEL_FAILED",
      logLabel: "checkout_cancel",
    });
  }
};
