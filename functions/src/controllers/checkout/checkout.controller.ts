import { Request, Response } from "express";
import checkoutAttemptService from "../../services/checkout/checkout-attempt.service";
import { ApiError } from "../../utils/error-handler";

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
      return res.status(error.statusCode).json({
        success: false,
        message: error.message,
      });
    }

    return res.status(500).json({
      success: false,
      message: "Error al iniciar checkout",
      error: error instanceof Error ? error.message : "Error desconocido",
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
      return res.status(error.statusCode).json({
        success: false,
        message: error.message,
      });
    }

    return res.status(500).json({
      success: false,
      message: "Error al consultar estado del checkout",
      error: error instanceof Error ? error.message : "Error desconocido",
    });
  }
};
