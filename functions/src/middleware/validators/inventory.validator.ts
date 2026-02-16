import { z } from "zod";

export const registerInventoryMovementSchema = z
  .object({
    tipo: z.enum(["entrada", "salida", "ajuste", "venta", "devolucion"], {
      required_error: "El tipo de movimiento es requerido",
      invalid_type_error: "El tipo de movimiento es inválido",
    }),

    productoId: z
      .string({
        required_error: "El ID del producto es requerido",
        invalid_type_error: "El ID del producto debe ser una cadena de texto",
      })
      .trim()
      .min(1, "El ID del producto no puede estar vacío")
      .max(120, "El ID del producto es demasiado largo"),

    tallaId: z
      .string({
        invalid_type_error: "El ID de talla debe ser una cadena de texto",
      })
      .trim()
      .min(1, "El ID de talla no puede estar vacío")
      .max(120, "El ID de talla es demasiado largo")
      .optional(),

    cantidad: z
      .number({
        invalid_type_error: "La cantidad debe ser un número",
      })
      .int("La cantidad debe ser un número entero")
      .positive("La cantidad debe ser mayor a 0")
      .optional(),

    cantidadNueva: z
      .number({
        invalid_type_error: "La cantidad nueva debe ser un número",
      })
      .int("La cantidad nueva debe ser un número entero")
      .nonnegative("La cantidad nueva no puede ser negativa")
      .optional(),

    motivo: z
      .string({
        invalid_type_error: "El motivo debe ser una cadena de texto",
      })
      .trim()
      .min(1, "El motivo no puede estar vacío")
      .max(200, "El motivo no puede exceder 200 caracteres")
      .optional(),

    referencia: z
      .string({
        invalid_type_error: "La referencia debe ser una cadena de texto",
      })
      .trim()
      .max(120, "La referencia no puede exceder 120 caracteres")
      .optional(),

    ordenId: z
      .string({
        invalid_type_error: "El ID de orden debe ser una cadena de texto",
      })
      .trim()
      .min(1, "El ID de orden no puede estar vacío")
      .max(120, "El ID de orden es demasiado largo")
      .optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.tipo === "ajuste") {
      if (value.cantidadNueva === undefined) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["cantidadNueva"],
          message: "Para tipo 'ajuste' se requiere cantidadNueva",
        });
      }
      return;
    }

    if (value.cantidad === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["cantidad"],
        message: "Para este tipo de movimiento se requiere cantidad",
      });
    }

    if (
      (value.tipo === "venta" || value.tipo === "devolucion") &&
      !value.ordenId
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["ordenId"],
        message: "Para tipo 'venta' o 'devolucion' se requiere ordenId",
      });
    }
  });

export const listInventoryMovementsQuerySchema = z.object({
  productoId: z.string().trim().min(1).max(120).optional(),
  tallaId: z.string().trim().min(1).max(120).optional(),
  tipo: z
    .enum(["entrada", "salida", "ajuste", "venta", "devolucion"])
    .optional(),
  ordenId: z.string().trim().min(1).max(120).optional(),
  fechaDesde: z
    .string()
    .datetime({
      message:
        "fechaDesde debe ser una fecha válida en formato ISO 8601 (ej: 2024-01-01T00:00:00Z)",
    })
    .optional(),
  fechaHasta: z
    .string()
    .datetime({
      message:
        "fechaHasta debe ser una fecha válida en formato ISO 8601 (ej: 2024-12-31T23:59:59Z)",
    })
    .optional(),
  limit: z.coerce
    .number()
    .int("El límite debe ser un número entero")
    .min(1, "El límite debe ser al menos 1")
    .max(100, "El límite no puede exceder 100")
    .default(20),
  cursor: z.string().trim().min(1).max(200).optional(),
});
