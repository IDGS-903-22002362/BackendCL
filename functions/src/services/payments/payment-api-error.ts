import { ApiError } from "../../utils/error-handler";

export class PaymentApiError extends ApiError {
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(
    statusCode: number,
    code: string,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(statusCode, message);
    this.code = code;
    this.details = details;
  }
}

export const isPaymentApiError = (error: unknown): error is PaymentApiError => {
  return error instanceof PaymentApiError;
};

export const createPaymentValidationError = (
  message: string,
  details?: Record<string, unknown>,
  statusCode = 400,
): PaymentApiError => {
  return new PaymentApiError(
    statusCode,
    "PAYMENT_VALIDATION_ERROR",
    message,
    details,
  );
};

export const createPaymentProviderError = (
  message: string,
  details?: Record<string, unknown>,
): PaymentApiError => {
  return new PaymentApiError(502, "PAYMENT_PROVIDER_ERROR", message, details);
};

export const createPaymentProviderTimeoutError = (
  message: string,
  details?: Record<string, unknown>,
): PaymentApiError => {
  return new PaymentApiError(
    504,
    "PAYMENT_PROVIDER_TIMEOUT",
    message,
    details,
  );
};

export const createPaymentProviderNetworkError = (
  message: string,
  details?: Record<string, unknown>,
): PaymentApiError => {
  return new PaymentApiError(
    502,
    "PAYMENT_PROVIDER_NETWORK_ERROR",
    message,
    details,
  );
};
