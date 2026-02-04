import { z } from "zod";

/**
 * Schema para crear una nueva talla
 * Valida todos los campos requeridos según el modelo Talla
 */
export const createSizeSchema = z
  .object({
    codigo: z
      .string({
        required_error: "El código de la talla es requerido",
        invalid_type_error: "El código debe ser una cadena de texto",
      })
      .trim()
      .min(1, "El código no puede estar vacío")
      .max(20, "El código no puede exceder 20 caracteres"),

    descripcion: z
      .string({
        required_error: "La descripción de la talla es requerida",
        invalid_type_error: "La descripción debe ser una cadena de texto",
      })
      .trim()
      .min(1, "La descripción no puede estar vacía")
      .max(100, "La descripción no puede exceder 100 caracteres"),

    orden: z
      .number({
        invalid_type_error: "El orden debe ser un número",
      })
      .int("El orden debe ser un número entero")
      .nonnegative("El orden no puede ser negativo")
      .optional(),
  })
  .strict(); // Rechaza campos extra (prevención de mass assignment)

/**
 * Schema para actualizar una talla existente
 * Todos los campos son opcionales (actualización parcial)
 */
export const updateSizeSchema = z
  .object({
    codigo: z
      .string({
        invalid_type_error: "El código debe ser una cadena de texto",
      })
      .trim()
      .min(1, "El código no puede estar vacío")
      .max(20, "El código no puede exceder 20 caracteres")
      .optional(),

    descripcion: z
      .string({
        invalid_type_error: "La descripción debe ser una cadena de texto",
      })
      .trim()
      .min(1, "La descripción no puede estar vacía")
      .max(100, "La descripción no puede exceder 100 caracteres")
      .optional(),

    orden: z
      .number({
        invalid_type_error: "El orden debe ser un número",
      })
      .int("El orden debe ser un número entero")
      .nonnegative("El orden no puede ser negativo")
      .optional(),
  })
  .strict(); // Rechaza campos extra
