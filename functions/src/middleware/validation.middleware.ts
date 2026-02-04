import { Request, Response, NextFunction } from "express";
import { ZodError, ZodSchema } from "zod";

/**
 * Middleware para validar el body de la petición usando un schema de Zod.
 * Retorna errores estructurados en formato consistente con el resto de la API.
 * Rechaza campos extra no definidos en el schema (prevención de mass assignment).
 *
 * @param schema - Schema de Zod para validar el body
 * @returns Middleware de Express
 */
export const validateBody = (schema: ZodSchema) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      // Parse y valida el body, reemplaza req.body con datos validados y transformados
      req.body = schema.parse(req.body);
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        // Formato de error consistente con el resto de la API
        res.status(400).json({
          success: false,
          message: "Validación fallida",
          errors: error.errors.map((err) => ({
            campo: err.path.join("."),
            mensaje: err.message,
            codigo: err.code,
          })),
        });
        return;
      }
      // Error inesperado, pasar al error handler global
      next(error);
    }
  };
};

/**
 * Middleware para validar los parámetros de ruta (params) usando un schema de Zod.
 * Útil para validar IDs y otros parámetros en la URL.
 *
 * @param schema - Schema de Zod para validar los params
 * @returns Middleware de Express
 */
export const validateParams = (schema: ZodSchema) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      // Parse y valida los params
      req.params = schema.parse(req.params);
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        res.status(400).json({
          success: false,
          message: "Parámetros inválidos",
          errors: error.errors.map((err) => ({
            campo: err.path.join("."),
            mensaje: err.message,
            codigo: err.code,
          })),
        });
        return;
      }
      next(error);
    }
  };
};

/**
 * Middleware para validar los query parameters usando un schema de Zod.
 * Útil para validar filtros, paginación, etc.
 *
 * @param schema - Schema de Zod para validar los query params
 * @returns Middleware de Express
 */
export const validateQuery = (schema: ZodSchema) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      // Parse y valida los query params
      req.query = schema.parse(req.query);
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        res.status(400).json({
          success: false,
          message: "Parámetros de consulta inválidos",
          errors: error.errors.map((err) => ({
            campo: err.path.join("."),
            mensaje: err.message,
            codigo: err.code,
          })),
        });
        return;
      }
      next(error);
    }
  };
};
