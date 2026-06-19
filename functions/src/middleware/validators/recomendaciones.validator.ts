import { z } from "zod";
import { RecomendacionEstrategia, RecomendacionEventoTipo, RecomendacionSuperficie } from "../../models/recomendaciones.model";

export const trackEventSchema = z.object({
  tipo: z.nativeEnum(RecomendacionEventoTipo),
  productoId: z.string().trim().optional(),
  productoIds: z.array(z.string().trim()).max(20).optional(),
  estrategia: z.nativeEnum(RecomendacionEstrategia).optional(),
  superficie: z.nativeEnum(RecomendacionSuperficie).optional(),
  seccionId: z.string().trim().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export const trackEventsBatchSchema = z.object({
  events: z.array(trackEventSchema).min(1).max(20),
});

export const recommendationsQuerySchema = z.object({
  estrategia: z.nativeEnum(RecomendacionEstrategia),
  limite: z.coerce.number().int().min(1).max(24).optional(),
  productoId: z.string().trim().optional(),
  productoIdsCarrito: z.string().trim().optional(),
  categoriaId: z.string().trim().optional(),
  lineaId: z.string().trim().optional(),
  tallaId: z.string().trim().optional(),
  minPrice: z.coerce.number().optional(),
  maxPrice: z.coerce.number().optional(),
});

export const homeRecommendationsQuerySchema = z.object({
  limite: z.coerce.number().int().min(1).max(24).optional(),
});

export const mergeIdentitySchema = z.object({
  sessionId: z.string().trim().min(8),
});

export const adminConfigUpdateSchema = z.object({
  secciones: z.array(z.any()).optional(),
  pesos: z.array(z.any()).optional(),
  exclusionGlobalProductoIds: z.array(z.string()).optional(),
  retencionEventosDias: z.number().int().min(7).max(365).optional(),
  cacheTtlSegundos: z.number().int().min(30).max(86400).optional(),
  diversificacionMaxPorCategoria: z.number().int().min(1).max(10).optional(),
  diversificacionMaxPorLinea: z.number().int().min(1).max(10).optional(),
  abVariant: z.string().trim().optional(),
});

export const adminMetricsQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(90).optional(),
});

export const productoIdParamSchema = z.object({
  productoId: z.string().trim().min(1),
});
