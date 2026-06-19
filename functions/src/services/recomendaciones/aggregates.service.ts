import { Timestamp } from "firebase-admin/firestore";
import { firestoreTienda } from "../../config/firebase";
import { Orden } from "../../models/orden.model";
import {
  RecomendacionAgregadoDocumento,
  RecomendacionAgregadoProducto,
  RecomendacionCandidato,
  RecomendacionContexto,
  RecomendacionEstrategia,
} from "../../models/recomendaciones.model";
import { Producto } from "../../models/producto.model";
import productService from "../product.service";
import { ofertasService } from "../ofertas.service";
import favoritoService from "../favorito.service";
import { recomendacionCollections } from "./collections";
import productCardsService from "./product-cards.service";
import eventService from "./event.service";
import {
  excludeProductIds,
  uniqueProductIds,
} from "./utils/product-eligibility.util";
import {
  extractPaidProductIdsFromOrder,
  isOrdenPagada,
} from "./utils/order-paid.util";
import { seleccionarMejorOferta } from "../../utils/ofertas-pricing.util";

const ORDENES_COLLECTION = "ordenes";
const PRODUCTOS_COLLECTION = "productos";

class AggregatesService {
  async getAggregate(tipo: RecomendacionAgregadoDocumento["tipo"], productoId?: string) {
    const id = productoId ? `${tipo}__${productoId}` : tipo;
    const snapshot = await firestoreTienda
      .collection(recomendacionCollections.agregados)
      .doc(id)
      .get();

    if (!snapshot.exists) {
      return null;
    }

    const data = snapshot.data() as RecomendacionAgregadoDocumento;
    const expiresAt = data.expiresAt;
    if (
      expiresAt &&
      typeof expiresAt.toMillis === "function" &&
      expiresAt.toMillis() <= Date.now()
    ) {
      return null;
    }

    return data;
  }

  async saveAggregate(payload: RecomendacionAgregadoDocumento): Promise<void> {
    await firestoreTienda
      .collection(recomendacionCollections.agregados)
      .doc(payload.id)
      .set(payload, { merge: true });
  }

  async recalculateBestSellers(): Promise<void> {
    const cutoff = Timestamp.fromDate(new Date(Date.now() - 90 * 24 * 60 * 60 * 1000));
    const snapshot = await firestoreTienda
      .collection(ORDENES_COLLECTION)
      .where("createdAt", ">=", cutoff)
      .get();

    const counts = new Map<string, number>();

    snapshot.docs.forEach((doc) => {
      const order = doc.data() as Orden;
      if (!isOrdenPagada(order)) {
        return;
      }

      for (const productId of extractPaidProductIdsFromOrder(order)) {
        counts.set(productId, (counts.get(productId) ?? 0) + 1);
      }
    });

    const items = Array.from(counts.entries())
      .map(([productoId, ventasPagadas]) => ({
        productoId,
        score: ventasPagadas,
        ventasPagadas,
      }))
      .sort((left, right) => right.score - left.score)
      .slice(0, 100);

    await this.saveAggregate({
      id: "mas_vendidos",
      tipo: "mas_vendidos",
      items,
      calculatedAt: Timestamp.now(),
      expiresAt: Timestamp.fromDate(new Date(Date.now() + 24 * 60 * 60 * 1000)),
    });
  }

  async recalculateTrending(): Promise<void> {
    const now = Date.now();
    const recentCutoff = Timestamp.fromDate(new Date(now - 7 * 24 * 60 * 60 * 1000));
    const previousCutoff = Timestamp.fromDate(new Date(now - 14 * 24 * 60 * 60 * 1000));

    const [recentOrders, previousOrders] = await Promise.all([
      firestoreTienda
        .collection(ORDENES_COLLECTION)
        .where("createdAt", ">=", recentCutoff)
        .get(),
      firestoreTienda
        .collection(ORDENES_COLLECTION)
        .where("createdAt", ">=", previousCutoff)
        .where("createdAt", "<", recentCutoff)
        .get(),
    ]);

    const recentCounts = new Map<string, number>();
    const previousCounts = new Map<string, number>();

    recentOrders.docs.forEach((doc) => {
      const order = doc.data() as Orden;
      if (!isOrdenPagada(order)) {
        return;
      }
      for (const productId of extractPaidProductIdsFromOrder(order)) {
        recentCounts.set(productId, (recentCounts.get(productId) ?? 0) + 1);
      }
    });

    previousOrders.docs.forEach((doc) => {
      const order = doc.data() as Orden;
      if (!isOrdenPagada(order)) {
        return;
      }
      for (const productId of extractPaidProductIdsFromOrder(order)) {
        previousCounts.set(productId, (previousCounts.get(productId) ?? 0) + 1);
      }
    });

    const items: RecomendacionAgregadoProducto[] = [];

    for (const [productoId, recent] of recentCounts.entries()) {
      const previous = previousCounts.get(productoId) ?? 0;
      const growth = recent - previous;
      const growthRate = previous > 0 ? growth / previous : recent;
      items.push({
        productoId,
        score: growthRate + recent * 0.1,
        crecimiento: growthRate,
        ventasPagadas: recent,
      });
    }

    items.sort((left, right) => right.score - left.score);

    await this.saveAggregate({
      id: "tendencias",
      tipo: "tendencias",
      items: items.slice(0, 100),
      calculatedAt: Timestamp.now(),
      expiresAt: Timestamp.fromDate(new Date(Date.now() + 12 * 60 * 60 * 1000)),
    });
  }

  async recalculatePopularity(): Promise<void> {
    const cutoff = Timestamp.fromDate(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000));

    const [ordersSnap, eventsSnap, productsSnap] = await Promise.all([
      firestoreTienda.collection(ORDENES_COLLECTION).where("createdAt", ">=", cutoff).get(),
      firestoreTienda
        .collection(recomendacionCollections.eventos)
        .where("createdAt", ">=", cutoff)
        .limit(2000)
        .get(),
      firestoreTienda
        .collection(PRODUCTOS_COLLECTION)
        .where("activo", "==", true)
        .limit(300)
        .get(),
    ]);

    const scores = new Map<string, number>();

    ordersSnap.docs.forEach((doc) => {
      const order = doc.data() as Orden;
      if (!isOrdenPagada(order)) {
        return;
      }
      for (const productId of extractPaidProductIdsFromOrder(order)) {
        scores.set(productId, (scores.get(productId) ?? 0) + 3);
      }
    });

    eventsSnap.docs.forEach((doc) => {
      const data = doc.data() as { productoId?: string; tipo?: string };
      if (!data.productoId) {
        return;
      }
      const weight =
        data.tipo === "agregar_carrito" ? 2 : data.tipo === "vista_producto" ? 0.5 : 1;
      scores.set(data.productoId, (scores.get(data.productoId) ?? 0) + weight);
    });

    productsSnap.docs.forEach((doc) => {
      const product = doc.data() as Producto;
      if (product.destacado) {
        scores.set(doc.id, (scores.get(doc.id) ?? 0) + 1.5);
      }
      const rating = Number(product.ratingSummary?.average || 0);
      const count = Number(product.ratingSummary?.count || 0);
      if (count > 0) {
        scores.set(doc.id, (scores.get(doc.id) ?? 0) + rating * Math.log10(count + 1));
      }
    });

    const items = Array.from(scores.entries())
      .map(([productoId, score]) => ({ productoId, score, popularidad: score }))
      .sort((left, right) => right.score - left.score)
      .slice(0, 100);

    await this.saveAggregate({
      id: "popularidad",
      tipo: "popularidad",
      items,
      calculatedAt: Timestamp.now(),
      expiresAt: Timestamp.fromDate(new Date(Date.now() + 12 * 60 * 60 * 1000)),
    });
  }

  async recalculateFrequentlyBoughtTogether(): Promise<void> {
    const cutoff = Timestamp.fromDate(new Date(Date.now() - 180 * 24 * 60 * 60 * 1000));
    const snapshot = await firestoreTienda
      .collection(ORDENES_COLLECTION)
      .where("createdAt", ">=", cutoff)
      .get();

    const pairCounts = new Map<string, number>();

    snapshot.docs.forEach((doc) => {
      const order = doc.data() as Orden;
      if (!isOrdenPagada(order)) {
        return;
      }

      const productIds = uniqueProductIds(extractPaidProductIdsFromOrder(order));
      for (let i = 0; i < productIds.length; i += 1) {
        for (let j = i + 1; j < productIds.length; j += 1) {
          const key = `${productIds[i]}::${productIds[j]}`;
          pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
        }
      }
    });

    const pares = Array.from(pairCounts.entries())
      .map(([key, score]) => {
        const [productoIdA, productoIdB] = key.split("::");
        return { productoIdA, productoIdB, score };
      })
      .sort((left, right) => right.score - left.score)
      .slice(0, 500);

    await this.saveAggregate({
      id: "comprados_juntos",
      tipo: "comprados_juntos",
      items: [],
      pares,
      calculatedAt: Timestamp.now(),
      expiresAt: Timestamp.fromDate(new Date(Date.now() + 24 * 60 * 60 * 1000)),
    });
  }

  private aggregateToCandidates(
    aggregate: RecomendacionAgregadoDocumento | null,
    estrategia: RecomendacionEstrategia,
    limite: number,
  ): RecomendacionCandidato[] {
    if (!aggregate) {
      return [];
    }

    return (aggregate.items ?? []).slice(0, limite).map((item) => ({
      productoId: item.productoId,
      score: item.score,
      estrategia,
    }));
  }

  async getRecentlyViewed(context: RecomendacionContexto, limite: number) {
    const productIds = await eventService.listRecentProductIds({
      usuarioId: context.usuarioId,
      visitanteId: context.visitanteId,
      limit: limite * 2,
    });

    return excludeProductIds(productIds, context.exclusionIds).slice(0, limite).map((productoId, index) => ({
      productoId,
      score: limite - index,
      estrategia: RecomendacionEstrategia.RECIENTEMENTE_VISTOS,
    }));
  }

  async getForYou(context: RecomendacionContexto, limite: number) {
    const [recent, favorites, aggregatePopular] = await Promise.all([
      this.getRecentlyViewed(context, limite),
      context.usuarioId
        ? favoritoService.getFavoritos(context.usuarioId, limite, 0)
        : Promise.resolve([]),
      this.getAggregate("popularidad"),
    ]);

    const favoriteIds = favorites.map((fav) => String(fav.producto.id));
    const popularCandidates = this.aggregateToCandidates(
      aggregatePopular,
      RecomendacionEstrategia.PARA_TI,
      limite,
    );

    const seedProducts = await productCardsService.getProductsByIds([
      ...recent.map((item) => item.productoId),
      ...favoriteIds,
    ]);

    const categoryWeights = new Map<string, number>();
    const lineWeights = new Map<string, number>();

    seedProducts.forEach((product) => {
      categoryWeights.set(
        product.categoriaId,
        (categoryWeights.get(product.categoriaId) ?? 0) + 1,
      );
      lineWeights.set(product.lineaId, (lineWeights.get(product.lineaId) ?? 0) + 1);
    });

    const catalog = await productCardsService.listEligibleActiveProducts(150);
    const candidates: RecomendacionCandidato[] = [];

    for (const product of catalog) {
      const categoryScore = categoryWeights.get(product.categoriaId) ?? 0;
      const lineScore = lineWeights.get(product.lineaId) ?? 0;
      const score = categoryScore * 2 + lineScore + (product.destacado ? 0.5 : 0);
      if (score <= 0) {
        continue;
      }
      candidates.push({
        productoId: product.id || "",
        score,
        estrategia: RecomendacionEstrategia.PARA_TI,
      });
    }

    const merged = [...recent, ...popularCandidates, ...candidates]
      .filter((item) => item.productoId)
      .sort((left, right) => right.score - left.score);

    const unique = new Map<string, RecomendacionCandidato>();
    merged.forEach((item) => {
      if (!unique.has(item.productoId)) {
        unique.set(item.productoId, item);
      }
    });

    return excludeProductIds(Array.from(unique.values()).map((item) => item.productoId), context.exclusionIds)
      .slice(0, limite)
      .map((productoId, index) => ({
        productoId,
        score: unique.get(productoId)?.score ?? limite - index,
        estrategia: RecomendacionEstrategia.PARA_TI,
      }));
  }

  async getBestSellers(_context: RecomendacionContexto, limite: number) {
    const aggregate = await this.getAggregate("mas_vendidos");
    return this.aggregateToCandidates(aggregate, RecomendacionEstrategia.MAS_VENDIDOS, limite);
  }

  async getTrending(_context: RecomendacionContexto, limite: number) {
    const aggregate = await this.getAggregate("tendencias");
    return this.aggregateToCandidates(aggregate, RecomendacionEstrategia.TENDENCIAS, limite);
  }

  async getPopularity(_context: RecomendacionContexto, limite: number) {
    const aggregate = await this.getAggregate("popularidad");
    return this.aggregateToCandidates(aggregate, RecomendacionEstrategia.POPULARIDAD, limite);
  }

  async getSimilar(context: RecomendacionContexto, limite: number) {
    if (!context.productoId) {
      return [];
    }

    const product = await productService.getProductById(context.productoId);
    if (!product) {
      return [];
    }

    const [sameCategory, sameLine] = await Promise.all([
      productService.getProductsByCategory(product.categoriaId),
      productService.getProductsByLine(product.lineaId),
    ]);

    const candidates = [...sameCategory, ...sameLine]
      .filter((item) => item.id !== context.productoId)
      .map((item) => ({
        productoId: item.id || "",
        score:
          (item.categoriaId === product.categoriaId ? 2 : 0) +
          (item.lineaId === product.lineaId ? 1 : 0) +
          (item.destacado ? 0.5 : 0),
        estrategia: RecomendacionEstrategia.SIMILARES,
      }))
      .sort((left, right) => right.score - left.score);

    const unique = new Map<string, RecomendacionCandidato>();
    candidates.forEach((item) => {
      if (item.productoId && !unique.has(item.productoId)) {
        unique.set(item.productoId, item);
      }
    });

    return excludeProductIds(Array.from(unique.values()).map((item) => item.productoId), [
      ...(context.exclusionIds ?? []),
      context.productoId,
    ])
      .slice(0, limite)
      .map((productoId) => unique.get(productoId)!);
  }

  async getFrequentlyBoughtTogether(context: RecomendacionContexto, limite: number) {
    if (!context.productoId) {
      return [];
    }

    const aggregate = await this.getAggregate("comprados_juntos");
    if (!aggregate?.pares?.length) {
      return [];
    }

    const related = aggregate.pares
      .filter(
        (pair) =>
          pair.productoIdA === context.productoId ||
          pair.productoIdB === context.productoId,
      )
      .map((pair) => ({
        productoId:
          pair.productoIdA === context.productoId ? pair.productoIdB : pair.productoIdA,
        score: pair.score,
        estrategia: RecomendacionEstrategia.COMPRADOS_JUNTOS,
      }))
      .sort((left, right) => right.score - left.score);

    return excludeProductIds(
      related.map((item) => item.productoId),
      [...(context.exclusionIds ?? []), context.productoId],
    )
      .slice(0, limite)
      .map((productoId) => related.find((item) => item.productoId === productoId)!);
  }

  async getCartComplements(context: RecomendacionContexto, limite: number) {
    const cartProductIds = context.productoIdsCarrito ?? [];
    if (cartProductIds.length === 0) {
      return this.getBestSellers(context, limite);
    }

    const boughtTogetherGroups = await Promise.all(
      cartProductIds.slice(0, 3).map(async (productoId) =>
        this.getFrequentlyBoughtTogether({ ...context, productoId }, limite),
      ),
    );

    const merged = boughtTogetherGroups.flat();
    const unique = new Map<string, RecomendacionCandidato>();
    merged.forEach((item) => {
      if (!unique.has(item.productoId)) {
        unique.set(item.productoId, {
          ...item,
          estrategia: RecomendacionEstrategia.COMPLEMENTOS_CARRITO,
        });
      }
    });

    return excludeProductIds(Array.from(unique.values()).map((item) => item.productoId), [
      ...(context.exclusionIds ?? []),
      ...cartProductIds,
    ])
      .slice(0, limite)
      .map((productoId) => unique.get(productoId)!);
  }

  async getBuyAgain(context: RecomendacionContexto, limite: number) {
    if (!context.usuarioId) {
      return [];
    }

    const cutoff = Timestamp.fromDate(new Date(Date.now() - 365 * 24 * 60 * 60 * 1000));
    const snapshot = await firestoreTienda
      .collection(ORDENES_COLLECTION)
      .where("usuarioId", "==", context.usuarioId)
      .where("createdAt", ">=", cutoff)
      .get();

    const counts = new Map<string, number>();

    snapshot.docs.forEach((doc) => {
      const order = doc.data() as Orden;
      if (!isOrdenPagada(order)) {
        return;
      }
      for (const productId of extractPaidProductIdsFromOrder(order)) {
        counts.set(productId, (counts.get(productId) ?? 0) + 1);
      }
    });

    return Array.from(counts.entries())
      .sort((left, right) => right[1] - left[1])
      .slice(0, limite)
      .map(([productoId, score]) => ({
        productoId,
        score,
        estrategia: RecomendacionEstrategia.COMPRAR_NUEVAMENTE,
      }));
  }

  async getNewArrivals(_context: RecomendacionContexto, limite: number) {
    const products = await productCardsService.listEligibleActiveProducts(limite * 2);
    return products.slice(0, limite).map((product, index) => ({
      productoId: product.id || "",
      score: limite - index,
      estrategia: RecomendacionEstrategia.NOVEDADES,
    }));
  }

  async getRelevantOffers(context: RecomendacionContexto, limite: number) {
    const [products, ofertasActivas] = await Promise.all([
      productCardsService.listEligibleActiveProducts(200),
      ofertasService.listarOfertasActivas(),
    ]);

    const candidates: RecomendacionCandidato[] = [];

    for (const product of products) {
      const mejorOferta = seleccionarMejorOferta(ofertasActivas, {
        id: product.id || "",
        precioPublico: product.precioPublico,
        categoriaId: product.categoriaId,
        lineaId: product.lineaId,
      });

      if (!mejorOferta) {
        continue;
      }

      const ahorro = product.precioPublico - mejorOferta.precioFinal;
      candidates.push({
        productoId: product.id || "",
        score: ahorro,
        estrategia: RecomendacionEstrategia.OFERTAS_RELEVANTES,
      });
    }

    return excludeProductIds(
      candidates.sort((left, right) => right.score - left.score).map((item) => item.productoId),
      context.exclusionIds,
    )
      .slice(0, limite)
      .map((productoId) => candidates.find((item) => item.productoId === productoId)!);
  }

  async getFiltered(context: RecomendacionContexto, limite: number, estrategia: RecomendacionEstrategia) {
    const response = await productService.listCatalogProducts({
      limit: limite,
      sort: "destacados",
      onlyOffers: false,
      onlyAvailable: true,
      category: context.categoriaId,
      line: context.lineaId,
      talla: context.tallaId,
      minPrice: context.minPrice,
      maxPrice: context.maxPrice,
    });

    return response.items.map((item, index) => ({
      productoId: item.id,
      score: limite - index,
      estrategia,
    }));
  }

  async expireAggregateTypes(
    types: RecomendacionAgregadoDocumento["tipo"][],
  ): Promise<void> {
    if (types.length === 0) {
      return;
    }

    const now = Timestamp.now();
    const batch = firestoreTienda.batch();

    types.forEach((tipo) => {
      batch.set(
        firestoreTienda.collection(recomendacionCollections.agregados).doc(tipo),
        { expiresAt: now },
        { merge: true },
      );
    });

    await batch.commit();
  }
}

export default new AggregatesService();
