// schemas/detalleProducto.schema.ts
import { z } from "zod";

/**
 * Esquema para crear un nuevo detalle de producto.
 */
export const createDetalleProductoSchema = z
    .object({
        descripcion: z
            .string({
                required_error: "La descripción del detalle es requerida",
                invalid_type_error: "La descripción debe ser una cadena de texto",
            })
            .trim()
            .min(1, "La descripción no puede estar vacía")
            .max(500, "La descripción no puede exceder 500 caracteres"),
    })
    .strict();

/**
 * Esquema para actualizar un detalle de producto (todos los campos opcionales).
 */
export const updateDetalleProductoSchema = z
    .object({
        descripcion: z
            .string({
                invalid_type_error: "La descripción debe ser una cadena de texto",
            })
            .trim()
            .min(1, "La descripción no puede estar vacía")
            .max(500, "La descripción no puede exceder 500 caracteres")
            .optional(),
    })
    .strict();