import { z } from "zod";

const IMAGE_MAX_SIZE_BYTES = 10 * 1024 * 1024;
const VIDEO_MAX_SIZE_BYTES = 200 * 1024 * 1024;

const IMAGE_CONTENT_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp"] as const;
const VIDEO_CONTENT_TYPES = ["video/mp4", "video/webm", "video/quicktime"] as const;

/**
 * Crear galeria
 */
export const createGallerySchema = z
    .object({
        descripcion: z
            .string()
            .trim()
            .min(1, "La descripcion no puede estar vacia")
            .max(300, "La descripcion no puede exceder 300 caracteres"),

        imagenes: z
            .array(z.string().url("URL de imagen invalida"))
            .max(20, "Maximo 20 imagenes")
            .optional()
            .default([]),

        videos: z
            .array(z.string().url("URL de video invalida"))
            .max(10, "Maximo 10 videos")
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
 * Eliminar imagen de galeria
 */
export const deleteGalleryImageSchema = z
    .object({
        imageUrl: z
            .string({
                required_error: "La URL de la imagen es requerida",
            })
            .url("La URL de la imagen debe ser valida"),
    })
    .strict();

/**
 * Eliminar video de galeria
 */
export const deleteGalleryVideoSchema = z
    .object({
        videoUrl: z
            .string({
                required_error: "La URL del video es requerida",
            })
            .url("La URL del video debe ser valida"),
    })
    .strict();

export const createGalleryMediaMetadataSchema = (galeriaId: string) =>
    z
        .object({
            tipo: z.enum(["imagen", "video"], {
                required_error: "El tipo es requerido",
                invalid_type_error: "El tipo debe ser imagen o video",
            }),
            url: z
                .string({
                    required_error: "La URL es requerida",
                })
                .url("La URL debe ser valida"),
            storagePath: z
                .string({
                    required_error: "El storagePath es requerido",
                })
                .min(1, "El storagePath es requerido"),
            contentType: z
                .string({
                    required_error: "El contentType es requerido",
                })
                .min(1, "El contentType es requerido"),
            size: z
                .number({
                    required_error: "El size es requerido",
                    invalid_type_error: "El size debe ser numerico",
                })
                .positive("El size debe ser mayor a 0"),
            nombreOriginal: z
                .string({
                    required_error: "El nombreOriginal es requerido",
                })
                .trim()
                .min(1, "El nombreOriginal es requerido"),
            width: z.number().positive("El width debe ser mayor a 0").optional(),
            height: z.number().positive("El height debe ser mayor a 0").optional(),
            duration: z.number().positive("El duration debe ser mayor a 0").optional(),
            orden: z.number().int("El orden debe ser entero").nonnegative("El orden no puede ser negativo").optional(),
        })
        .strict()
        .superRefine((data, ctx) => {
            const expectedPrefix = `galeria/${galeriaId}/`;
            if (!data.storagePath.startsWith(expectedPrefix)) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    path: ["storagePath"],
                    message: `El storagePath debe pertenecer a ${expectedPrefix}`,
                });
            }

            if (data.tipo === "imagen") {
                if (!IMAGE_CONTENT_TYPES.includes(data.contentType as typeof IMAGE_CONTENT_TYPES[number])) {
                    ctx.addIssue({
                        code: z.ZodIssueCode.custom,
                        path: ["contentType"],
                        message: "contentType no permitido para imagen",
                    });
                }

                if (data.size > IMAGE_MAX_SIZE_BYTES) {
                    ctx.addIssue({
                        code: z.ZodIssueCode.custom,
                        path: ["size"],
                        message: "La imagen excede el limite de 10MB",
                    });
                }
            }

            if (data.tipo === "video") {
                if (!VIDEO_CONTENT_TYPES.includes(data.contentType as typeof VIDEO_CONTENT_TYPES[number])) {
                    ctx.addIssue({
                        code: z.ZodIssueCode.custom,
                        path: ["contentType"],
                        message: "contentType no permitido para video",
                    });
                }

                if (data.size > VIDEO_MAX_SIZE_BYTES) {
                    ctx.addIssue({
                        code: z.ZodIssueCode.custom,
                        path: ["size"],
                        message: "El video excede el limite de 200MB",
                    });
                }
            }
        });

