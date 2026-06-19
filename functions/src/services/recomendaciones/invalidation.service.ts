import {
  RecomendacionAgregadoDocumento,
  RecomendacionEstrategia,
} from "../../models/recomendaciones.model";
import aggregatesService from "./aggregates.service";
import cacheService from "./cache.service";

const CATALOG_AGGREGATES: RecomendacionAgregadoDocumento["tipo"][] = [
  "mas_vendidos",
  "tendencias",
  "popularidad",
  "comprados_juntos",
];

const CATALOG_STRATEGIES: RecomendacionEstrategia[] = [
  RecomendacionEstrategia.MAS_VENDIDOS,
  RecomendacionEstrategia.TENDENCIAS,
  RecomendacionEstrategia.POPULARIDAD,
  RecomendacionEstrategia.NOVEDADES,
  RecomendacionEstrategia.OFERTAS_RELEVANTES,
  RecomendacionEstrategia.SIMILARES,
  RecomendacionEstrategia.COMPRADOS_JUNTOS,
  RecomendacionEstrategia.COMPLEMENTOS_CARRITO,
];

const USER_STRATEGIES: RecomendacionEstrategia[] = [
  RecomendacionEstrategia.PARA_TI,
  RecomendacionEstrategia.RECIENTEMENTE_VISTOS,
  RecomendacionEstrategia.COMPRAR_NUEVAMENTE,
];

class InvalidationService {
  async invalidateForPaidOrCancelledOrder(params: {
    usuarioId?: string;
    productoIds?: string[];
  }): Promise<void> {
    const productoIds = params.productoIds ?? [];

    await Promise.all([
      params.usuarioId
        ? cacheService.invalidateByUsuarioId(params.usuarioId)
        : Promise.resolve(),
      ...productoIds.map((productoId) => cacheService.invalidateByProductoId(productoId)),
      cacheService.invalidateByEstrategias(USER_STRATEGIES),
      aggregatesService.expireAggregateTypes(CATALOG_AGGREGATES),
      cacheService.invalidateByEstrategias(CATALOG_STRATEGIES),
    ]);
  }

  async invalidateForProductChange(productoId: string): Promise<void> {
    await Promise.all([
      cacheService.invalidateByProductoId(productoId),
      cacheService.invalidateByEstrategias(CATALOG_STRATEGIES),
      aggregatesService.expireAggregateTypes(CATALOG_AGGREGATES),
    ]);
  }

  async invalidateForInventoryChange(productoId: string): Promise<void> {
    await this.invalidateForProductChange(productoId);
  }

  async invalidateForOfferChange(): Promise<void> {
    await Promise.all([
      cacheService.invalidateByEstrategias([
        RecomendacionEstrategia.OFERTAS_RELEVANTES,
        RecomendacionEstrategia.PARA_TI,
      ]),
      aggregatesService.expireAggregateTypes(["mas_vendidos", "tendencias"]),
    ]);
  }

  async invalidateForViewHistoryChange(usuarioId?: string): Promise<void> {
    await Promise.all([
      usuarioId ? cacheService.invalidateByUsuarioId(usuarioId) : Promise.resolve(),
      cacheService.invalidateByEstrategias([
        RecomendacionEstrategia.RECIENTEMENTE_VISTOS,
        RecomendacionEstrategia.PARA_TI,
      ]),
    ]);
  }

  async invalidateForConfigChange(): Promise<void> {
    let deleted = 0;
    do {
      deleted = await cacheService.invalidateAll();
    } while (deleted >= 200);
  }
}

export default new InvalidationService();
