import { z } from "zod";

/**
 * Schema para crear un favorito (POST)
 */
export const createFavoritoSchema = z.object({
  productoId: z.string({
    required_error: "El ID del producto es requerido",
    invalid_type_error: "El ID del producto debe ser una cadena",
  }).min(1, "El ID del producto no puede estar vacío"),
});

/**
 * Schema para parámetro de ruta (DELETE /:productoId)
 */
export const productoIdParamSchema = z.object({
  productoId: z.string().min(1, "El ID del producto no puede estar vacío"),
});

/**
 * Schema para query de listado (paginación opcional)
 */
export const listFavoritosQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(100).optional().default(20),
  offset: z.coerce.number().int().nonnegative().optional().default(0),
});