/**
 * Base API error class (no dependencies — safe for payment error subclasses).
 */
export class ApiError extends Error {
  statusCode: number;
  isOperational: boolean;
  code?: string;

  constructor(
    statusCode: number,
    message: string,
    isOperational = true,
    code?: string,
  ) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    this.code = code;

    Error.captureStackTrace(this, this.constructor);
  }
}
