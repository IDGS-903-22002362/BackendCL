/**
 * Schemas de validación para pagos (Stripe)
 * Usa Zod para validación en runtime con TypeScript
 *
 * REGLAS DE VALIDACIÓN:
 * - Todos los schemas de body usan .strict() para prevenir mass assignment
 * - Strings de usuario usan .trim() para limpiar espacios
 * - Mensajes de error en español
 * - Solo se validan campos que el cliente envía; campos internos
 *   (provider, idempotencyKey, estado inicial) se asignan server-side
 */

import { z } from "zod";
import { EstadoPago } from "../../models/pago.model";
import { MetodoPago } from "../../models/orden.model";

// ─── Schemas de parámetros ────────────────────────────────────────────────────

/**
 * Schema para validar parámetros de ruta con ID de pago
 */
export const pagoIdParamSchema = z
  .object({
    id: z
      .string({
        required_error: "El ID del pago es requerido",
        invalid_type_error: "El ID del pago debe ser una cadena de texto",
      })
      .trim()
      .min(1, "El ID del pago no puede estar vacío"),
  })
  .strict();

// ─── Schemas de body ──────────────────────────────────────────────────────────

/**
 * Schema para iniciar un pago (POST /api/pagos/iniciar)
 * Solo valida campos que el cliente envía al iniciar un pago
 * Campos internos (provider, idempotencyKey, estado) se asignan server-side
 */
export const iniciarPagoSchema = z
  .object({
    ordenId: z
      .string({
        required_error: "El ID de la orden es requerido",
        invalid_type_error: "El ID de la orden debe ser una cadena de texto",
      })
      .trim()
      .min(1, "El ID de la orden no puede estar vacío"),

    metodoPago: z.nativeEnum(MetodoPago, {
      errorMap: () => ({
        message: `El método de pago debe ser uno de: ${Object.values(MetodoPago).join(", ")}`,
      }),
    }),
  })
  .strict();

/**
 * Schema para actualizar el estado de un pago (interno / webhook)
 * Usado por el webhook de Stripe o por administradores
 */
export const updateEstadoPagoSchema = z
  .object({
    estado: z.nativeEnum(EstadoPago, {
      errorMap: () => ({
        message: `El estado del pago debe ser uno de: ${Object.values(EstadoPago).join(", ")}`,
      }),
    }),

    providerStatus: z
      .string({
        invalid_type_error:
          "El estado del proveedor debe ser una cadena de texto",
      })
      .trim()
      .max(100, "El estado del proveedor no puede exceder 100 caracteres")
      .optional(),

    failureCode: z
      .string({
        invalid_type_error: "El código de fallo debe ser una cadena de texto",
      })
      .trim()
      .max(100, "El código de fallo no puede exceder 100 caracteres")
      .optional(),

    failureMessage: z
      .string({
        invalid_type_error: "El mensaje de fallo debe ser una cadena de texto",
      })
      .trim()
      .max(500, "El mensaje de fallo no puede exceder 500 caracteres")
      .optional(),
  })
  .strict();

/**
 * Schema para procesar un reembolso (POST /api/pagos/:id/reembolso)
 * refundAmount es opcional: si no se envía, se reembolsa el monto total
 */
export const refundPagoSchema = z
  .object({
    refundAmount: z
      .number({
        invalid_type_error: "El monto del reembolso debe ser un número",
      })
      .positive("El monto del reembolso debe ser mayor a 0")
      .optional(),

    refundReason: z
      .string({
        invalid_type_error:
          "El motivo del reembolso debe ser una cadena de texto",
      })
      .trim()
      .min(1, "El motivo del reembolso no puede estar vacío")
      .max(500, "El motivo del reembolso no puede exceder 500 caracteres")
      .optional(),
  })
  .strict();

/**
 * Schema para consultar pagos por orden (query params)
 * No usa .strict() porque query params pueden incluir campos extra del framework
 */
export const listPagosByOrdenQuerySchema = z.object({
  ordenId: z
    .string({
      required_error: "El ID de la orden es requerido",
      invalid_type_error: "El ID de la orden debe ser una cadena de texto",
    })
    .trim()
    .min(1, "El ID de la orden no puede estar vacío"),

  estado: z
    .string({
      invalid_type_error: "El estado debe ser una cadena de texto",
    })
    .trim()
    .optional(),
});
