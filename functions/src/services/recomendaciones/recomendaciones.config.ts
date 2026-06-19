import {
  RecomendacionConfigGlobal,
  RecomendacionEstrategia,
  RecomendacionSeccionConfig,
  RecomendacionSuperficie,
} from "../../models/recomendaciones.model";

export const RECOMENDACIONES_DEFAULT_RETENTION_DAYS = 90;
export const RECOMENDACIONES_DEFAULT_CACHE_TTL_SECONDS = 300;
export const RECOMENDACIONES_MAX_EVENTOS_POR_MINUTO = 60;
export const RECOMENDACIONES_MAX_PRODUCTOS_POR_RESPUESTA = 24;
export const RECOMENDACIONES_DEFAULT_LIMIT = 12;

export const DEFAULT_HOME_SECCIONES: RecomendacionSeccionConfig[] = [
  {
    id: "home-para-ti",
    titulo: "Seleccionado para ti",
    subtitulo: "Basado en tu actividad reciente",
    estrategia: RecomendacionEstrategia.PARA_TI,
    activo: true,
    limite: 12,
    orden: 1,
    superficie: RecomendacionSuperficie.HOME,
  },
  {
    id: "home-mas-vendidos",
    titulo: "Los más vendidos",
    subtitulo: "Favoritos de la afición",
    estrategia: RecomendacionEstrategia.MAS_VENDIDOS,
    activo: true,
    limite: 12,
    orden: 2,
    superficie: RecomendacionSuperficie.HOME,
  },
  {
    id: "home-tendencias",
    titulo: "En tendencia",
    subtitulo: "Lo que está creciendo esta semana",
    estrategia: RecomendacionEstrategia.TENDENCIAS,
    activo: true,
    limite: 12,
    orden: 3,
    superficie: RecomendacionSuperficie.HOME,
  },
  {
    id: "home-ofertas",
    titulo: "Ofertas para ti",
    subtitulo: "Ahorra en piezas seleccionadas",
    estrategia: RecomendacionEstrategia.OFERTAS_RELEVANTES,
    activo: true,
    limite: 12,
    orden: 4,
    superficie: RecomendacionSuperficie.HOME,
  },
];

export const DEFAULT_PESOS: RecomendacionConfigGlobal["pesos"] = [
  { estrategia: RecomendacionEstrategia.PARA_TI, peso: 1.2, activo: true },
  { estrategia: RecomendacionEstrategia.MAS_VENDIDOS, peso: 1.0, activo: true },
  { estrategia: RecomendacionEstrategia.TENDENCIAS, peso: 0.9, activo: true },
  { estrategia: RecomendacionEstrategia.POPULARIDAD, peso: 0.85, activo: true },
  { estrategia: RecomendacionEstrategia.SIMILARES, peso: 1.0, activo: true },
  {
    estrategia: RecomendacionEstrategia.COMPRADOS_JUNTOS,
    peso: 0.95,
    activo: true,
  },
  {
    estrategia: RecomendacionEstrategia.COMPLEMENTOS_CARRITO,
    peso: 1.0,
    activo: true,
  },
  {
    estrategia: RecomendacionEstrategia.COMPRAR_NUEVAMENTE,
    peso: 1.1,
    activo: true,
  },
  { estrategia: RecomendacionEstrategia.NOVEDADES, peso: 0.8, activo: true },
  {
    estrategia: RecomendacionEstrategia.OFERTAS_RELEVANTES,
    peso: 0.9,
    activo: true,
  },
  {
    estrategia: RecomendacionEstrategia.RECIENTEMENTE_VISTOS,
    peso: 0.7,
    activo: true,
  },
];

export function buildDefaultConfig(): Omit<
  RecomendacionConfigGlobal,
  "updatedAt"
> {
  return {
    id: "global",
    secciones: DEFAULT_HOME_SECCIONES,
    pesos: DEFAULT_PESOS,
    exclusionGlobalProductoIds: [],
    retencionEventosDias: RECOMENDACIONES_DEFAULT_RETENTION_DAYS,
    cacheTtlSegundos: RECOMENDACIONES_DEFAULT_CACHE_TTL_SECONDS,
    diversificacionMaxPorCategoria: 3,
    diversificacionMaxPorLinea: 4,
    abVariant: "control",
  };
}
