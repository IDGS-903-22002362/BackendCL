import { z } from "zod";

const imagenPrincipalSchema = z
  .string({
    invalid_type_error: "La imagen principal debe ser una URL",
  })
  .trim()
  .url("La imagen principal debe ser una URL valida")
  .max(2048, "La URL de la imagen principal no puede exceder 2048 caracteres")
  .nullable()
  .optional();

/**
 * Schema para crear una nueva categoría
 * Valida todos los campos según el modelo Categoria
 */
export const createCategorySchema = z
  .object({
    nombre: z
      .string({
        required_error: "El nombre de la categoría es requerido",
        invalid_type_error: "El nombre debe ser una cadena de texto",
      })
      .trim()
      .min(1, "El nombre no puede estar vacío")
      .max(100, "El nombre no puede exceder 100 caracteres"),

    imagenPrincipal: imagenPrincipalSchema,

    lineaId: z
      .string({
        invalid_type_error: "El ID de línea debe ser una cadena de texto",
      })
      .min(1, "El ID de línea no puede estar vacío")
      .optional(),

    orden: z
      .number({
        invalid_type_error: "El orden debe ser un número",
      })
      .int("El orden debe ser un número entero")
      .nonnegative("El orden no puede ser negativo")
      .optional(),

    activo: z
      .boolean({
        invalid_type_error: "El campo activo debe ser un booleano",
      })
      .optional()
      .default(true),
  })
  .strict(); // Rechaza campos extra (prevención de mass assignment)

/**
 * Schema para actualizar una categoría existente
 * Todos los campos son opcionales (actualización parcial)
 */
export const updateCategorySchema = z
  .object({
    nombre: z
      .string({
        invalid_type_error: "El nombre debe ser una cadena de texto",
      })
      .trim()
      .min(1, "El nombre no puede estar vacío")
      .max(100, "El nombre no puede exceder 100 caracteres")
      .optional(),

    imagenPrincipal: imagenPrincipalSchema,

    lineaId: z
      .string({
        invalid_type_error: "El ID de línea debe ser una cadena de texto",
      })
      .min(1, "El ID de línea no puede estar vacío")
      .optional(),

    orden: z
      .number({
        invalid_type_error: "El orden debe ser un número",
      })
      .int("El orden debe ser un número entero")
      .nonnegative("El orden no puede ser negativo")
      .optional(),

    activo: z
      .boolean({
        invalid_type_error: "El campo activo debe ser un booleano",
      })
      .optional(),
  })
  .strict(); // Rechaza campos extra
