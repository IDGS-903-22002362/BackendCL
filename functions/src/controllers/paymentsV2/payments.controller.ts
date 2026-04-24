import { Request, Response } from "express";
import { PaymentApiError, isPaymentApiError } from "../../services/payments/payment-api-error";
import paymentsService from "../../services/payments/payments.service";
import { PaymentStatus } from "../../models/pago.model";

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

const respondPaymentError = (res: Response, error: unknown): Response => {
  if (isPaymentApiError(error)) {
    return res.status(error.statusCode).json({
      ok: false,
      error: {
        code: error.code,
        message: error.message,
        details: error.details,
      },
    });
  }

  return res.status(500).json({
    ok: false,
    error: {
      code: "PAYMENT_INTERNAL_ERROR",
      message:
        error instanceof Error ? error.message : "Error interno de pagos",
    },
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
    return respondPaymentError(res, error);
  }
};

export const createAplazoInStore = async (req: Request, res: Response) => {
  try {
    const result = await paymentsService.createAplazoInStore(
      getActorFromRequest(req),
      req.body,
      getOptionalIdempotencyKey(req),
    );

    const metadata = result.paymentAttempt.metadata || {};
    return res.status(result.created ? 201 : 200).json({
      ok: true,
      paymentAttemptId: result.paymentAttempt.id,
      provider: "aplazo",
      flowType: "in_store",
      status: result.paymentAttempt.status,
      paymentLink:
        typeof metadata.paymentLink === "string" ? metadata.paymentLink : undefined,
      qrString: typeof metadata.qrString === "string" ? metadata.qrString : undefined,
      qrImageUrl:
        typeof metadata.qrImageUrl === "string" ? metadata.qrImageUrl : undefined,
      expiresAt: serializeDateLike(result.paymentAttempt.expiresAt),
    });
  } catch (error) {
    return respondPaymentError(res, error);
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
    return respondPaymentError(res, error);
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
    return respondPaymentError(res, error);
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
    return respondPaymentError(res, error);
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
    return respondPaymentError(res, error);
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
    return respondPaymentError(res, error);
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
    return respondPaymentError(res, error);
  }
};

export const registerAplazoMerchantStores = async (
  req: Request,
  res: Response,
) => {
  try {
    const branches = await paymentsService.registerAplazoMerchantStores(
      getActorFromRequest(req),
      req.body.branches,
    );

    return res.status(200).json({
      ok: true,
      provider: "aplazo",
      flowType: "in_store",
      branches,
    });
  } catch (error) {
    return respondPaymentError(res, error);
  }
};

export const resendAplazoInStoreCheckout = async (
  req: Request,
  res: Response,
) => {
  try {
    const result = await paymentsService.resendAplazoInStoreCheckout(
      getActorFromRequest(req),
      {
        cartId: req.params.cartId,
        phoneNumber: req.body.target.phoneNumber,
        channels: req.body.channels,
      },
    );

    return res.status(200).json({
      ok: true,
      provider: "aplazo",
      flowType: "in_store",
      cartId: req.params.cartId,
      result,
    });
  } catch (error) {
    return respondPaymentError(res, error);
  }
};

export const generateAplazoInStoreQr = async (req: Request, res: Response) => {
  try {
    const result = await paymentsService.generateAplazoInStoreQr(
      getActorFromRequest(req),
      {
        cartId: req.params.cartId,
        shopId: String(req.query.shopId),
      },
    );

    return res.status(200).json({
      ok: true,
      provider: "aplazo",
      flowType: "in_store",
      cartId: req.params.cartId,
      checkoutUrl: result.checkoutUrl,
      qrCode: result.qrCode,
    });
  } catch (error) {
    return respondPaymentError(res, error);
  }
};
