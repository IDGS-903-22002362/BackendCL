import { Timestamp } from "firebase-admin/firestore";
import { CatalogProductCardDTO } from "./product-catalog.model";

export enum RecomendacionEstrategia {
  RECIENTEMENTE_VISTOS = "recientemente_vistos",
  PARA_TI = "para_ti",
  MAS_VENDIDOS = "mas_vendidos",
  TENDENCIAS = "tendencias",
  POPULARIDAD = "popularidad",
  SIMILARES = "similares",
  COMPRADOS_JUNTOS = "comprados_juntos",
  COMPLEMENTOS_CARRITO = "complementos_carrito",
  COMPRAR_NUEVAMENTE = "comprar_nuevamente",
  NOVEDADES = "novedades",
  OFERTAS_RELEVANTES = "ofertas_relevantes",
  POR_CATEGORIA = "por_categoria",
  POR_LINEA = "por_linea",
  POR_TALLA = "por_talla",
  POR_PRECIO = "por_precio",
}

export enum RecomendacionEventoTipo {
  VISTA_PRODUCTO = "vista_producto",
  CLIC_PRODUCTO = "clic_producto",
  CLIC_RECOMENDACION = "clic_recomendacion",
  IMPRESION_RECOMENDACION = "impresion_recomendacion",
  AGREGAR_CARRITO = "agregar_carrito",
  INICIO_CHECKOUT = "inicio_checkout",
  COMPRA = "compra",
  FAVORITO = "favorito",
}

export enum RecomendacionSuperficie {
  HOME = "home",
  PRODUCTO = "producto",
  CARRITO = "carrito",
  CUENTA = "cuenta",
  CHECKOUT = "checkout",
  ADMIN = "admin",
}

export interface RecomendacionEvento {
  id?: string;
  tipo: RecomendacionEventoTipo;
  productoId?: string;
  productoIds?: string[];
  estrategia?: RecomendacionEstrategia;
  superficie?: RecomendacionSuperficie;
  seccionId?: string;
  usuarioId?: string | null;
  visitanteId?: string;
  sessionId?: string;
  metadata?: Record<string, unknown>;
  createdAt: Timestamp;
  expiresAt?: Timestamp;
}

export interface RecomendacionVisitante {
  id?: string;
  visitanteId: string;
  sessionIds: string[];
  usuarioId?: string | null;
  mergedAt?: Timestamp | null;
  ultimoEventoAt?: Timestamp;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface RecomendacionPesoEstrategia {
  estrategia: RecomendacionEstrategia;
  peso: number;
  activo: boolean;
}

export interface RecomendacionSeccionConfig {
  id: string;
  titulo: string;
  subtitulo?: string;
  estrategia: RecomendacionEstrategia;
  activo: boolean;
  limite: number;
  orden: number;
  superficie: RecomendacionSuperficie;
  productoIdsFijados?: string[];
  exclusionProductoIds?: string[];
  exclusionCategoriaIds?: string[];
  exclusionLineaIds?: string[];
  filtros?: {
    categoriaId?: string;
    lineaId?: string;
    tallaId?: string;
    minPrice?: number;
    maxPrice?: number;
  };
}

export interface RecomendacionConfigGlobal {
  id: "global";
  secciones: RecomendacionSeccionConfig[];
  pesos: RecomendacionPesoEstrategia[];
  exclusionGlobalProductoIds: string[];
  retencionEventosDias: number;
  cacheTtlSegundos: number;
  diversificacionMaxPorCategoria: number;
  diversificacionMaxPorLinea: number;
  abVariant?: string;
  updatedAt: Timestamp;
  updatedBy?: string;
}

export interface RecomendacionAgregadoProducto {
  productoId: string;
  score: number;
  ventasPagadas?: number;
  vistas?: number;
  clics?: number;
  crecimiento?: number;
  popularidad?: number;
}

export interface RecomendacionAgregadoDocumento {
  id: string;
  tipo: "mas_vendidos" | "tendencias" | "popularidad" | "comprados_juntos";
  productoId?: string;
  items: RecomendacionAgregadoProducto[];
  pares?: Array<{ productoIdA: string; productoIdB: string; score: number }>;
  calculatedAt: Timestamp;
  expiresAt: Timestamp;
}

export interface RecomendacionCacheDocumento {
  id: string;
  contextKey: string;
  estrategia: RecomendacionEstrategia;
  productoIds: string[];
  createdAt: Timestamp;
  expiresAt: Timestamp;
}

export interface RecomendacionMetricasDiarias {
  id: string;
  fecha: string;
  impresiones: number;
  clics: number;
  agregadosCarrito: number;
  compras: number;
  conversionesAtribuidas: number;
  porEstrategia: Record<
    string,
    {
      impresiones: number;
      clics: number;
      agregadosCarrito: number;
      compras: number;
    }
  >;
  updatedAt: Timestamp;
}

export interface RecomendacionContexto {
  usuarioId?: string | null;
  visitanteId?: string;
  sessionId?: string;
  superficie: RecomendacionSuperficie;
  productoId?: string;
  productoIdsCarrito?: string[];
  categoriaId?: string;
  lineaId?: string;
  tallaId?: string;
  minPrice?: number;
  maxPrice?: number;
  limite?: number;
  exclusionIds?: string[];
}

export interface RecomendacionCandidato {
  productoId: string;
  score: number;
  estrategia: RecomendacionEstrategia;
}

export interface RecomendacionRespuesta {
  estrategia: RecomendacionEstrategia;
  seccionId?: string;
  titulo: string;
  subtitulo?: string;
  items: CatalogProductCardDTO[];
  meta: {
    total: number;
    limite: number;
    hasMore: boolean;
  };
}

export interface RecomendacionHomeRespuesta {
  secciones: RecomendacionRespuesta[];
}
