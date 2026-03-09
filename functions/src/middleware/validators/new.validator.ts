import { z } from "zod";

/**
 * Schema para crear una nueva noticia
 * Valida todos los campos requeridos según el modelo Noticia
 */
export const createNewSchema = z
    .object({
        titulo: z
            .string()
            .trim()
            .min(1, "El título no puede estar vacío")
            .max(100, "El título no puede exceder 100 caracteres"),
        descripcion: z
            .string()
            .trim()
            .min(1, "La descripción no puede estar vacía")
            .max(500, "La descripción no puede exceder 500 caracteres"),
        contenido: z
            .string()
            .min(1, "El contenido no puede estar vacío"),
        imagenes: z
            .array(z.string().url("URL de imagen inválida"))
            .max(10, "Máximo 10 imágenes")
            .optional()
            .default([]),
        categoria: z
            .enum(["femenil", "varonil", "mixto"], {
                required_error: "La categoría es obligatoria",
                invalid_type_error: "Categoría no válida",
            }),
    })
    .strict(); // Rechaza campos extra (prevención de mass assignment)

/**
 * Schema para actualizar una noticia existente
 * Todos los campos son opcionales (actualización parcial)
 */
export const updateNewSchema = z
    .object({
        titulo: z.string().trim().min(1).max(100).optional(),
        descripcion: z.string().trim().min(1).max(500).optional(),
        contenido: z.string().min(1).optional(),
        imagenes: z.array(z.string().url()).max(10).optional(),
        estatus: z.boolean().optional(),
        categoria: z.enum(["femenil", "varonil", "mixto"]).optional(),
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
