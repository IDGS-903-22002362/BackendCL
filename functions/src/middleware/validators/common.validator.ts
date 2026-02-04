import { z } from "zod";

/**
 * Schema para validar parámetros de ID en rutas /:id
 * Previene inyección y valida longitud razonable
 */
export const idParamSchema = z.object({
  id: z
    .string({
      required_error: "El ID es requerido",
      invalid_type_error: "El ID debe ser una cadena de texto",
    })
    .min(1, "El ID no puede estar vacío")
    .max(100, "El ID es demasiado largo"),
});

/**
 * Schema para validar términos de búsqueda en rutas /buscar/:termino
 * Previene inyección y valida longitud razonable
 */
export const searchTermSchema = z.object({
  termino: z
    .string({
      required_error: "El término de búsqueda es requerido",
      invalid_type_error: "El término debe ser una cadena de texto",
    })
    .min(1, "El término de búsqueda no puede estar vacío")
    .max(100, "El término de búsqueda es demasiado largo"),
});

/**
 * Schema para validar parámetros de lineaId en rutas /linea/:lineaId
 */
export const lineaIdParamSchema = z.object({
  lineaId: z
    .string({
      required_error: "El ID de línea es requerido",
      invalid_type_error: "El ID de línea debe ser una cadena de texto",
    })
    .min(1, "El ID de línea no puede estar vacío")
    .max(100, "El ID de línea es demasiado largo"),
});

/**
 * Schema para validar parámetros de categoriaId en rutas /categoria/:categoriaId
 */
export const categoriaIdParamSchema = z.object({
  categoriaId: z
    .string({
      required_error: "El ID de categoría es requerido",
      invalid_type_error: "El ID de categoría debe ser una cadena de texto",
    })
    .min(1, "El ID de categoría no puede estar vacío")
    .max(100, "El ID de categoría es demasiado largo"),
});
