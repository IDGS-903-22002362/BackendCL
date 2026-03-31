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
