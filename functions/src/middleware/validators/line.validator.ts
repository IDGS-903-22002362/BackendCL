import { z } from "zod";

/**
 * Schema para crear una nueva línea
 * Valida todos los campos requeridos según el modelo Linea
 */
export const createLineSchema = z
  .object({
    codigo: z
      .number({
        required_error: "El código de la línea es requerido",
        invalid_type_error: "El código debe ser un número",
      })
      .int("El código debe ser un número entero")
      .positive("El código debe ser mayor a 0"),

    nombre: z
      .string({
        required_error: "El nombre de la línea es requerido",
        invalid_type_error: "El nombre debe ser una cadena de texto",
      })
      .trim()
      .min(1, "El nombre no puede estar vacío")
      .max(100, "El nombre no puede exceder 100 caracteres"),

    activo: z
      .boolean({
        invalid_type_error: "El campo activo debe ser un booleano",
      })
      .optional()
      .default(true),
  })
  .strict(); // Rechaza campos extra (prevención de mass assignment)

/**
 * Schema para actualizar una línea existente
 * Todos los campos son opcionales (actualización parcial)
 */
export const updateLineSchema = z
  .object({
    codigo: z
      .number({
        invalid_type_error: "El código debe ser un número",
      })
      .int("El código debe ser un número entero")
      .positive("El código debe ser mayor a 0")
      .optional(),

    nombre: z
      .string({
        invalid_type_error: "El nombre debe ser una cadena de texto",
      })
      .trim()
      .min(1, "El nombre no puede estar vacío")
      .max(100, "El nombre no puede exceder 100 caracteres")
      .optional(),

    activo: z
      .boolean({
        invalid_type_error: "El campo activo debe ser un booleano",
      })
      .optional(),
  })
  .strict(); // Rechaza campos extra
