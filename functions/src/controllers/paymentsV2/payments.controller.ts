import { Request, Response } from "express";
import { PaymentApiError, isPaymentApiError } from "../../services/payments/payment-api-error";
import paymentsService from "../../services/payments/payments.service";
import { PaymentStatus } from "../../models/pago.model";
import {
  buildPublicErrorBody,
  logSafeError,
} from "../../utils/public-error.util";

const getActorFromRequest = (req: Request) => ({
  uid: req.user?.uid || "",
  rol: req.user?.rol,
  email: typeof req.user?.email === "string" ? req.user.email : undefined,
  nombre: typeof req.user?.nombre === "string" ? req.user.nombre : undefined,
  telefono: typeof req.user?.telefono === "string" ? req.user.telefono : undefined,
});

const getOptionalIdempotencyKey = (req: Request): string | undefined => {
  const value = req.header("Idempotency-Key");
  return value?.trim();
};

const serializeDateLike = (value: unknown): unknown => {
  if (!value) {
    return undefined;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { toDate?: () => Date }).toDate === "function"
  ) {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }

  return value;
};

const serializeRefunds = (
  refunds: Array<{
    refundId?: string;
    providerStatus?: string;
    refundState?: string;
    refundDate?: string;
    amountMinor?: number;
  }>,
) =>
  refunds.map((refund) => ({
    id: refund.refundId,
    status: refund.providerStatus,
    refundState: refund.refundState,
    refundDate: refund.refundDate,
    amount:
      typeof refund.amountMinor === "number" ? refund.amountMinor / 100 : undefined,
  }));

const serializeRefundRequest = (request: {
  id?: string;
  provider: string;
  orderId: string;
  paymentAttemptId: string;
  userId: string;
  reason: string;
  status: string;
  refundAmountMinor?: number;
  providerRefundId?: string;
  providerStatus?: string;
  rejectionReason?: string;
  lastProcessingError?: Record<string, unknown>;
  createdAt?: unknown;
  updatedAt?: unknown;
  approvedAt?: unknown;
  processedAt?: unknown;
  rejectedAt?: unknown;
}) => ({
  id: request.id,
  provider: request.provider,
  orderId: request.orderId,
  paymentAttemptId: request.paymentAttemptId,
  userId: request.userId,
  reason: request.reason,
  status: request.status,
  refundAmount:
    typeof request.refundAmountMinor === "number"
      ? request.refundAmountMinor / 100
      : undefined,
  refundAmountMinor: request.refundAmountMinor,
  providerRefundId: request.providerRefundId,
  providerStatus: request.providerStatus,
  rejectionReason: request.rejectionReason,
  lastProcessingError: request.lastProcessingError,
  createdAt: serializeDateLike(request.createdAt),
  updatedAt: serializeDateLike(request.updatedAt),
  approvedAt: serializeDateLike(request.approvedAt),
  processedAt: serializeDateLike(request.processedAt),
  rejectedAt: serializeDateLike(request.rejectedAt),
});

const toStatusPayload = (
  paymentAttemptId: string,
  paymentAttempt: {
    provider: string;
    status?: PaymentStatus;
    providerStatus?: string;
    paidAt?: unknown;
    amountMinor?: number;
    monto: number;
    currency: string;
    expiresAt?: unknown;
  },
  isTerminal: boolean,
  nextPollAfterMs: number,
) => {
  return {
    ok: true,
    paymentAttemptId,
    provider: String(paymentAttempt.provider).toLowerCase(),
    status: paymentAttempt.status,
    providerStatus: paymentAttempt.providerStatus,
    amount:
      typeof paymentAttempt.amountMinor === "number"
        ? paymentAttempt.amountMinor / 100
        : paymentAttempt.monto,
    currency: paymentAttempt.currency,
    paidAt: serializeDateLike(paymentAttempt.paidAt),
    expiresAt: serializeDateLike(paymentAttempt.expiresAt),
    isTerminal,
    nextPollAfterMs,
  };
};

const respondPaymentError = (
  res: Response,
  req: Request,
  error: unknown,
): Response => {
  logSafeError("payments_v2", error, req.requestId);

  if (isPaymentApiError(error)) {
    const { statusCode, body } = buildPublicErrorBody(error, req.requestId);

    return res.status(statusCode).json({
      ok: false,
      error: {
        code: body.code,
        message: body.message,
        ...(error.details ? { details: error.details } : {}),
      },
      ...(body.retryable !== undefined ? { retryable: body.retryable } : {}),
      ...(req.requestId ? { requestId: req.requestId } : {}),
    });
  }

  const { statusCode, body } = buildPublicErrorBody(error, req.requestId, {
    fallbackMessage: "Error interno de pagos",
    fallbackCode: "PAYMENT_INTERNAL_ERROR",
  });

  return res.status(statusCode).json({
    ok: false,
    error: {
      code: body.code,
      message: body.message,
    },
    retryable: body.retryable,
    ...(req.requestId ? { requestId: req.requestId } : {}),
  });
};

export const createAplazoOnline = async (req: Request, res: Response) => {
  try {
    const result = await paymentsService.createAplazoOnline(
      getActorFromRequest(req),
      req.body,
      getOptionalIdempotencyKey(req),
    );

    return res.status(result.created ? 201 : 200).json({
      ok: true,
      paymentAttemptId: result.paymentAttempt.id,
      provider: "aplazo",
      flowType: "online",
      status: result.paymentAttempt.status,
      redirectUrl: result.paymentAttempt.redirectUrl,
      checkoutUrl: result.paymentAttempt.redirectUrl,
      expiresAt: serializeDateLike(result.paymentAttempt.expiresAt),
    });
  } catch (error) {
    return respondPaymentError(res, req, error);
  }
};

export const getPaymentStatus = async (req: Request, res: Response) => {
  try {
    const result = await paymentsService.getPaymentStatusForActor(
      req.params.paymentAttemptId,
      getActorFromRequest(req),
      { syncWithProvider: true },
    );

    return res.status(200).json(
      toStatusPayload(
        req.params.paymentAttemptId,
        result.paymentAttempt,
        result.isTerminal,
        result.nextPollAfterMs,
      ),
    );
  } catch (error) {
    return respondPaymentError(res, req, error);
  }
};

export const webhookAplazo = async (req: Request, res: Response) => {
  try {
    const rawBody =
      Buffer.isBuffer(req.body) && req.body.length > 0 ? req.body : req.rawBody;
    if (!rawBody || rawBody.length === 0) {
      throw new PaymentApiError(
        400,
        "PAYMENT_VALIDATION_ERROR",
        "No fue posible obtener el raw body del webhook Aplazo",
      );
    }

    const result = await paymentsService.handleAplazoWebhook({
      rawBody,
      headers: req.headers,
      requestId: req.requestId,
    });

    return res.status(200).json({
      ok: true,
      status: result.status,
      paymentAttemptId: result.paymentAttemptId,
      eventLogId: result.eventLogId,
    });
  } catch (error) {
    return respondPaymentError(res, req, error);
  }
};

export const reconcileAplazoPayment = async (req: Request, res: Response) => {
  try {
    const paymentAttempt = await paymentsService.reconcileAplazoPaymentAttempt(
      req.params.paymentAttemptId,
      getActorFromRequest(req),
    );

    return res.status(200).json({
      ok: true,
      paymentAttemptId: paymentAttempt.id,
      provider: "aplazo",
      status: paymentAttempt.status,
      providerStatus: paymentAttempt.providerStatus,
    });
  } catch (error) {
    return respondPaymentError(res, req, error);
  }
};

export const cancelAplazoPayment = async (req: Request, res: Response) => {
  try {
    const paymentAttempt = await paymentsService.cancelAplazoPaymentAttempt(
      req.params.paymentAttemptId,
      getActorFromRequest(req),
      req.body?.reason,
    );

    return res.status(200).json({
      ok: true,
      paymentAttemptId: paymentAttempt.id,
      provider: "aplazo",
      status: paymentAttempt.status,
      providerStatus: paymentAttempt.providerStatus,
    });
  } catch (error) {
    return respondPaymentError(res, req, error);
  }
};

export const refundAplazoPayment = async (req: Request, res: Response) => {
  try {
    const paymentAttempt = await paymentsService.refundAplazoPaymentAttempt(
      req.params.paymentAttemptId,
      getActorFromRequest(req),
      {
        refundAmountMinor: req.body?.refundAmountMinor,
        reason: req.body?.reason,
      },
    );

    return res.status(200).json({
      ok: true,
      paymentAttemptId: paymentAttempt.id,
      provider: "aplazo",
      status: paymentAttempt.status,
      refundState: paymentAttempt.refundState,
    });
  } catch (error) {
    return respondPaymentError(res, req, error);
  }
};

export const getAplazoRefundStatus = async (req: Request, res: Response) => {
  try {
    const result = await paymentsService.getAplazoRefundStatus(
      req.params.paymentAttemptId,
      getActorFromRequest(req),
      {
        refundId:
          typeof req.query?.refundId === "string" ? req.query.refundId : undefined,
      },
    );

    return res.status(200).json({
      ok: true,
      paymentAttemptId: result.paymentAttempt.id,
      provider: "aplazo",
      status: result.paymentAttempt.status,
      refundState: result.paymentAttempt.refundState,
      providerStatus: result.selectedRefund?.providerStatus,
      refundId: result.selectedRefund?.refundId ?? result.paymentAttempt.refundId,
      refundAmount:
        typeof result.selectedRefund?.amountMinor === "number"
          ? result.selectedRefund.amountMinor / 100
          : undefined,
      totalRefundedAmount: result.totalRefundedAmount,
      currency: result.paymentAttempt.currency,
      refunds: serializeRefunds(result.refunds),
    });
  } catch (error) {
    return respondPaymentError(res, req, error);
  }
};

export const createAplazoRefundRequest = async (req: Request, res: Response) => {
  try {
    const request = await paymentsService.createAplazoRefundRequest(
      getActorFromRequest(req),
      {
        orderId: req.body.orderId,
        reason: req.body.reason,
      },
    );

    return res.status(201).json({
      ok: true,
      data: serializeRefundRequest(request),
    });
  } catch (error) {
    return respondPaymentError(res, req, error);
  }
};

export const listAplazoRefundRequests = async (req: Request, res: Response) => {
  try {
    const requests = await paymentsService.listAplazoRefundRequestsForActor(
      getActorFromRequest(req),
      {
        orderId:
          typeof req.query.orderId === "string" ? req.query.orderId : undefined,
      },
    );

    return res.status(200).json({
      ok: true,
      count: requests.length,
      data: requests.map(serializeRefundRequest),
    });
  } catch (error) {
    return respondPaymentError(res, req, error);
  }
};

export const getAplazoRefundRequest = async (req: Request, res: Response) => {
  try {
    const request = await paymentsService.getAplazoRefundRequestForActor(
      req.params.refundRequestId,
      getActorFromRequest(req),
    );

    return res.status(200).json({
      ok: true,
      data: serializeRefundRequest(request),
    });
  } catch (error) {
    return respondPaymentError(res, req, error);
  }
};

export const listAdminAplazoRefundRequests = async (
  req: Request,
  res: Response,
) => {
  try {
    const requests = await paymentsService.listAplazoRefundRequestsForAdmin(
      getActorFromRequest(req),
      {
        status:
          typeof req.query.status === "string"
            ? (req.query.status as "pending" | "approved" | "rejected" | "processed")
            : undefined,
      },
    );

    return res.status(200).json({
      ok: true,
      count: requests.length,
      data: requests.map(serializeRefundRequest),
    });
  } catch (error) {
    return respondPaymentError(res, req, error);
  }
};

export const approveAplazoRefundRequest = async (
  req: Request,
  res: Response,
) => {
  try {
    const request = await paymentsService.approveAplazoRefundRequest(
      req.params.refundRequestId,
      getActorFromRequest(req),
      {
        refundAmountMinor: req.body.refundAmountMinor,
        reason: req.body.reason,
      },
    );

    return res.status(200).json({
      ok: true,
      data: serializeRefundRequest(request),
    });
  } catch (error) {
    return respondPaymentError(res, req, error);
  }
};

export const rejectAplazoRefundRequest = async (
  req: Request,
  res: Response,
) => {
  try {
    const request = await paymentsService.rejectAplazoRefundRequest(
      req.params.refundRequestId,
      getActorFromRequest(req),
      {
        reason: req.body.reason,
      },
    );

    return res.status(200).json({
      ok: true,
      data: serializeRefundRequest(request),
    });
  } catch (error) {
    return respondPaymentError(res, req, error);
  }
};
