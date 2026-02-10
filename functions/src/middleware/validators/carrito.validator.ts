/**
 * Schemas de validación para carrito de compras
 * Usa Zod para validación en runtime con TypeScript
 *
 * REGLAS DE VALIDACIÓN:
 * - Todos los schemas de body usan .strict() para prevenir mass assignment
 * - Strings de usuario usan .trim() para limpiar espacios
 * - Mensajes de error en español
 * - Cantidad máxima por item controlada por MAX_CANTIDAD_POR_ITEM
 */

import { z } from "zod";
import { MAX_CANTIDAD_POR_ITEM } from "../../models/carrito.model";
import { direccionEnvioSchema } from "./orden.validator";
import { MetodoPago } from "../../models/orden.model";

/**
 * Schema para agregar un item al carrito
 * POST /api/carrito/items
 *
 * NOTA: precioUnitario NO se recibe del cliente.
 * El servidor siempre lo obtiene del producto (precioPublico).
 */
export const addItemCarritoSchema = z
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
      .min(1, "La cantidad debe ser al menos 1")
      .max(
        MAX_CANTIDAD_POR_ITEM,
        `La cantidad máxima por producto es ${MAX_CANTIDAD_POR_ITEM}`,
      ),

    tallaId: z
      .string({
        invalid_type_error: "El ID de talla debe ser una cadena de texto",
      })
      .trim()
      .min(1, "El ID de talla no puede estar vacío")
      .optional(),
  })
  .strict();

/**
 * Schema para actualizar la cantidad de un item en el carrito
 * PUT /api/carrito/items/:productoId
 *
 * Si cantidad es 0, el item se elimina del carrito.
 */
export const updateItemCarritoSchema = z
  .object({
    cantidad: z
      .number({
        required_error: "La cantidad es requerida",
        invalid_type_error: "La cantidad debe ser un número",
      })
      .int("La cantidad debe ser un número entero")
      .min(0, "La cantidad no puede ser negativa")
      .max(
        MAX_CANTIDAD_POR_ITEM,
        `La cantidad máxima por producto es ${MAX_CANTIDAD_POR_ITEM}`,
      ),
  })
  .strict();

/**
 * Schema para validar el parámetro productoId en rutas /items/:productoId
 */
export const productoIdParamSchema = z.object({
  productoId: z
    .string({
      required_error: "El ID del producto es requerido",
      invalid_type_error: "El ID del producto debe ser una cadena de texto",
    })
    .min(1, "El ID del producto no puede estar vacío")
    .max(100, "El ID del producto es demasiado largo"),
});

/**
 * Schema para merge de carritos (sesión → usuario)
 * POST /api/carrito/merge
 */
export const mergeCarritoSchema = z
  .object({
    sessionId: z
      .string({
        required_error: "El sessionId es requerido para el merge",
        invalid_type_error: "El sessionId debe ser una cadena de texto",
      })
      .trim()
      .min(1, "El sessionId no puede estar vacío")
      .max(128, "El sessionId es demasiado largo"),
  })
  .strict();

/**
 * Schema para checkout del carrito (convertir carrito en orden)
 * POST /api/carrito/checkout
 *
 * NOTA: Los items, precios y totales se obtienen del carrito del servidor.
 * El cliente solo envía dirección de envío y método de pago.
 * El usuarioId se extrae del token de autenticación (authMiddleware).
 */
export const checkoutCarritoSchema = z
  .object({
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
