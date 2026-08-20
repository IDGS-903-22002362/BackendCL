import { z } from "zod";
import { RecomendacionEstrategia, RecomendacionEventoTipo, RecomendacionSuperficie } from "../../models/recomendaciones.model";

/**
 * Metadata permitida en telemetria. Es una lista blanca: cualquier otra clave
 * se descarta antes de persistir (comportamiento por defecto de z.object) para
 * que nunca llegue informacion personal a la coleccion de eventos.
 */
const eventMetadataSchema = z.object({
  /** Ruta visitada, sin query string. */
  path: z.string().trim().max(160).optional(),
  source: z.string().trim().max(60).optional(),
  medium: z.string().trim().max(60).optional(),
  campaign: z.string().trim().max(60).optional(),
  referrerHost: z.string().trim().max(120).optional(),
  /** Termino buscado, ya normalizado por el cliente. */
  term: z.string().trim().max(80).optional(),
  resultCount: z.number().int().min(0).max(100000).optional(),
  quantity: z.number().int().min(1).max(999).optional(),
  /** Clave de idempotencia de compra. */
  ordenId: z.string().trim().max(120).optional(),
  orderId: z.string().trim().max(120).optional(),
  atribuidoRecomendacion: z.boolean().optional(),
});

export const trackEventSchema = z.object({
  tipo: z.nativeEnum(RecomendacionEventoTipo),
  productoId: z.string().trim().optional(),
  productoIds: z.array(z.string().trim()).max(20).optional(),
  estrategia: z.nativeEnum(RecomendacionEstrategia).optional(),
  superficie: z.nativeEnum(RecomendacionSuperficie).optional(),
  seccionId: z.string().trim().optional(),
  metadata: eventMetadataSchema.optional(),
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
