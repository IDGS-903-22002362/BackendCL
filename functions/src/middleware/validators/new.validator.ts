import { z } from "zod";

/**
 * Schema para crear una nueva noticia
 * Valida todos los campos requeridos según el modelo Noticia
 */
export const createNewSchema = z
    .object({
        titulo: z
            .string({
                required_error: "El titulo de la noticia es requerida",
                invalid_type_error: "El titulo debe ser una cadena de texto",
            })
            .trim()
            .min(1, "El titulo no puede estar vacío")
            .max(100, "El titulo no puede exceder los 100 caracteres"),

        descripcion: z
            .string({
                required_error: "La descripción de la noticia es requerida",
                invalid_type_error: "La descripción debe ser una cadena de texto",
            })
            .trim()
            .min(1, "La descripción no puede estar vacía")
            .max(500, "La descripción no puede exceder 500 caracteres"),

        usuarioId: z
            .string({
                required_error: "El ID de usuario es requerido",
                invalid_type_error: "El ID del autor de la noticia debe ser una cadena de texto",
            })
            .optional(),

        imagenes: z
            .array(z.string().url("Las URLs de imágenes deben ser válidas"), {
                invalid_type_error: "Las imágenes deben ser un array de URLs",
            })
            .max(10, "No se pueden asignar más de 10 imágenes")
            .optional()
            .default([]),

        estatus: z
            .boolean({
                invalid_type_error: "El campo estatus debe ser un booleano",
            })
            .optional()
            .default(true),
        contenido: z
            .string()
            .min(1, "El contenido no puede estar vacío"),
    })
    .strict(); // Rechaza campos extra (prevención de mass assignment)

/**
 * Schema para actualizar una noticia existente
 * Todos los campos son opcionales (actualización parcial)
 */
export const updateNewSchema = z
    .object({
        titulo: z
            .string({
                required_error: "El titulo de la noticia es requerida",
                invalid_type_error: "El titulo debe ser una cadena de texto",
            })
            .trim()
            .min(1, "El titulo no puede estar vacío")
            .max(100, "El titulo no puede exceder los 100 caracteres"),

        descripcion: z
            .string({
                required_error: "La descripción de la noticia es requerida",
                invalid_type_error: "La descripción debe ser una cadena de texto",
            })
            .trim()
            .min(1, "La descripción no puede estar vacía")
            .max(500, "La descripción no puede exceder 500 caracteres"),

        usuarioId: z
            .string({
                required_error: "El ID de usuario es requerido",
                invalid_type_error: "El ID del autor de la noticia debe ser una cadena de texto",
            })
            .min(1, "El ID del autor no puede estar vacío"),

        imagenes: z
            .array(z.string().url("Las URLs de imágenes deben ser válidas"), {
                invalid_type_error: "Las imágenes deben ser un array de URLs",
            })
            .max(10, "No se pueden asignar más de 10 imágenes")
            .optional()
            .default([]),

        estatus: z
            .boolean({
                invalid_type_error: "El campo estatus debe ser un booleano",
            })
            .optional()
            .default(true),
    })
    .strict(); // Rechaza campos extra

/**
 * Schema para validar body al eliminar imagen de producto
 */
export const deleteImageSchema = z
    .object({
        imageUrl: z
            .string({
                required_error: "La URL de la imagen es requerida",
                invalid_type_error: "La URL debe ser una cadena de texto",
            })
            .url("La URL de la imagen debe ser válida")
            .min(1, "La URL no puede estar vacía"),
    })
    .strict();
