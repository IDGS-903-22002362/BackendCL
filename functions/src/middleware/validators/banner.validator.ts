import { z } from "zod";


const buttonSchema = z.object({
    text: z.string().min(1),
    url: z.string().min(1, "La URL es requerida"), // Ahora acepta rutas relativas
    style: z.enum(["primary", "secondary", "outline"]).optional(),
});

const contentConfigSchema = z.object({
    type: z.enum(["categoria", "linea", "talla", "productos", "oferta", "novedades", "mas_vendidos"]),
    categoriaId: z.string().optional(),
    lineaId: z.string().optional(),
    tallaId: z.string().optional(),
    productIds: z.array(z.string()).optional(),
    limit: z.number().int().min(1).max(50).default(10),
    sortBy: z.enum(["createdAt", "precioPublico", "mas_vendidos"]).default("createdAt"),
    sortOrder: z.enum(["asc", "desc"]).default("desc"),
    minDiscount: z.number().min(0).max(100).optional(),
}).refine(data => {
    if (data.type === "categoria") return !!data.categoriaId;
    if (data.type === "linea") return !!data.lineaId;
    if (data.type === "talla") return !!data.tallaId;
    if (data.type === "productos") return data.productIds && data.productIds.length > 0;
    return true;
}, { message: "Faltan parámetros para el tipo de contenido seleccionado" });

export const createBannerSchema = z.object({
    title: z.string().min(1),
    subtitle: z.string().optional(),
    backgroundImage: z.string().url().optional(), // opcional
    videoUrl: z.string().url().optional(),        // opcional
    buttons: z.array(buttonSchema).default([]),
    contentConfig: contentConfigSchema,
    active: z.boolean().default(false),
    order: z.number().int().optional(),
});

export const updateBannerSchema = createBannerSchema.partial();