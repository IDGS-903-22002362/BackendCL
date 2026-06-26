import type { PublicErrorDetails } from "../models/checkout-unavailable-item.model";

/**
 * Base API error class (no dependencies — safe for payment error subclasses).
 */
export class ApiError extends Error {
  statusCode: number;
  isOperational: boolean;
  code?: string;
  details?: PublicErrorDetails;

  constructor(
    statusCode: number,
    message: string,
    isOperational = true,
    code?: string,
    details?: PublicErrorDetails,
  ) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    this.code = code;
    this.details = details;

    Error.captureStackTrace(this, this.constructor);
  }
}
