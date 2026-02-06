/**
 * Schemas de validación para órdenes de compra
 * Usa Zod para validación en runtime con TypeScript
 *
 * REGLAS DE VALIDACIÓN:
 * - Todos los schemas de body usan .strict() para prevenir mass assignment
 * - Strings de usuario usan .trim() para limpiar espacios
 * - Mensajes de error en español
 * - Validación de formatos (teléfono, código postal)
 */

import { z } from "zod";
import { EstadoOrden, MetodoPago } from "../../models/orden.model";

/**
 * Schema para validar items individuales de la orden
 * Valida producto, cantidad, precios y subtotal
 */
export const itemOrdenSchema = z
  .object({
    productoId: z
      .string({
        required_error: "El ID del producto es requerido",
        invalid_type_error: "El ID del producto debe ser una cadena de texto",
      })
      .trim()
      .min(1, "El ID del producto no puede estar vacío"),

    cantidad: z
      .number({
        required_error: "La cantidad es requerida",
        invalid_type_error: "La cantidad debe ser un número",
      })
      .int("La cantidad debe ser un número entero")
      .min(1, "La cantidad debe ser al menos 1"),

    precioUnitario: z
      .number({
        required_error: "El precio unitario es requerido",
        invalid_type_error: "El precio unitario debe ser un número",
      })
      .positive("El precio unitario debe ser mayor a 0"),

    subtotal: z
      .number({
        required_error: "El subtotal es requerido",
        invalid_type_error: "El subtotal debe ser un número",
      })
      .nonnegative("El subtotal no puede ser negativo"),

    tallaId: z.string().trim().optional(),
  })
  .strict();

/**
 * Schema para validar dirección de envío
 * Valida estructura completa de dirección en México
 */
export const direccionEnvioSchema = z
  .object({
    nombre: z
      .string({
        required_error: "El nombre del destinatario es requerido",
        invalid_type_error: "El nombre debe ser una cadena de texto",
      })
      .trim()
      .min(1, "El nombre no puede estar vacío")
      .max(100, "El nombre no puede exceder 100 caracteres"),

    telefono: z
      .string({
        required_error: "El teléfono es requerido",
        invalid_type_error: "El teléfono debe ser una cadena de texto",
      })
      .trim()
      .regex(/^\d{10}$/, "El teléfono debe tener exactamente 10 dígitos"),

    calle: z
      .string({
        required_error: "La calle es requerida",
        invalid_type_error: "La calle debe ser una cadena de texto",
      })
      .trim()
      .min(1, "La calle no puede estar vacía")
      .max(200, "La calle no puede exceder 200 caracteres"),

    numero: z
      .string({
        required_error: "El número exterior es requerido",
        invalid_type_error: "El número debe ser una cadena de texto",
      })
      .trim()
      .min(1, "El número exterior no puede estar vacío"),

    numeroInterior: z.string().trim().optional(),

    colonia: z
      .string({
        required_error: "La colonia es requerida",
        invalid_type_error: "La colonia debe ser una cadena de texto",
      })
      .trim()
      .min(1, "La colonia no puede estar vacía")
      .max(100, "La colonia no puede exceder 100 caracteres"),

    ciudad: z
      .string({
        required_error: "La ciudad es requerida",
        invalid_type_error: "La ciudad debe ser una cadena de texto",
      })
      .trim()
      .min(1, "La ciudad no puede estar vacía")
      .max(100, "La ciudad no puede exceder 100 caracteres"),

    estado: z
      .string({
        required_error: "El estado es requerido",
        invalid_type_error: "El estado debe ser una cadena de texto",
      })
      .trim()
      .min(1, "El estado no puede estar vacío")
      .max(50, "El estado no puede exceder 50 caracteres"),

    codigoPostal: z
      .string({
        required_error: "El código postal es requerido",
        invalid_type_error: "El código postal debe ser una cadena de texto",
      })
      .trim()
      .regex(/^\d{5}$/, "El código postal debe tener exactamente 5 dígitos"),

    referencias: z
      .string()
      .trim()
      .max(500, "Las referencias no pueden exceder 500 caracteres")
      .optional(),
  })
  .strict();

/**
 * Schema para crear una nueva orden
 * Valida todos los campos requeridos con strict mode
 */
export const createOrdenSchema = z
  .object({
    usuarioId: z
      .string({
        required_error: "El ID del usuario es requerido",
        invalid_type_error: "El ID del usuario debe ser una cadena de texto",
      })
      .trim()
      .min(1, "El ID del usuario no puede estar vacío"),

    items: z
      .array(itemOrdenSchema, {
        required_error: "Los items de la orden son requeridos",
        invalid_type_error: "Los items deben ser un array",
      })
      .min(1, "La orden debe tener al menos un producto"),

    subtotal: z
      .number({
        required_error: "El subtotal es requerido",
        invalid_type_error: "El subtotal debe ser un número",
      })
      .nonnegative("El subtotal no puede ser negativo"),

    impuestos: z
      .number({
        required_error: "Los impuestos son requeridos",
        invalid_type_error: "Los impuestos deben ser un número",
      })
      .nonnegative("Los impuestos no pueden ser negativos"),

    total: z
      .number({
        required_error: "El total es requerido",
        invalid_type_error: "El total debe ser un número",
      })
      .positive("El total debe ser mayor a 0"),

    estado: z
      .nativeEnum(EstadoOrden, {
        errorMap: () => ({
          message: `El estado debe ser uno de: ${Object.values(EstadoOrden).join(", ")}`,
        }),
      })
      .optional()
      .default(EstadoOrden.PENDIENTE),

    direccionEnvio: direccionEnvioSchema,

    metodoPago: z.nativeEnum(MetodoPago, {
      errorMap: () => ({
        message: `El método de pago debe ser uno de: ${Object.values(MetodoPago).join(", ")}`,
      }),
    }),

    costoEnvio: z
      .number()
      .nonnegative("El costo de envío no puede ser negativo")
      .optional(),

    notas: z
      .string()
      .trim()
      .max(1000, "Las notas no pueden exceder 1000 caracteres")
      .optional(),
  })
  .strict();

/**
 * Schema para actualizar una orden existente
 * Todos los campos son opcionales para actualizaciones parciales
 */
export const updateOrdenSchema = z
  .object({
    estado: z
      .nativeEnum(EstadoOrden, {
        errorMap: () => ({
          message: `El estado debe ser uno de: ${Object.values(EstadoOrden).join(", ")}`,
        }),
      })
      .optional(),

    transaccionId: z.string().trim().optional(),

    referenciaPago: z.string().trim().optional(),

    numeroGuia: z.string().trim().optional(),

    transportista: z
      .string()
      .trim()
      .max(100, "El transportista no puede exceder 100 caracteres")
      .optional(),

    costoEnvio: z
      .number()
      .nonnegative("El costo de envío no puede ser negativo")
      .optional(),

    notas: z
      .string()
      .trim()
      .max(1000, "Las notas no pueden exceder 1000 caracteres")
      .optional(),
  })
  .strict();

/**
 * Schema para actualizar estado de orden
 * Solo permite cambiar el estado (endpoint específico PUT /api/ordenes/:id/estado)
 * Usa .strict() para prevenir mass assignment
 */
export const updateEstadoOrdenSchema = z
  .object({
    estado: z.nativeEnum(EstadoOrden, {
      required_error: "El estado es requerido",
      invalid_type_error: "El estado debe ser válido",
      errorMap: () => ({
        message: `El estado debe ser uno de: ${Object.values(EstadoOrden).join(", ")}`,
      }),
    }),
  })
  .strict();

/**
 * Schema para query params de listado de órdenes (GET /api/ordenes)
 * Filtros opcionales para buscar órdenes
 *
 * NOTAS IMPORTANTES:
 * - NO usa .strict() porque los query params pueden tener parámetros adicionales del framework
 * - Todos los filtros son opcionales
 * - estado: puede ser múltiples valores separados por coma (ej: "PENDIENTE,CONFIRMADA")
 * - fechaDesde/fechaHasta: deben ser ISO 8601 datetime (ej: "2024-01-01T00:00:00Z")
 * - usuarioId: solo para admins (clientes siempre ven sus órdenes)
 */
export const listOrdenesQuerySchema = z.object({
  /**
   * Filtrar por estado(s) de orden
   * Múltiples valores separados por coma: "PENDIENTE,CONFIRMADA,EN_PROCESO"
   * Ejemplo: ?estado=PENDIENTE
   * Ejemplo: ?estado=PENDIENTE,CONFIRMADA
   */
  estado: z
    .string()
    .optional()
    .refine(
      (val) => {
        if (!val) return true; // Si es undefined/vacío, es válido
        // Validar que cada estado en el CSV sea válido
        const estados = val.split(",").map((e) => e.trim());
        return estados.every((e) =>
          Object.values(EstadoOrden).includes(e as EstadoOrden),
        );
      },
      {
        message: `Los estados deben ser válidos: ${Object.values(EstadoOrden).join(", ")}`,
      },
    ),

  /**
   * Filtrar por usuario específico
   * Solo para admins/empleados (clientes siempre ven sus órdenes)
   * Ejemplo: ?usuarioId=abc123xyz
   */
  usuarioId: z.string().trim().optional(),

  /**
   * Filtrar por fecha desde (inclusive)
   * Formato: ISO 8601 datetime con zona horaria
   * Ejemplo: ?fechaDesde=2024-01-01T00:00:00Z
   * Ejemplo: ?fechaDesde=2024-01-01T00:00:00-06:00
   */
  fechaDesde: z
    .string()
    .datetime({
      message:
        "fechaDesde debe ser una fecha válida en formato ISO 8601 (ej: 2024-01-01T00:00:00Z)",
    })
    .optional(),

  /**
   * Filtrar por fecha hasta (inclusive)
   * Formato: ISO 8601 datetime con zona horaria
   * Ejemplo: ?fechaHasta=2024-12-31T23:59:59Z
   */
  fechaHasta: z
    .string()
    .datetime({
      message:
        "fechaHasta debe ser una fecha válida en formato ISO 8601 (ej: 2024-12-31T23:59:59Z)",
    })
    .optional(),
});
