import { z } from "zod";

/**
 * Schema para validar emails (opcional pero válido si se proporciona)
 */
const optionalEmailSchema = z
  .string()
  .trim()
  .email("El email debe ser válido")
  .optional();

/**
 * Schema para validar teléfonos (opcional, formato flexible)
 */
const optionalPhoneSchema = z
  .string()
  .trim()
  .min(10, "El teléfono debe tener al menos 10 dígitos")
  .max(20, "El teléfono no puede exceder 20 caracteres")
  .optional();

/**
 * Schema para crear un nuevo proveedor
 * Valida todos los campos según el modelo Proveedor
 */
export const createProviderSchema = z
  .object({
    nombre: z
      .string({
        required_error: "El nombre del proveedor es requerido",
        invalid_type_error: "El nombre debe ser una cadena de texto",
      })
      .trim()
      .min(1, "El nombre no puede estar vacío")
      .max(100, "El nombre no puede exceder 100 caracteres"),

    contacto: z
      .string({
        invalid_type_error: "El contacto debe ser una cadena de texto",
      })
      .trim()
      .max(100, "El contacto no puede exceder 100 caracteres")
      .optional(),

    telefono: optionalPhoneSchema,

    email: optionalEmailSchema,

    direccion: z
      .string({
        invalid_type_error: "La dirección debe ser una cadena de texto",
      })
      .trim()
      .max(200, "La dirección no puede exceder 200 caracteres")
      .optional(),

    notas: z
      .string({
        invalid_type_error: "Las notas deben ser una cadena de texto",
      })
      .trim()
      .max(500, "Las notas no pueden exceder 500 caracteres")
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
 * Schema para actualizar un proveedor existente
 * Todos los campos son opcionales (actualización parcial)
 */
export const updateProviderSchema = z
  .object({
    nombre: z
      .string({
        invalid_type_error: "El nombre debe ser una cadena de texto",
      })
      .trim()
      .min(1, "El nombre no puede estar vacío")
      .max(100, "El nombre no puede exceder 100 caracteres")
      .optional(),

    contacto: z
      .string({
        invalid_type_error: "El contacto debe ser una cadena de texto",
      })
      .trim()
      .max(100, "El contacto no puede exceder 100 caracteres")
      .optional(),

    telefono: optionalPhoneSchema,

    email: optionalEmailSchema,

    direccion: z
      .string({
        invalid_type_error: "La dirección debe ser una cadena de texto",
      })
      .trim()
      .max(200, "La dirección no puede exceder 200 caracteres")
      .optional(),

    notas: z
      .string({
        invalid_type_error: "Las notas deben ser una cadena de texto",
      })
      .trim()
      .max(500, "Las notas no pueden exceder 500 caracteres")
      .optional(),

    activo: z
      .boolean({
        invalid_type_error: "El campo activo debe ser un booleano",
      })
      .optional(),
  })
  .strict(); // Rechaza campos extra
