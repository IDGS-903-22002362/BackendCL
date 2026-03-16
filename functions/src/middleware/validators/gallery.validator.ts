import { z } from "zod";

/**
 * Crear galería
 */
export const createGallerySchema = z
    .object({
        descripcion: z
            .string()
            .trim()
            .min(1, "La descripción no puede estar vacía")
            .max(300, "La descripción no puede exceder 300 caracteres"),

        imagenes: z
            .array(z.string().url("URL de imagen inválida"))
            .max(20, "Máximo 20 imágenes")
            .optional()
            .default([]),

        videos: z
            .array(z.string().url("URL de video inválida"))
            .max(10, "Máximo 10 videos")
            .optional()
            .default([]),
    })
    .strict()
    .refine(
        (data) => data.imagenes.length > 0 || data.videos.length > 0,
        {
            message: "Debe incluir al menos una imagen o un video",
            path: ["imagenes"],
        }
    );

/**
 * Eliminar imagen de galería
 */
export const deleteGalleryImageSchema = z
    .object({
        imageUrl: z
            .string({
                required_error: "La URL de la imagen es requerida",
            })
            .url("La URL de la imagen debe ser válida"),
    })
    .strict();

/**
 * Eliminar video de galería
 */
export const deleteGalleryVideoSchema = z
    .object({
        videoUrl: z
            .string({
                required_error: "La URL del video es requerida",
            })
            .url("La URL del video debe ser válida"),
    })
    .strict();