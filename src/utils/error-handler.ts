/**
 * Utilidades para manejo de errores
 * Proporciona funciones y middleware para gestión centralizada de errores
 */

import { Request, Response, NextFunction } from "express";

/**
 * Clase personalizada para errores de la API
 */
export class ApiError extends Error {
  statusCode: number;
  isOperational: boolean;

  constructor(statusCode: number, message: string, isOperational = true) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = isOperational;

    // Mantener el stack trace correcto
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Middleware global de manejo de errores
 * Debe ser el último middleware en app.ts
 */
export const errorHandler = (
  err: Error | ApiError,
  _req: Request,
  res: Response,
  next: NextFunction
) => {
  // Si ya se envió respuesta, delegar al manejador por defecto
  if (res.headersSent) {
    return next(err);
  }

  // Log del error
  console.error("❌ Error capturado por errorHandler:");
  console.error("Mensaje:", err.message);
  console.error("Stack:", err.stack);

  // Determinar código de estado
  const statusCode = err instanceof ApiError ? err.statusCode : 500;

  // Preparar respuesta
  const response: any = {
    success: false,
    message: err.message || "Error interno del servidor",
  };

  // En desarrollo, incluir stack trace
  if (process.env.NODE_ENV === "development") {
    response.stack = err.stack;
  }

  // Enviar respuesta
  res.status(statusCode).json(response);
};

/**
 * Middleware para capturar errores asíncronos
 * Envuelve funciones async para que los errores lleguen al error handler
 */
export const asyncHandler = (
  fn: (req: Request, res: Response, next: NextFunction) => Promise<any>
) => {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

/**
 * Middleware para rutas no encontradas (404)
 */
export const notFoundHandler = (
  req: Request,
  _res: Response,
  next: NextFunction
) => {
  const error = new ApiError(
    404,
    `Ruta no encontrada: ${req.method} ${req.originalUrl}`
  );
  next(error);
};
