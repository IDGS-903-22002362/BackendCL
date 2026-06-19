import {
  RecomendacionContexto,
  RecomendacionEstrategia,
  RecomendacionHomeRespuesta,
  RecomendacionRespuesta,
  RecomendacionSeccionConfig,
} from "../../models/recomendaciones.model";
import { RECOMENDACIONES_DEFAULT_LIMIT } from "./recomendaciones.config";
import aggregatesService from "./aggregates.service";
import productCardsService from "./product-cards.service";
import cacheService from "./cache.service";
import configService from "./config.service";
import visitorService from "./visitor.service";
import { diversifyCandidates } from "./utils/diversification.util";
import { excludeProductIds } from "./utils/product-eligibility.util";

const SECTION_TITLES: Record<RecomendacionEstrategia, { titulo: string; subtitulo?: string }> = {
  [RecomendacionEstrategia.RECIENTEMENTE_VISTOS]: {
    titulo: "Vistos recientemente",
    subtitulo: "Retoma donde lo dejaste",
  },
  [RecomendacionEstrategia.PARA_TI]: {
    titulo: "Seleccionado para ti",
    subtitulo: "Basado en tu actividad",
  },
  [RecomendacionEstrategia.MAS_VENDIDOS]: {
    titulo: "Los más vendidos",
    subtitulo: "Favoritos de la afición",
  },
  [RecomendacionEstrategia.TENDENCIAS]: {
    titulo: "En tendencia",
    subtitulo: "Crecimiento reciente",
  },
  [RecomendacionEstrategia.POPULARIDAD]: {
    titulo: "Populares ahora",
    subtitulo: "Alta demanda en la tienda",
  },
  [RecomendacionEstrategia.SIMILARES]: {
    titulo: "Productos similares",
    subtitulo: "Completa tu look",
  },
  [RecomendacionEstrategia.COMPRADOS_JUNTOS]: {
    titulo: "Frecuentemente comprados juntos",
  },
  [RecomendacionEstrategia.COMPLEMENTOS_CARRITO]: {
    titulo: "Completa tu carrito",
    subtitulo: "Piezas que combinan con tu selección",
  },
  [RecomendacionEstrategia.COMPRAR_NUEVAMENTE]: {
    titulo: "Comprar nuevamente",
    subtitulo: "Tus favoritos de siempre",
  },
  [RecomendacionEstrategia.NOVEDADES]: {
    titulo: "Novedades",
    subtitulo: "Lo más reciente del catálogo",
  },
  [RecomendacionEstrategia.OFERTAS_RELEVANTES]: {
    titulo: "Ofertas relevantes",
    subtitulo: "Ahorra en piezas seleccionadas",
  },
  [RecomendacionEstrategia.POR_CATEGORIA]: {
    titulo: "Por categoría",
  },
  [RecomendacionEstrategia.POR_LINEA]: {
    titulo: "Por línea",
  },
  [RecomendacionEstrategia.POR_TALLA]: {
    titulo: "Por talla",
  },
  [RecomendacionEstrategia.POR_PRECIO]: {
    titulo: "Por precio",
  },
};

class RecomendacionesService {
  private async resolveContext(base: RecomendacionContexto): Promise<RecomendacionContexto> {
    const { visitanteId } = await visitorService.resolveVisitante({
      sessionId: base.sessionId,
      usuarioId: base.usuarioId,
    });

    return {
      ...base,
      visitanteId,
    };
  }

  private async runStrategy(context: RecomendacionContexto, estrategia: RecomendacionEstrategia, limite: number) {
    switch (estrategia) {
      case RecomendacionEstrategia.RECIENTEMENTE_VISTOS:
        return aggregatesService.getRecentlyViewed(context, limite);
      case RecomendacionEstrategia.PARA_TI:
        return aggregatesService.getForYou(context, limite);
      case RecomendacionEstrategia.MAS_VENDIDOS:
        return aggregatesService.getBestSellers(context, limite);
      case RecomendacionEstrategia.TENDENCIAS:
        return aggregatesService.getTrending(context, limite);
      case RecomendacionEstrategia.POPULARIDAD:
        return aggregatesService.getPopularity(context, limite);
      case RecomendacionEstrategia.SIMILARES:
        return aggregatesService.getSimilar(context, limite);
      case RecomendacionEstrategia.COMPRADOS_JUNTOS:
        return aggregatesService.getFrequentlyBoughtTogether(context, limite);
      case RecomendacionEstrategia.COMPLEMENTOS_CARRITO:
        return aggregatesService.getCartComplements(context, limite);
      case RecomendacionEstrategia.COMPRAR_NUEVAMENTE:
        return aggregatesService.getBuyAgain(context, limite);
      case RecomendacionEstrategia.NOVEDADES:
        return aggregatesService.getNewArrivals(context, limite);
      case RecomendacionEstrategia.OFERTAS_RELEVANTES:
        return aggregatesService.getRelevantOffers(context, limite);
      case RecomendacionEstrategia.POR_CATEGORIA:
        return aggregatesService.getFiltered(context, limite, estrategia);
      case RecomendacionEstrategia.POR_LINEA:
        return aggregatesService.getFiltered(context, limite, estrategia);
      case RecomendacionEstrategia.POR_TALLA:
        return aggregatesService.getFiltered(context, limite, estrategia);
      case RecomendacionEstrategia.POR_PRECIO:
        return aggregatesService.getFiltered(context, limite, estrategia);
      default:
        return [];
    }
  }

  async getRecommendations(params: {
    estrategia: RecomendacionEstrategia;
    context: RecomendacionContexto;
    seccion?: RecomendacionSeccionConfig;
  }): Promise<RecomendacionRespuesta> {
    const config = await configService.getConfig();
    const context = await this.resolveContext(params.context);
    const limite = params.seccion?.limite || context.limite || RECOMENDACIONES_DEFAULT_LIMIT;
    const exclusionIds = excludeProductIds([], [
      ...(context.exclusionIds ?? []),
      ...(params.seccion?.exclusionProductoIds ?? []),
      ...(config.exclusionGlobalProductoIds ?? []),
    ]);

    const enrichedContext: RecomendacionContexto = {
      ...context,
      exclusionIds,
      limite,
      categoriaId: params.seccion?.filtros?.categoriaId ?? context.categoriaId,
      lineaId: params.seccion?.filtros?.lineaId ?? context.lineaId,
      tallaId: params.seccion?.filtros?.tallaId ?? context.tallaId,
      minPrice: params.seccion?.filtros?.minPrice ?? context.minPrice,
      maxPrice: params.seccion?.filtros?.maxPrice ?? context.maxPrice,
    };

    const cacheKey = cacheService.buildContextKey({
      estrategia: params.estrategia,
      usuarioId: enrichedContext.usuarioId,
      visitanteId: enrichedContext.visitanteId,
      productoId: enrichedContext.productoId,
      cart: enrichedContext.productoIdsCarrito,
      categoriaId: enrichedContext.categoriaId,
      lineaId: enrichedContext.lineaId,
      limite,
    });

    let productIds = await cacheService.getCachedProductIds(cacheKey, params.estrategia);

    if (!productIds) {
      const candidates = await this.runStrategy(enrichedContext, params.estrategia, limite * 2);
      const productsById = await productCardsService.getProductsByIds(
        candidates.map((item) => item.productoId),
      );

      const diversified = diversifyCandidates(candidates, productsById, {
        limite: limite * 2,
        maxPorCategoria: config.diversificacionMaxPorCategoria,
        maxPorLinea: config.diversificacionMaxPorLinea,
      });

      if (params.seccion?.productoIdsFijados?.length) {
        productIds = excludeProductIds(
          [...params.seccion.productoIdsFijados, ...diversified.map((item) => item.productoId)],
          exclusionIds,
        ).slice(0, limite);
      } else {
        productIds = excludeProductIds(
          diversified.map((item) => item.productoId),
          exclusionIds,
        ).slice(0, limite);
      }

      await cacheService.setCachedProductIds({
        contextKey: cacheKey,
        estrategia: params.estrategia,
        productoIds: productIds,
        ttlSeconds: config.cacheTtlSegundos,
      });
    }

    const items = await productCardsService.buildCatalogCards(productIds || []);
    const copy = params.seccion
      ? { titulo: params.seccion.titulo, subtitulo: params.seccion.subtitulo }
      : SECTION_TITLES[params.estrategia];

    return {
      estrategia: params.estrategia,
      seccionId: params.seccion?.id,
      titulo: copy.titulo,
      subtitulo: copy.subtitulo,
      items,
      meta: {
        total: items.length,
        limite,
        hasMore: items.length >= limite,
      },
    };
  }

  async getHomeRecommendations(context: RecomendacionContexto): Promise<RecomendacionHomeRespuesta> {
    const config = await configService.getConfig();
    const secciones = (config.secciones ?? [])
      .filter((seccion) => seccion.activo && seccion.superficie === context.superficie)
      .sort((left, right) => left.orden - right.orden);

    const results = await Promise.allSettled(
      secciones.map(async (seccion) =>
        this.getRecommendations({
          estrategia: seccion.estrategia,
          context,
          seccion,
        }),
      ),
    );

    const seccionesOk = results
      .filter(
        (result): result is PromiseFulfilledResult<RecomendacionRespuesta> =>
          result.status === "fulfilled",
      )
      .map((result) => result.value)
      .filter((section) => section.items.length > 0);

    return {
      secciones: seccionesOk,
    };
  }
}

export default new RecomendacionesService();
