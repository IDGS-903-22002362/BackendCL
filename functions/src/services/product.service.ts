/**
 * Servicio de Productos
 * Maneja toda la lógica de negocio relacionada con productos
 */

import { firestoreTienda } from "../config/firebase";
import { admin } from "../config/firebase.admin";
import {
  InventarioPorTalla,
  Producto,
  ProductRatingSummary,
  StockMinimoPorTalla,
} from "../models/producto.model";
import {
  CatalogCursor,
  CatalogProductCardDTO,
  CatalogQuery,
  CatalogResponse,
  CatalogSort,
} from "../models/product-catalog.model";
import {
  AdminProductListItemDTO,
  AdminProductsQuery,
} from "../models/product-admin.model";
import {
  AlertaStockProducto,
  AlertaStockTalla,
  ListarAlertasStockQuery,
  TipoMovimientoInventario,
} from "../models/inventario.model";
import {
  completeInventarioPorTalla,
  deriveExistenciasFromSizeInventory,
  normalizeTallaIds,
} from "../utils/size-inventory.util";
import {
  buildFirestoreInventoryPatch,
  normalizeGlobalBuckets,
  normalizeSizeBuckets,
} from "../utils/inventory-stock.util";
import stockAlertService from "./stock-alert.service";
import {
  productOfferSnapshotService,
  readStoredOfferSnapshot,
} from "./product-offer-snapshot.service";
import { ofertasService } from "./ofertas.service";
import { seleccionarMejorOferta } from "../utils/ofertas-pricing.util";
import { isFirestoreMissingIndexError } from "../utils/firebase-error.util";
import type { Oferta } from "../models/ofertas.model";

/**
 * Colección de productos en Firestore
 */
const PRODUCTOS_COLLECTION = "productos";
const MOVIMIENTOS_INVENTARIO_COLLECTION = "movimientosInventario";
const DEFAULT_STOCK_MINIMO_GLOBAL = 5;
const DEFAULT_PRODUCT_RATING_SUMMARY: ProductRatingSummary = {
  average: 0,
  count: 0,
};
const CATEGORIAS_COLLECTION = "categorias";
const LINEAS_COLLECTION = "lineas";
const CURSOR_VERSION = 1;
const CATALOG_SEARCH_MAX_SCAN = 1000;

export class CatalogQueryError extends Error {
  statusCode = 400;

  constructor(message: string) {
    super(message);
    this.name = "CatalogQueryError";
  }
}

export interface UpdateProductStockDTO {
  cantidadNueva: number;
  tallaId?: string;
  tipo?: TipoMovimientoInventario | "ajuste";
  motivo?: string;
  referencia?: string;
  ordenId?: string;
  ventaPosId?: string;
  usuarioId?: string;
}

export interface ProductStockUpdateResult {
  productoId: string;
  tallaId: string | null;
  cantidadAnterior: number;
  cantidadNueva: number;
  diferencia: number;
  existencias: number;
  inventarioPorTalla: InventarioPorTalla[];
  stockMinimoGlobal: number;
  stockMinimoPorTalla: StockMinimoPorTalla[];
  alertaStockBajo: {
    activo: boolean;
    totalAlertas: number;
    maxDeficit: number;
  };
  movimientoId: string;
  createdAt: Date;
}

export interface ReplaceProductSizeInventoryDTO {
  inventarioPorTalla: InventarioPorTalla[];
  motivo?: string;
  referencia?: string;
  usuarioId?: string;
}

export interface ReplaceProductSizeInventoryResult {
  productoId: string;
  tallaIds: string[];
  inventarioPorTalla: InventarioPorTalla[];
  existencias: number;
  cambios: Array<{
    tallaId: string;
    cantidadAnterior: number;
    cantidadNueva: number;
    diferencia: number;
    movimientoId: string;
  }>;
}

export interface AssistantProductSearchFilters {
  normalizedQuery?: string;
  categoryIds?: string[];
  lineIds?: string[];
  colors?: string[];
  sizeIds?: string[];
  audience?: string[];
  pricePreference?: "lowest" | "premium" | "standard";
  availability?: "in_stock" | "all";
}

export interface AssistantProductSearchResult extends Producto {
  score: number;
  matchReasons: string[];
  inStock: boolean;
}

/**
 * Clase ProductService
 * Encapsula las operaciones CRUD y consultas de productos
 */
export class ProductService {
  private async enqueueProductLifecycleEvents(
    previousProduct: Producto,
    nextProduct: Producto,
    triggerSource: string,
  ): Promise<void> {
    try {
      const { default: notificationEventService } = await import(
        "./notifications/notification-event.service"
      );
      if (
        previousProduct.existencias <= 0 &&
        nextProduct.existencias > 0 &&
        nextProduct.activo
      ) {
        await notificationEventService.enqueueProductAudienceEvents({
          eventType: "product_restocked",
          productId: nextProduct.id || "",
          sourceData: {
            productName: nextProduct.descripcion,
            precioPublico: nextProduct.precioPublico,
            existenciasAntes: previousProduct.existencias,
            existenciasDespues: nextProduct.existencias,
            stockTransition: `${previousProduct.existencias}->${nextProduct.existencias}`,
            restockedAt: new Date().toISOString(),
          },
          triggerSource,
        });
      }

      if (nextProduct.precioPublico < previousProduct.precioPublico) {
        await notificationEventService.enqueueProductAudienceEvents({
          eventType: "price_drop",
          productId: nextProduct.id || "",
          sourceData: {
            productName: nextProduct.descripcion,
            precioAnterior: previousProduct.precioPublico,
            precioNuevo: nextProduct.precioPublico,
          },
          triggerSource,
        });
      }
    } catch (error) {
      console.warn("notification_product_event_enqueue_failed", {
        productoId: nextProduct.id,
        triggerSource,
        reason: error instanceof Error ? error.message : error,
      });
    }
  }

  private normalizeSearchText(value: string): string {
    return value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim();
  }

  private buildSlug(value: string): string {
    return (
      this.normalizeSearchText(value)
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "") || "producto"
    );
  }

  private buildProductSearchText(
    product: Pick<Producto, "descripcion" | "clave" | "categoriaId" | "lineaId">,
    labels?: { categoriaNombre?: string; lineaNombre?: string },
  ): string {
    return this.normalizeSearchText(
      [
        product.descripcion,
        product.clave,
        product.categoriaId,
        product.lineaId,
        labels?.categoriaNombre,
        labels?.lineaNombre,
      ]
        .filter(Boolean)
        .join(" "),
    );
  }

  private buildProductSearchHaystack(
    product: Producto,
    labels: { categorias: Map<string, string>; lineas: Map<string, string> },
  ): string {
    return this.normalizeSearchText(
      [
        product.descripcion,
        product.clave,
        product.searchText,
        product.categoriaId,
        product.lineaId,
        labels.categorias.get(product.categoriaId || ""),
        labels.lineas.get(product.lineaId || ""),
      ]
        .filter(Boolean)
        .join(" "),
    );
  }

  private matchesCatalogSearchQuery(
    product: Producto,
    normalizedTerm: string,
    labels: { categorias: Map<string, string>; lineas: Map<string, string> },
  ): boolean {
    if (!normalizedTerm) {
      return true;
    }

    return this.buildProductSearchHaystack(product, labels).includes(
      normalizedTerm,
    );
  }

  private async resolveProductSearchText(
    product: Pick<Producto, "descripcion" | "clave" | "categoriaId" | "lineaId">,
    explicitSearchText?: string,
  ): Promise<string> {
    if (typeof explicitSearchText === "string" && explicitSearchText.trim()) {
      return explicitSearchText.trim();
    }

    const labels = await this.loadCatalogLabels();
    return this.buildProductSearchText(product, {
      categoriaNombre: labels.categorias.get(product.categoriaId || ""),
      lineaNombre: labels.lineas.get(product.lineaId || ""),
    });
  }

  private encodeCatalogCursor(cursor: CatalogCursor): string {
    return Buffer.from(JSON.stringify(cursor), "utf8")
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/g, "");
  }

  private decodeCatalogCursor(cursor: string): CatalogCursor {
    try {
      const normalized = cursor.replace(/-/g, "+").replace(/_/g, "/");
      const padded = normalized.padEnd(
        normalized.length + ((4 - (normalized.length % 4)) % 4),
        "=",
      );
      const parsed = JSON.parse(Buffer.from(padded, "base64").toString("utf8"));

      if (
        typeof parsed !== "object" ||
        parsed === null ||
        parsed.v !== CURSOR_VERSION ||
        typeof parsed.sort !== "string" ||
        typeof parsed.filters !== "object" ||
        parsed.filters === null ||
        typeof parsed.last !== "object" ||
        parsed.last === null ||
        typeof parsed.last.id !== "string"
      ) {
        throw new Error("invalid cursor shape");
      }

      return parsed as CatalogCursor;
    } catch (_error) {
      throw new CatalogQueryError("cursor invalido");
    }
  }

  private getSizeStock(product: Producto, sizeId?: string): number {
    if (!sizeId) {
      return product.existencias;
    }

    return (
      product.inventarioPorTalla.find((item) => item.tallaId === sizeId)?.cantidad ??
      0
    );
  }

  private scoreAssistantSearchResult(
    product: Producto,
    query: string,
    filters: AssistantProductSearchFilters,
  ): AssistantProductSearchResult | null {
    const haystack = this.normalizeSearchText(
      [
        product.descripcion,
        product.clave,
        product.lineaId,
        product.categoriaId,
      ].join(" "),
    );
    const reasons: string[] = [];
    let score = 0;

    if (filters.categoryIds?.length) {
      if (filters.categoryIds.includes(product.categoriaId)) {
        score += 7;
        reasons.push(`category:${product.categoriaId}`);
      } else {
        return null;
      }
    }

    const effectiveLineIds = filters.lineIds?.length
      ? filters.lineIds
      : filters.audience;
    if (effectiveLineIds?.length) {
      if (effectiveLineIds.includes(product.lineaId)) {
        score += 6;
        reasons.push(`line:${product.lineaId}`);
      } else if (!filters.categoryIds?.length) {
        return null;
      }
    }

    if (filters.colors?.length) {
      const hasColor = filters.colors.some((color) => haystack.includes(color));
      if (!hasColor) {
        return null;
      }
      score += 4;
      reasons.push(`color:${filters.colors.join(",")}`);
    }

    if (filters.sizeIds?.length) {
      const bestSize = filters.sizeIds.find((sizeId) => product.tallaIds.includes(sizeId));
      if (!bestSize) {
        return null;
      }

      const sizeStock = this.getSizeStock(product, bestSize);
      if (filters.availability === "in_stock" && sizeStock <= 0) {
        return null;
      }

      score += sizeStock > 0 ? 5 : 1;
      reasons.push(`size:${bestSize}`);
    } else if (filters.availability === "in_stock" && product.existencias <= 0) {
      return null;
    }

    if (query.trim()) {
      const queryTokens = this.normalizeSearchText(query)
        .split(/\s+/)
        .filter(Boolean);
      const tokenHits = queryTokens.filter((token) => haystack.includes(token));
      score += tokenHits.length * 2;
      if (tokenHits.length > 0) {
        reasons.push(`query:${tokenHits.join(",")}`);
      }
    }

    if (score <= 0) {
      return null;
    }

    return {
      ...product,
      score,
      matchReasons: reasons,
      inStock:
        filters.sizeIds?.length
          ? filters.sizeIds.some((sizeId) => this.getSizeStock(product, sizeId) > 0)
          : product.existencias > 0,
    };
  }

  private normalizeInventoryBySize(
    inventarioPorTalla: unknown,
    tallaIds: unknown = [],
    strict = false,
  ): InventarioPorTalla[] {
    return completeInventarioPorTalla(tallaIds, inventarioPorTalla, {
      failOnUnknownSize: strict,
      failWhenNoSizes: strict,
    });
  }

  private getDerivedExistencias(
    tallaIds: unknown,
    inventarioPorTalla: unknown,
    fallbackExistencias?: number,
  ): number {
    return deriveExistenciasFromSizeInventory(
      tallaIds,
      inventarioPorTalla,
      fallbackExistencias,
    );
  }

  private normalizeProduct(
    id: string,
    data: FirebaseFirestore.DocumentData,
  ): Producto {
    const tallaIds = normalizeTallaIds(data.tallaIds);
    const inventarioPorTalla = this.normalizeInventoryBySize(
      data.inventarioPorTalla,
      tallaIds,
      false,
    );
    const existencias = this.getDerivedExistencias(
      tallaIds,
      inventarioPorTalla,
      data.existencias,
    );
    const ratingSummaryRaw =
      typeof data.ratingSummary === "object" && data.ratingSummary !== null
        ? (data.ratingSummary as {
            average?: unknown;
            count?: unknown;
            updatedAt?: unknown;
          })
        : null;
    const averageRaw = Number(ratingSummaryRaw?.average ?? 0);
    const countRaw = Number(ratingSummaryRaw?.count ?? 0);
    const ratingSummary: ProductRatingSummary = {
      average:
        Number.isFinite(averageRaw) && averageRaw > 0
          ? Number(averageRaw.toFixed(2))
          : DEFAULT_PRODUCT_RATING_SUMMARY.average,
      count:
        Number.isFinite(countRaw) && countRaw > 0
          ? Math.floor(countRaw)
          : DEFAULT_PRODUCT_RATING_SUMMARY.count,
      updatedAt:
        ratingSummaryRaw?.updatedAt instanceof admin.firestore.Timestamp
          ? ratingSummaryRaw.updatedAt
          : undefined,
    };

    return {
      id,
      clave: data.clave,
      descripcion: data.descripcion,
      lineaId: data.lineaId,
      categoriaId: data.categoriaId,
      precioPublico: data.precioPublico,
      precioCompra: data.precioCompra,
      existencias,
      slug:
        typeof data.slug === "string" && data.slug.trim()
          ? data.slug.trim()
          : this.buildSlug(String(data.descripcion ?? id)),
      searchText:
        typeof data.searchText === "string" && data.searchText.trim()
          ? data.searchText.trim()
          : undefined,
      disponible:
        typeof data.disponible === "boolean"
          ? data.disponible
          : existencias > 0,
      destacado: data.destacado === true,
      proveedorId: data.proveedorId,
      tallaIds,
      inventarioPorTalla,
      stockMinimoGlobal: this.getNormalizedGlobalThreshold(
        data.stockMinimoGlobal,
      ),
      stockMinimoPorTalla: this.normalizeStockThresholdBySize(
        data.stockMinimoPorTalla,
      ),
      imagenes: data.imagenes || [],
      detalleIds: Array.isArray(data.detalleIds) ? data.detalleIds : [],
      ratingSummary,
      ...(data.fedexShipping && typeof data.fedexShipping === "object"
        ? { fedexShipping: data.fedexShipping }
        : {}),
      ...(data.shipping && typeof data.shipping === "object"
        ? { shipping: data.shipping }
        : {}),
      activo: data.activo,
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
    } as Producto;
  }

  private normalizeStockThresholdBySize(
    stockMinimoPorTalla: unknown,
  ): StockMinimoPorTalla[] {
    if (!Array.isArray(stockMinimoPorTalla)) {
      return [];
    }

    return stockMinimoPorTalla
      .filter(
        (item): item is { tallaId: unknown; minimo: unknown } =>
          typeof item === "object" && item !== null,
      )
      .map((item) => {
        const tallaId = String(item.tallaId ?? "").trim();
        const minimoRaw = Number(item.minimo ?? 0);
        const minimo =
          Number.isFinite(minimoRaw) && minimoRaw >= 0
            ? Math.floor(minimoRaw)
            : 0;

        return {
          tallaId,
          minimo,
        };
      })
      .filter((item) => item.tallaId.length > 0);
  }

  private getNormalizedGlobalThreshold(value: unknown): number {
    const threshold = Number(value);

    if (!Number.isFinite(threshold) || threshold < 0) {
      return DEFAULT_STOCK_MINIMO_GLOBAL;
    }

    return Math.floor(threshold);
  }

  private getThresholdForSize(
    tallaId: string,
    stockMinimoGlobal: number,
    stockMinimoPorTalla: StockMinimoPorTalla[],
  ): number {
    const custom = stockMinimoPorTalla.find((item) => item.tallaId === tallaId);
    return custom ? custom.minimo : stockMinimoGlobal;
  }

  private evaluateLowStock(
    producto: Pick<
      Producto,
      | "id"
      | "clave"
      | "descripcion"
      | "lineaId"
      | "categoriaId"
      | "existencias"
      | "tallaIds"
      | "stockMinimoGlobal"
      | "stockMinimoPorTalla"
      | "inventarioPorTalla"
    >,
  ): AlertaStockProducto {
    const stockMinimoGlobal = this.getNormalizedGlobalThreshold(
      producto.stockMinimoGlobal,
    );
    const stockMinimoPorTalla = this.normalizeStockThresholdBySize(
      producto.stockMinimoPorTalla,
    );
    const tallaIds = normalizeTallaIds(producto.tallaIds);
    const inventarioPorTalla = this.normalizeInventoryBySize(
      producto.inventarioPorTalla,
      tallaIds,
    );

    const tallasBajoStock: AlertaStockTalla[] = inventarioPorTalla
      .map((item) => {
        const minimo = this.getThresholdForSize(
          item.tallaId,
          stockMinimoGlobal,
          stockMinimoPorTalla,
        );
        const deficit = minimo - item.cantidad;

        if (deficit <= 0) {
          return null;
        }

        return {
          tallaId: item.tallaId,
          cantidadActual: item.cantidad,
          minimo,
          deficit,
        } as AlertaStockTalla;
      })
      .filter((item): item is AlertaStockTalla => item !== null)
      .sort((a, b) => b.deficit - a.deficit);

    const existencias = this.getDerivedExistencias(
      tallaIds,
      inventarioPorTalla,
      producto.existencias,
    );
    const globalBajoStock = existencias < stockMinimoGlobal;
    const globalDeficit = globalBajoStock ? stockMinimoGlobal - existencias : 0;
    const maxDeficitTalla = tallasBajoStock.reduce(
      (acc, talla) => Math.max(acc, talla.deficit),
      0,
    );

    return {
      productoId: producto.id ?? "",
      clave: String(producto.clave ?? ""),
      descripcion: String(producto.descripcion ?? ""),
      lineaId: String(producto.lineaId ?? ""),
      categoriaId: String(producto.categoriaId ?? ""),
      existencias,
      stockMinimoGlobal,
      globalBajoStock,
      tallasBajoStock,
      totalAlertas: tallasBajoStock.length + (globalBajoStock ? 1 : 0),
      maxDeficit: Math.max(globalDeficit, maxDeficitTalla),
    };
  }

  private getValidatedSizeInventory(
    tallaIdsInput: unknown,
    inventarioInput: unknown,
  ): { tallaIds: string[]; inventarioPorTalla: InventarioPorTalla[] } {
    const tallaIds = normalizeTallaIds(tallaIdsInput);
    const inventarioPorTalla = this.normalizeInventoryBySize(
      inventarioInput,
      tallaIds,
      true,
    );

    return { tallaIds, inventarioPorTalla };
  }

  /**
   * Obtiene todos los productos activos
   * @returns Promise con array de productos activos ordenados alfabéticamente
   */
  async getAllProducts(): Promise<Producto[]> {
    try {
      // Consultar colección de productos (sin orderBy para evitar índice compuesto)
      const snapshot = await firestoreTienda
        .collection(PRODUCTOS_COLLECTION)
        .where("activo", "==", true) // Filtrar solo productos activos
        .get();

      // Si no hay productos, retornar array vacío
      if (snapshot.empty) {
        console.log("No se encontraron productos activos");
        return [];
      }

      // Mapear documentos a objetos Producto
      const productos: Producto[] = snapshot.docs.map((doc) =>
        this.normalizeProduct(doc.id, doc.data()),
      );

      // Ordenar alfabéticamente en memoria
      productos.sort((a, b) => a.descripcion.localeCompare(b.descripcion));

      console.log(`Se obtuvieron ${productos.length} productos activos`);
      return productos;
    } catch (error) {
      console.error("Error al obtener productos:", error);
      throw new Error("Error al obtener productos de la base de datos");
    }
  }

  /**
   * Obtiene un producto por su ID
   * @param id - ID del documento en Firestore
   * @returns Promise con el producto o null si no existe
   */
  async getProductById(id: string): Promise<Producto | null> {
    try {
      const doc = await firestoreTienda
        .collection(PRODUCTOS_COLLECTION)
        .doc(id)
        .get();

      if (!doc.exists) {
        console.log(`Producto con ID ${id} no encontrado`);
        return null;
      }

      return this.normalizeProduct(doc.id, doc.data()!);
    } catch (error) {
      console.error(`❌ Error al obtener producto ${id}:`, error);
      throw new Error("Error al obtener el producto");
    }
  }

  /**
   * Obtiene productos por categoría
   * @param categoriaId - ID de la categoría
   * @returns Promise con array de productos de la categoría
   */
  async getProductsByCategory(categoriaId: string): Promise<Producto[]> {
    try {
      const snapshot = await firestoreTienda
        .collection(PRODUCTOS_COLLECTION)
        .where("categoriaId", "==", categoriaId)
        .where("activo", "==", true)
        .get();

      const productos: Producto[] = snapshot.docs.map((doc) =>
        this.normalizeProduct(doc.id, doc.data()),
      );

      // Ordenar alfabéticamente en memoria
      productos.sort((a, b) => a.descripcion.localeCompare(b.descripcion));

      return productos;
    } catch (error) {
      console.error("❌ Error al obtener productos por categoría:", error);
      throw new Error("Error al obtener productos por categoría");
    }
  }

  /**
   * Obtiene productos por línea
   * @param lineaId - ID de la línea
   * @returns Promise con array de productos de la línea
   */
  async getProductsByLine(lineaId: string): Promise<Producto[]> {
    try {
      const snapshot = await firestoreTienda
        .collection(PRODUCTOS_COLLECTION)
        .where("lineaId", "==", lineaId)
        .where("activo", "==", true)
        .get();

      const productos: Producto[] = snapshot.docs.map((doc) =>
        this.normalizeProduct(doc.id, doc.data()),
      );

      // Ordenar alfabéticamente en memoria
      productos.sort((a, b) => a.descripcion.localeCompare(b.descripcion));

      return productos;
    } catch (error) {
      console.error("Error al obtener productos por línea:", error);
      throw new Error("Error al obtener productos por línea");
    }
  }

  /**
   * Busca productos por texto en descripción o clave
   * @param searchTerm - Término de búsqueda
   * @returns Promise con array de productos que coinciden
   */
  async searchProducts(searchTerm: string): Promise<Producto[]> {
    try {
      // Nota: Firestore no tiene búsqueda full-text nativa
      // Esta es una implementación básica que busca por inicio de descripción
      // Para búsqueda más avanzada, considerar usar Algolia o similar

      const searchTermLower = searchTerm.toLowerCase();

      const snapshot = await firestoreTienda
        .collection(PRODUCTOS_COLLECTION)
        .where("activo", "==", true)
        .get();

      const productos: Producto[] = snapshot.docs
        .map((doc) => this.normalizeProduct(doc.id, doc.data()))
        .filter(
          (producto) =>
            producto.descripcion.toLowerCase().includes(searchTermLower) ||
            producto.clave.toLowerCase().includes(searchTermLower),
        );

      return productos;
    } catch (error) {
      console.error("❌ Error al buscar productos:", error);
      throw new Error("Error al buscar productos");
    }
  }

  /**
   * Búsqueda admin por nombre, clave o texto indexado (incluye inactivos).
   */
  async searchAdminProducts(
    searchTerm: string,
    limit = 40,
  ): Promise<AdminProductListItemDTO[]> {
    const normalizedTerm = this.normalizeSearchText(searchTerm);
    if (!normalizedTerm) {
      return [];
    }

    try {
      const snapshot = await firestoreTienda
        .collection(PRODUCTOS_COLLECTION)
        .orderBy("updatedAt", "desc")
        .limit(500)
        .get();

      return snapshot.docs
        .map((doc) => this.normalizeProduct(doc.id, doc.data()))
        .filter((producto) => {
          const haystack = this.normalizeSearchText(
            [producto.descripcion, producto.clave, producto.searchText]
              .filter(Boolean)
              .join(" "),
          );
          return haystack.includes(normalizedTerm);
        })
        .slice(0, limit)
        .map((product) => this.toAdminProductListItem(product));
    } catch (error) {
      console.error("Error al buscar productos admin:", error);
      throw new Error("Error al buscar productos para admin");
    }
  }

  private getCatalogSortConfig(sort: CatalogSort): {
    field: string;
    direction: FirebaseFirestore.OrderByDirection;
  } {
    switch (sort) {
      case "precio_asc":
        return { field: "precioPublico", direction: "asc" };
      case "precio_desc":
        return { field: "precioPublico", direction: "desc" };
      case "recientes":
        return { field: "updatedAt", direction: "desc" };
      case "nombre_asc":
        return { field: "descripcion", direction: "asc" };
      case "destacados":
        return { field: "destacado", direction: "desc" };
      default:
        return { field: "updatedAt", direction: "desc" };
    }
  }

  private normalizeCatalogFilters(query: CatalogQuery): CatalogCursor["filters"] {
    return {
      category: query.category || query.categoria,
      line: query.line || query.linea,
      talla: query.talla,
      minPrice: query.minPrice,
      maxPrice: query.maxPrice,
      q: query.q ? this.normalizeSearchText(query.q) : undefined,
      onlyOffers: query.onlyOffers,
      onlyAvailable: query.onlyAvailable,
    };
  }

  private assertCursorMatchesQuery(
    cursor: CatalogCursor,
    sort: CatalogSort,
    filters: CatalogCursor["filters"],
  ): void {
    if (
      cursor.sort !== sort ||
      JSON.stringify(cursor.filters) !== JSON.stringify(filters)
    ) {
      throw new CatalogQueryError(
        "cursor no corresponde a los filtros actuales",
      );
    }
  }

  private getProductStockTotal(product: Producto): number {
    return Math.max(0, Math.floor(Number(product.existencias || 0)));
  }

  private isProductAvailableForCatalog(product: Producto): boolean {
    return this.getProductStockTotal(product) > 0;
  }

  private toCatalogOrderValue(
    product: Producto,
    sortField: string,
  ): string | number | boolean | null {
    if (sortField === "createdAt" || sortField === "updatedAt") {
      const value =
        sortField === "createdAt" ? product.createdAt : product.updatedAt;
      return typeof value?.toMillis === "function" ? value.toMillis() : null;
    }

    if (sortField === "destacado") {
      return product.destacado === true;
    }

    const record = product as unknown as Record<string, unknown>;
    const value = record[sortField];

    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      return value;
    }

    return null;
  }

  private getCursorStartAfterValue(
    value: CatalogCursor["last"]["value"],
    sortField: string,
  ): string | number | boolean | FirebaseFirestore.Timestamp | null {
    if (sortField === "createdAt" || sortField === "updatedAt") {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new CatalogQueryError("cursor invalido para ordenamiento");
      }

      return admin.firestore.Timestamp.fromMillis(value);
    }

    return value;
  }

  private async loadCatalogLabels(): Promise<{
    categorias: Map<string, string>;
    lineas: Map<string, string>;
  }> {
    const [categorySnapshot, lineSnapshot] = await Promise.all([
      firestoreTienda.collection(CATEGORIAS_COLLECTION).get(),
      firestoreTienda.collection(LINEAS_COLLECTION).get(),
    ]);

    const categorias = new Map<string, string>();
    categorySnapshot.docs.forEach((doc) => {
      const data = doc.data();
      if (data.activo !== false && typeof data.nombre === "string") {
        categorias.set(doc.id, data.nombre);
      }
    });

    const lineas = new Map<string, string>();
    lineSnapshot.docs.forEach((doc) => {
      const data = doc.data();
      if (data.activo !== false && typeof data.nombre === "string") {
        lineas.set(doc.id, data.nombre);
      }
    });

    return { categorias, lineas };
  }

  private toCatalogCard(
    product: Producto,
    labels: { categorias: Map<string, string>; lineas: Map<string, string> },
  ): CatalogProductCardDTO {
    const precioOriginal = Math.max(0, Number(product.precioPublico || 0));
    const stockTotal = this.getProductStockTotal(product);
    const disponible = this.isProductAvailableForCatalog(product);
    const offerSnapshot = readStoredOfferSnapshot(product);
    const tieneOferta =
      offerSnapshot?.tieneOfertaActiva === true &&
      typeof offerSnapshot.precioOferta === "number" &&
      offerSnapshot.precioOferta > 0 &&
      offerSnapshot.precioOferta < precioOriginal;
    const precioFinal = tieneOferta
      ? offerSnapshot!.precioOferta!
      : precioOriginal;
    const descuentoTotal = tieneOferta
      ? Math.max(0, precioOriginal - precioFinal)
      : 0;
    const porcentajeDescuento = tieneOferta
      ? offerSnapshot?.porcentajeDescuento ??
        (precioOriginal > 0
          ? Math.round((descuentoTotal / precioOriginal) * 100)
          : 0)
      : 0;

    return {
      id: product.id || "",
      slug: product.slug || this.buildSlug(product.descripcion || product.id || "producto"),
      nombre: product.descripcion || "",
      categoria: product.categoriaId || "",
      categoriaLabel:
        labels.categorias.get(product.categoriaId) || product.categoriaId || "",
      linea: product.lineaId || "",
      lineaLabel: labels.lineas.get(product.lineaId) || product.lineaId || "",
      precioOriginal,
      precioFinal,
      tieneOferta,
      ofertaAplicadaId: tieneOferta
        ? offerSnapshot?.ofertaAplicadaId ?? null
        : null,
      ofertaTitulo: tieneOferta ? offerSnapshot?.ofertaTitulo ?? null : null,
      descuentoTotal,
      porcentajeDescuento,
      imagenPrincipal:
        Array.isArray(product.imagenes) && product.imagenes.length > 0
          ? product.imagenes[0]
          : null,
      imagenes: Array.isArray(product.imagenes)
        ? product.imagenes.filter(Boolean)
        : [],
      stockTotal,
      disponible,
      destacado: product.destacado === true,
    };
  }

  private matchesCatalogFilters(
    product: Producto,
    filters: CatalogCursor["filters"],
    legacyOfertasActivas?: Oferta[] | null,
    options?: { skipOfferFilter?: boolean },
  ): boolean {
    if (filters.category && product.categoriaId !== filters.category) {
      return false;
    }

    if (filters.line && product.lineaId !== filters.line) {
      return false;
    }

    if (
      filters.talla &&
      !(product.tallaIds ?? []).includes(filters.talla)
    ) {
      return false;
    }

    if (
      filters.minPrice !== undefined &&
      Number(product.precioPublico || 0) < filters.minPrice
    ) {
      return false;
    }

    if (
      filters.maxPrice !== undefined &&
      Number(product.precioPublico || 0) > filters.maxPrice
    ) {
      return false;
    }

    if (filters.onlyAvailable && !this.isProductAvailableForCatalog(product)) {
      return false;
    }

    if (filters.onlyOffers && !options?.skipOfferFilter) {
      if (product.tieneOfertaActiva === true) {
        // Indexed snapshot marks this product as on offer.
      } else if (product.tieneOfertaActiva === false) {
        return false;
      } else if (legacyOfertasActivas) {
        const mejorOferta = seleccionarMejorOferta(legacyOfertasActivas, {
          id: product.id || "",
          precioPublico: product.precioPublico,
          categoriaId: product.categoriaId,
          lineaId: product.lineaId,
        });

        if (!mejorOferta) {
          return false;
        }
      } else {
        return false;
      }
    }

    return true;
  }

  private buildCatalogFirestoreQuery(
    filters: CatalogCursor["filters"],
    sortConfig: { field: string; direction: FirebaseFirestore.OrderByDirection },
    options?: { skipOfferIndexFilter?: boolean },
  ): FirebaseFirestore.Query {
    let firestoreQuery: FirebaseFirestore.Query = firestoreTienda
      .collection(PRODUCTOS_COLLECTION)
      .where("activo", "==", true);

    if (filters.category) {
      firestoreQuery = firestoreQuery.where("categoriaId", "==", filters.category);
    }

    if (filters.line) {
      firestoreQuery = firestoreQuery.where("lineaId", "==", filters.line);
    }

    if (filters.talla) {
      firestoreQuery = firestoreQuery.where(
        "tallaIds",
        "array-contains",
        filters.talla,
      );
    }

    if (filters.minPrice !== undefined) {
      firestoreQuery = firestoreQuery.where(
        "precioPublico",
        ">=",
        filters.minPrice,
      );
    }

    if (filters.maxPrice !== undefined) {
      firestoreQuery = firestoreQuery.where(
        "precioPublico",
        "<=",
        filters.maxPrice,
      );
    }

    if (filters.q) {
      firestoreQuery = firestoreQuery
        .where("searchText", ">=", filters.q)
        .where("searchText", "<=", `${filters.q}\uf8ff`);
    }

    if (filters.onlyOffers && !options?.skipOfferIndexFilter) {
      firestoreQuery = firestoreQuery.where("tieneOfertaActiva", "==", true);
    }

    return firestoreQuery
      .orderBy(sortConfig.field, sortConfig.direction)
      .orderBy(admin.firestore.FieldPath.documentId(), sortConfig.direction);
  }

  private async listCatalogProductsFromFirestore(
    query: CatalogQuery,
    filters: CatalogCursor["filters"],
    effectiveSort: CatalogSort,
    sortConfig: { field: string; direction: FirebaseFirestore.OrderByDirection },
  ): Promise<CatalogResponse> {
    const pageLimit = query.limit;
    const batchSize = Math.max(pageLimit * 3, 48);
    const maxScanDocs = 1000;
    const labels = await this.loadCatalogLabels();
    let baseQuery = this.buildCatalogFirestoreQuery(filters, sortConfig);
    let legacyOfertasActivas: Oferta[] | null = null;

    let startAfterValue:
      | string
      | number
      | boolean
      | FirebaseFirestore.Timestamp
      | null = null;
    let startAfterId: string | null = null;

    if (query.cursor) {
      const cursor = this.decodeCatalogCursor(query.cursor);
      this.assertCursorMatchesQuery(cursor, effectiveSort, filters);
      startAfterValue = this.getCursorStartAfterValue(
        cursor.last.value,
        sortConfig.field,
      );
      startAfterId = cursor.last.id;
    }

    const matched: Producto[] = [];
    let lastScannedProduct: Producto | null = null;
    let scannedDocs = 0;
    let firestoreExhausted = false;

    while (
      matched.length < pageLimit + 1 &&
      !firestoreExhausted &&
      scannedDocs < maxScanDocs
    ) {
      let firestoreQuery = baseQuery;

      if (startAfterValue !== null && startAfterId) {
        firestoreQuery = firestoreQuery.startAfter(
          startAfterValue,
          startAfterId,
        );
      }

      let snapshot: FirebaseFirestore.QuerySnapshot;

      try {
        snapshot = await firestoreQuery.limit(batchSize).get();
      } catch (error) {
        if (
          filters.onlyOffers &&
          legacyOfertasActivas === null &&
          isFirestoreMissingIndexError(error)
        ) {
          legacyOfertasActivas = await ofertasService.listarOfertasActivas();
          baseQuery = this.buildCatalogFirestoreQuery(filters, sortConfig, {
            skipOfferIndexFilter: true,
          });
          continue;
        }

        throw error;
      }

      if (snapshot.empty) {
        firestoreExhausted = true;
        break;
      }

      scannedDocs += snapshot.docs.length;

      for (const doc of snapshot.docs) {
        const product = this.normalizeProduct(doc.id, doc.data());
        lastScannedProduct = product;

        if (!this.matchesCatalogFilters(product, filters, legacyOfertasActivas)) {
          continue;
        }

        matched.push(product);

        if (matched.length >= pageLimit + 1) {
          break;
        }
      }

      if (snapshot.docs.length < batchSize) {
        firestoreExhausted = true;
      } else if (matched.length < pageLimit + 1 && lastScannedProduct) {
        startAfterValue = this.getCursorStartAfterValue(
          this.toCatalogOrderValue(lastScannedProduct, sortConfig.field),
          sortConfig.field,
        );
        startAfterId = lastScannedProduct.id || "";
      }
    }

    const hasMore = matched.length > pageLimit;
    const pageProducts = matched.slice(0, pageLimit);
    const items = pageProducts.map((product) =>
      this.toCatalogCard(product, labels),
    );
    const cursorProduct = pageProducts[pageProducts.length - 1];

    return {
      items,
      hasMore,
      nextCursor:
        hasMore && cursorProduct
          ? this.encodeCatalogCursor({
              v: CURSOR_VERSION,
              sort: effectiveSort,
              filters,
              last: {
                value: this.toCatalogOrderValue(cursorProduct, sortConfig.field),
                id: cursorProduct.id || "",
              },
            })
          : null,
    };
  }

  private async listCatalogProductsByAggregateRanking(
    query: CatalogQuery,
    filters: CatalogCursor["filters"],
    sort: Extract<
      CatalogSort,
      | "destacados"
      | "populares"
      | "mas_comprados"
      | "ofertas_populares"
      | "ofertas_mas_compradas"
      | "ofertas_recientes"
    >,
    getRankedIds: (limit: number) => Promise<string[]>,
  ): Promise<CatalogResponse> {
    const rankedIds = await getRankedIds(200);
    const labels = await this.loadCatalogLabels();

    let offset = 0;
    if (query.cursor) {
      const cursor = this.decodeCatalogCursor(query.cursor);
      this.assertCursorMatchesQuery(cursor, sort, filters);
      offset =
        typeof cursor.last.value === "number" && Number.isFinite(cursor.last.value)
          ? cursor.last.value
          : 0;
    }

    const refs = rankedIds.map((id) =>
      firestoreTienda.collection(PRODUCTOS_COLLECTION).doc(id),
    );
    const snapshots =
      refs.length > 0 ? await firestoreTienda.getAll(...refs) : [];

    const products = snapshots
      .filter((snapshot) => snapshot.exists && snapshot.data())
      .map((snapshot) =>
        this.normalizeProduct(snapshot.id, snapshot.data() as FirebaseFirestore.DocumentData),
      )
      .filter((product) => product.activo === true);

    const skipOfferFilter = filters.onlyOffers && sort.startsWith("ofertas_");

    const filteredProducts = products.filter((product) =>
      this.matchesCatalogFilters(product, filters, null, {
        skipOfferFilter,
      }),
    );

    const pageProducts = filteredProducts.slice(offset, offset + query.limit);
    const hasMore = offset + query.limit < filteredProducts.length;
    const items = pageProducts.map((product) => this.toCatalogCard(product, labels));
    const lastProduct = pageProducts[pageProducts.length - 1];

    return {
      items,
      hasMore,
      nextCursor:
        hasMore && lastProduct
          ? this.encodeCatalogCursor({
              v: CURSOR_VERSION,
              sort,
              filters,
              last: {
                value: offset + pageProducts.length,
                id: lastProduct.id || "",
              },
            })
          : null,
    };
  }

  private async listCatalogProductsByDestacados(
    query: CatalogQuery,
    filters: CatalogCursor["filters"],
  ): Promise<CatalogResponse> {
    const aggregatesService = (
      await import("./recomendaciones/aggregates.service")
    ).default;

    return this.listCatalogProductsByAggregateRanking(
      query,
      filters,
      "destacados",
      (limit) => aggregatesService.getDestacadosRankedProductIds(limit),
    );
  }

  private async listCatalogProductsByPopulares(
    query: CatalogQuery,
    filters: CatalogCursor["filters"],
  ): Promise<CatalogResponse> {
    const aggregatesService = (
      await import("./recomendaciones/aggregates.service")
    ).default;

    return this.listCatalogProductsByAggregateRanking(
      query,
      filters,
      "populares",
      (limit) => aggregatesService.getPopularesRankedProductIds(limit),
    );
  }

  private async listCatalogProductsByMasComprados(
    query: CatalogQuery,
    filters: CatalogCursor["filters"],
  ): Promise<CatalogResponse> {
    const aggregatesService = (
      await import("./recomendaciones/aggregates.service")
    ).default;

    return this.listCatalogProductsByAggregateRanking(
      query,
      filters,
      "mas_comprados",
      (limit) => aggregatesService.getMasCompradosRankedProductIds(limit),
    );
  }

  private async listCatalogProductsByOfertasPopulares(
    query: CatalogQuery,
    filters: CatalogCursor["filters"],
  ): Promise<CatalogResponse> {
    const aggregatesService = (
      await import("./recomendaciones/aggregates.service")
    ).default;

    return this.listCatalogProductsByAggregateRanking(
      query,
      filters,
      "ofertas_populares",
      (limit) => aggregatesService.getOfertasPopularesRankedProductIds(limit),
    );
  }

  private async listCatalogProductsByOfertasMasCompradas(
    query: CatalogQuery,
    filters: CatalogCursor["filters"],
  ): Promise<CatalogResponse> {
    const aggregatesService = (
      await import("./recomendaciones/aggregates.service")
    ).default;

    return this.listCatalogProductsByAggregateRanking(
      query,
      filters,
      "ofertas_mas_compradas",
      (limit) => aggregatesService.getOfertasMasCompradasRankedProductIds(limit),
    );
  }

  private async listCatalogProductsByOfertasRecientes(
    query: CatalogQuery,
    filters: CatalogCursor["filters"],
  ): Promise<CatalogResponse> {
    const aggregatesService = (
      await import("./recomendaciones/aggregates.service")
    ).default;

    return this.listCatalogProductsByAggregateRanking(
      query,
      filters,
      "ofertas_recientes",
      (limit) => aggregatesService.getOfertasRecientesRankedProductIds(limit),
    );
  }

  private shouldUseAggregateCatalogRanking(
    sort: CatalogSort,
    filters: CatalogCursor["filters"],
  ): boolean {
    if (filters.q) {
      return false;
    }

    return (
      sort === "destacados" ||
      sort === "populares" ||
      sort === "mas_comprados" ||
      sort === "ofertas_populares" ||
      sort === "ofertas_mas_compradas" ||
      sort === "ofertas_recientes"
    );
  }

  private isOfertasCatalogSort(sort: CatalogSort): boolean {
    return (
      sort === "ofertas_populares" ||
      sort === "ofertas_mas_compradas" ||
      sort === "ofertas_recientes"
    );
  }

  private resolveCatalogSort(query: CatalogQuery): CatalogSort {
    if (this.isOfertasCatalogSort(query.sort)) {
      return query.sort;
    }

    if (query.onlyOffers) {
      return "ofertas_populares";
    }

    return query.sort;
  }

  private async listCatalogProductsWithMemorySearch(
    query: CatalogQuery,
    filters: CatalogCursor["filters"],
    effectiveSort: CatalogSort,
    offset = 0,
  ): Promise<CatalogResponse> {
    const pageLimit = query.limit;
    const labels = await this.loadCatalogLabels();
    const normalizedTerm = filters.q || "";
    const filtersWithoutQuery = { ...filters, q: undefined };
    const sortConfig = { field: "updatedAt", direction: "desc" as const };
    let baseQuery = this.buildCatalogFirestoreQuery(
      filtersWithoutQuery,
      sortConfig,
    );
    let legacyOfertasActivas: Oferta[] | null = null;

    if (filters.onlyOffers) {
      legacyOfertasActivas = await ofertasService.listarOfertasActivas();
    }

    const matched: Producto[] = [];
    let scannedDocs = 0;
    const batchSize = 200;
    let startAfterValue:
      | string
      | number
      | boolean
      | FirebaseFirestore.Timestamp
      | null = null;
    let startAfterId: string | null = null;

    while (matched.length < CATALOG_SEARCH_MAX_SCAN && scannedDocs < CATALOG_SEARCH_MAX_SCAN) {
      let firestoreQuery = baseQuery;

      if (startAfterValue !== null && startAfterId) {
        firestoreQuery = firestoreQuery.startAfter(
          startAfterValue,
          startAfterId,
        );
      }

      const snapshot = await firestoreQuery.limit(batchSize).get();
      if (snapshot.empty) {
        break;
      }

      scannedDocs += snapshot.docs.length;

      for (const doc of snapshot.docs) {
        const product = this.normalizeProduct(doc.id, doc.data());

        if (
          !this.matchesCatalogSearchQuery(product, normalizedTerm, labels) ||
          !this.matchesCatalogFilters(product, filters, legacyOfertasActivas)
        ) {
          continue;
        }

        matched.push(product);

        if (matched.length >= CATALOG_SEARCH_MAX_SCAN) {
          break;
        }
      }

      if (snapshot.docs.length < batchSize || matched.length >= CATALOG_SEARCH_MAX_SCAN) {
        break;
      }

      const lastProduct = this.normalizeProduct(
        snapshot.docs[snapshot.docs.length - 1].id,
        snapshot.docs[snapshot.docs.length - 1].data(),
      );
      startAfterValue = this.getCursorStartAfterValue(
        this.toCatalogOrderValue(lastProduct, "updatedAt"),
        "updatedAt",
      );
      startAfterId = lastProduct.id || "";
    }

    matched.sort((left, right) =>
      (left.descripcion || "").localeCompare(right.descripcion || "", "es-MX"),
    );

    const pageProducts = matched.slice(offset, offset + pageLimit);
    const hasMore = matched.length > offset + pageLimit;
    const cursorProduct = pageProducts[pageProducts.length - 1];

    return {
      items: pageProducts.map((product) => this.toCatalogCard(product, labels)),
      hasMore,
      nextCursor:
        hasMore && cursorProduct
          ? this.encodeCatalogCursor({
              v: CURSOR_VERSION,
              sort: effectiveSort,
              filters,
              last: {
                value: offset + pageProducts.length,
                id: cursorProduct.id || "",
              },
            })
          : null,
    };
  }

  private async listCatalogProductsWithSearch(
    query: CatalogQuery,
    filters: CatalogCursor["filters"],
    effectiveSort: CatalogSort,
  ): Promise<CatalogResponse> {
    if (query.cursor) {
      const cursor = this.decodeCatalogCursor(query.cursor);
      this.assertCursorMatchesQuery(cursor, effectiveSort, filters);

      if (typeof cursor.last.value === "number" && Number.isFinite(cursor.last.value)) {
        return this.listCatalogProductsWithMemorySearch(
          query,
          filters,
          effectiveSort,
          cursor.last.value,
        );
      }

      return this.listCatalogProductsFromFirestore(
        query,
        filters,
        effectiveSort,
        { field: "searchText", direction: "asc" },
      );
    }

    const prefixResult = await this.listCatalogProductsFromFirestore(
      query,
      filters,
      effectiveSort,
      { field: "searchText", direction: "asc" },
    );

    if (prefixResult.items.length > 0) {
      return prefixResult;
    }

    return this.listCatalogProductsWithMemorySearch(
      query,
      filters,
      effectiveSort,
      0,
    );
  }

  async listCatalogProducts(query: CatalogQuery): Promise<CatalogResponse> {
    const filters = this.normalizeCatalogFilters(query);
    const resolvedSort = this.resolveCatalogSort(query);
    const effectiveSort: CatalogSort = filters.q ? "nombre_asc" : resolvedSort;

    if (filters.q) {
      if (
        (filters.minPrice !== undefined || filters.maxPrice !== undefined) &&
        !["precio_asc", "precio_desc"].includes(effectiveSort)
      ) {
        throw new CatalogQueryError(
          "minPrice/maxPrice requieren sort=precio_asc o sort=precio_desc",
        );
      }

      return this.listCatalogProductsWithSearch(query, filters, effectiveSort);
    }

    if (this.shouldUseAggregateCatalogRanking(effectiveSort, filters)) {
      if (effectiveSort === "destacados") {
        return this.listCatalogProductsByDestacados(query, filters);
      }

      if (effectiveSort === "populares") {
        return this.listCatalogProductsByPopulares(query, filters);
      }

      if (effectiveSort === "mas_comprados") {
        return this.listCatalogProductsByMasComprados(query, filters);
      }

      if (effectiveSort === "ofertas_populares") {
        return this.listCatalogProductsByOfertasPopulares(query, filters);
      }

      if (effectiveSort === "ofertas_mas_compradas") {
        return this.listCatalogProductsByOfertasMasCompradas(query, filters);
      }

      if (effectiveSort === "ofertas_recientes") {
        return this.listCatalogProductsByOfertasRecientes(query, filters);
      }
    }

    const sortConfig = filters.q
      ? { field: "searchText", direction: "asc" as const }
      : this.getCatalogSortConfig(effectiveSort);

    if (
      (filters.minPrice !== undefined || filters.maxPrice !== undefined) &&
      !["precio_asc", "precio_desc"].includes(effectiveSort)
    ) {
      throw new CatalogQueryError(
        "minPrice/maxPrice requieren sort=precio_asc o sort=precio_desc",
      );
    }

    return this.listCatalogProductsFromFirestore(
      query,
      filters,
      effectiveSort,
      sortConfig,
    );
  }

  private toAdminProductListItem(product: Producto): AdminProductListItemDTO {
    const existencias = Math.max(0, Math.floor(Number(product.existencias || 0)));

    return {
      id: product.id || "",
      clave: product.clave || "",
      descripcion: product.descripcion || "",
      slug: product.slug || this.buildSlug(product.descripcion || product.id || "producto"),
      lineaId: product.lineaId || "",
      categoriaId: product.categoriaId || "",
      precioPublico: Math.max(0, Number(product.precioPublico || 0)),
      existencias,
      disponible:
        typeof product.disponible === "boolean"
          ? product.disponible
          : existencias > 0,
      destacado: product.destacado === true,
      activo: product.activo === true,
      imagenPrincipal:
        Array.isArray(product.imagenes) && product.imagenes.length > 0
          ? product.imagenes[0]
          : null,
      createdAt: product.createdAt,
      updatedAt: product.updatedAt,
    };
  }

  async getAdminProducts(
    query: AdminProductsQuery,
  ): Promise<AdminProductListItemDTO[]> {
    let firestoreQuery: FirebaseFirestore.Query =
      firestoreTienda.collection(PRODUCTOS_COLLECTION);

    if (query.estado === "activo") {
      firestoreQuery = firestoreQuery.where("activo", "==", true);
    } else if (query.estado === "inactivo") {
      firestoreQuery = firestoreQuery.where("activo", "==", false);
    }

    const snapshot = await firestoreQuery.orderBy("updatedAt", "desc").get();
    return snapshot.docs
      .map((doc) => this.normalizeProduct(doc.id, doc.data()))
      .map((product) => this.toAdminProductListItem(product));
  }

  async setProductActiveStatus(
    productId: string,
    activo: boolean,
  ): Promise<Producto> {
    return this.updateProduct(productId, { activo });
  }

  async backfillProductSearchText(options?: {
    dryRun?: boolean;
    onlyActive?: boolean;
  }): Promise<{ processed: number; updated: number; skipped: number }> {
    const dryRun = options?.dryRun === true;
    const onlyActive = options?.onlyActive !== false;
    const labels = await this.loadCatalogLabels();
    const snapshot = await firestoreTienda.collection(PRODUCTOS_COLLECTION).get();

    let processed = 0;
    let updated = 0;
    let skipped = 0;
    let batch = firestoreTienda.batch();
    let batchOps = 0;

    for (const doc of snapshot.docs) {
      processed += 1;
      const data = doc.data();

      if (onlyActive && data.activo !== true) {
        skipped += 1;
        continue;
      }

      const nextSearchText = this.buildProductSearchText(
        {
          descripcion: String(data.descripcion ?? ""),
          clave: String(data.clave ?? ""),
          categoriaId: String(data.categoriaId ?? ""),
          lineaId: String(data.lineaId ?? ""),
        },
        {
          categoriaNombre: labels.categorias.get(String(data.categoriaId ?? "")),
          lineaNombre: labels.lineas.get(String(data.lineaId ?? "")),
        },
      );

      if (typeof data.searchText === "string" && data.searchText.trim() === nextSearchText) {
        skipped += 1;
        continue;
      }

      if (!dryRun) {
        batch.update(doc.ref, {
          searchText: nextSearchText,
          updatedAt: admin.firestore.Timestamp.now(),
        });
        batchOps += 1;

        if (batchOps >= 400) {
          await batch.commit();
          batch = firestoreTienda.batch();
          batchOps = 0;
        }
      }

      updated += 1;
    }

    if (!dryRun && batchOps > 0) {
      await batch.commit();
    }

    return { processed, updated, skipped };
  }

  /**
   * Crea un nuevo producto
   * @param productoData - Datos del producto a crear
   * @returns Promise con el producto creado incluyendo su ID
   */
  async createProduct(
    productoData: Omit<Producto, "id" | "createdAt" | "updatedAt">,
  ): Promise<Producto> {
    try {
      const now = admin.firestore.Timestamp.now();
      const { tallaIds, inventarioPorTalla } = this.getValidatedSizeInventory(
        productoData.tallaIds,
        productoData.inventarioPorTalla,
      );
      const stockMinimoGlobal = this.getNormalizedGlobalThreshold(
        productoData.stockMinimoGlobal,
      );
      const stockMinimoPorTalla = this.normalizeStockThresholdBySize(
        productoData.stockMinimoPorTalla,
      );
      const existencias = this.getDerivedExistencias(
        tallaIds,
        inventarioPorTalla,
        productoData.existencias,
      );

      // Validar que la clave no exista
      const existingProduct = await firestoreTienda
        .collection(PRODUCTOS_COLLECTION)
        .where("clave", "==", productoData.clave)
        .limit(1)
        .get();

      if (!existingProduct.empty) {
        throw new Error(
          `Ya existe un producto con la clave: ${productoData.clave}`,
        );
      }

      // Crear el documento con timestamps
      const searchText = await this.resolveProductSearchText(
        {
          descripcion: productoData.descripcion,
          clave: productoData.clave,
          categoriaId: productoData.categoriaId,
          lineaId: productoData.lineaId,
        },
        productoData.searchText,
      );

      const docRef = await firestoreTienda
        .collection(PRODUCTOS_COLLECTION)
        .add({
          ...productoData,
          slug: productoData.slug || this.buildSlug(productoData.descripcion),
          searchText,
          tallaIds,
          inventarioPorTalla,
          stockMinimoGlobal,
          stockMinimoPorTalla,
          existencias,
          disponible: existencias > 0,
          destacado: productoData.destacado === true,
          ratingSummary: productoData.ratingSummary || DEFAULT_PRODUCT_RATING_SUMMARY,
          ratingTotalScore: 0,
          createdAt: now,
          updatedAt: now,
        });

      // Obtener el documento creado
      const docSnapshot = await docRef.get();
      const nuevoProducto = this.normalizeProduct(docRef.id, docSnapshot.data()!);

      console.log(
        `Producto creado: ${nuevoProducto.descripcion} (ID: ${nuevoProducto.id})`,
      );
      return nuevoProducto;
    } catch (error) {
      console.error("❌ Error al crear producto:", error);
      throw new Error(
        error instanceof Error ? error.message : "Error al crear el producto",
      );
    }
  }

  /**
   * Actualiza un producto existente
   * @param id - ID del producto a actualizar
   * @param updateData - Datos a actualizar
   * @returns Promise con el producto actualizado
   */
  async updateProduct(
    id: string,
    updateData: Partial<Omit<Producto, "id" | "createdAt" | "updatedAt">>,
  ): Promise<Producto> {
    try {
      const docRef = firestoreTienda.collection(PRODUCTOS_COLLECTION).doc(id);
      const doc = await docRef.get();

      if (!doc.exists) {
        throw new Error(`Producto con ID ${id} no encontrado`);
      }

      // Si se intenta actualizar la clave, validar que no exista
      if (updateData.clave) {
        const existingProduct = await firestoreTienda
          .collection(PRODUCTOS_COLLECTION)
          .where("clave", "==", updateData.clave)
          .limit(1)
          .get();

        if (!existingProduct.empty && existingProduct.docs[0].id !== id) {
          throw new Error(
            `Ya existe otro producto con la clave: ${updateData.clave}`,
          );
        }
      }

      // Actualizar con timestamp
      const now = admin.firestore.Timestamp.now();
      const productoActual = this.normalizeProduct(doc.id, doc.data()!);

      const tallaIds =
        updateData.tallaIds !== undefined
          ? normalizeTallaIds(updateData.tallaIds)
          : normalizeTallaIds(productoActual.tallaIds);
      const inventarioInput =
        updateData.inventarioPorTalla !== undefined
          ? updateData.inventarioPorTalla
          : updateData.tallaIds !== undefined && tallaIds.length === 0
            ? []
          : productoActual.inventarioPorTalla;
      const strictInventoryValidation =
        updateData.inventarioPorTalla !== undefined ||
        updateData.tallaIds !== undefined;
      const inventarioPorTalla = this.normalizeInventoryBySize(
        inventarioInput,
        tallaIds,
        strictInventoryValidation,
      );

      const stockMinimoPorTalla =
        updateData.stockMinimoPorTalla !== undefined
          ? this.normalizeStockThresholdBySize(updateData.stockMinimoPorTalla)
          : this.normalizeStockThresholdBySize(
              productoActual.stockMinimoPorTalla,
            );

      const stockMinimoGlobal =
        updateData.stockMinimoGlobal !== undefined
          ? this.getNormalizedGlobalThreshold(updateData.stockMinimoGlobal)
          : this.getNormalizedGlobalThreshold(productoActual.stockMinimoGlobal);

      const payload: Partial<Omit<Producto, "id" | "createdAt">> = {
        ...updateData,
        updatedAt: now,
        tallaIds,
        inventarioPorTalla,
        existencias: this.getDerivedExistencias(
          tallaIds,
          inventarioPorTalla,
          updateData.existencias ?? productoActual.existencias,
        ),
      };
      payload.disponible = (payload.existencias ?? 0) > 0;
      payload.slug =
        updateData.slug ||
        this.buildSlug(updateData.descripcion || productoActual.descripcion);
      payload.searchText = await this.resolveProductSearchText(
        {
          descripcion: updateData.descripcion || productoActual.descripcion,
          clave: updateData.clave || productoActual.clave,
          categoriaId: updateData.categoriaId || productoActual.categoriaId,
          lineaId: updateData.lineaId || productoActual.lineaId,
        },
        updateData.searchText,
      );
      payload.destacado =
        updateData.destacado !== undefined
          ? updateData.destacado === true
          : productoActual.destacado === true;

      if (updateData.stockMinimoPorTalla !== undefined) {
        payload.stockMinimoPorTalla = stockMinimoPorTalla;
      }

      if (updateData.stockMinimoGlobal !== undefined) {
        payload.stockMinimoGlobal = stockMinimoGlobal;
      }

      await docRef.update({
        ...payload,
      });

      // Obtener el documento actualizado
      const updatedDoc = await docRef.get();
      const updatedProducto = this.normalizeProduct(updatedDoc.id, updatedDoc.data()!);

      await this.enqueueProductLifecycleEvents(
        productoActual,
        updatedProducto,
        "product_update",
      );

      const pricingFieldsChanged =
        updateData.precioPublico !== undefined ||
        updateData.categoriaId !== undefined ||
        updateData.lineaId !== undefined ||
        updateData.activo !== undefined;

      if (pricingFieldsChanged) {
        await productOfferSnapshotService
          .syncProductOfferSnapshot(updatedProducto.id || id)
          .catch((error: unknown) => {
            console.error(
              "Error sincronizando snapshot de oferta tras actualizar producto:",
              error,
            );
          });
      }

      console.log(`Producto actualizado: ${updatedProducto.descripcion}`);
      return updatedProducto;
    } catch (error) {
      console.error("Error al actualizar producto:", error);
      throw new Error(
        error instanceof Error
          ? error.message
          : "Error al actualizar el producto",
      );
    }
  }

  async getStockBySize(id: string): Promise<{
    productoId: string;
    tallaIds: string[];
    existencias: number;
    inventarioPorTalla: InventarioPorTalla[];
  } | null> {
    try {
      const doc = await firestoreTienda
        .collection(PRODUCTOS_COLLECTION)
        .doc(id)
        .get();

      if (!doc.exists) {
        return null;
      }

      const data = doc.data()!;
      const tallaIds = normalizeTallaIds(data.tallaIds);
      const inventarioPorTalla = this.normalizeInventoryBySize(
        data.inventarioPorTalla,
        tallaIds,
      );

      return {
        productoId: doc.id,
        tallaIds,
        existencias: this.getDerivedExistencias(
          tallaIds,
          inventarioPorTalla,
          data.existencias,
        ),
        inventarioPorTalla,
      };
    } catch (error) {
      console.error(
        `❌ Error al obtener stock por talla de producto ${id}:`,
        error,
      );
      throw new Error("Error al obtener stock por talla del producto");
    }
  }

  async getLowStockAlertByProductId(
    productoId: string,
  ): Promise<AlertaStockProducto | null> {
    const producto = await this.getProductById(productoId);

    if (!producto || !producto.activo) {
      return null;
    }

    const alert = this.evaluateLowStock(producto);
    return alert.totalAlertas > 0 ? alert : null;
  }

  async listLowStockProducts(
    filters: ListarAlertasStockQuery,
  ): Promise<AlertaStockProducto[]> {
    const snapshot = await firestoreTienda
      .collection(PRODUCTOS_COLLECTION)
      .where("activo", "==", true)
      .get();

    const allAlerts = snapshot.docs
      .map((doc) => {
        const data = doc.data() as Producto;
        const alert = this.evaluateLowStock({
          id: doc.id,
          clave: data.clave,
          descripcion: data.descripcion,
          lineaId: data.lineaId,
          categoriaId: data.categoriaId,
          existencias: data.existencias,
          tallaIds: data.tallaIds,
          stockMinimoGlobal: data.stockMinimoGlobal,
          stockMinimoPorTalla: data.stockMinimoPorTalla,
          inventarioPorTalla: data.inventarioPorTalla,
        });

        return alert;
      })
      .filter((alert) => alert.totalAlertas > 0);

    const filtered = allAlerts.filter((alert) => {
      if (filters.productoId && alert.productoId !== filters.productoId) {
        return false;
      }

      if (filters.lineaId && alert.lineaId !== filters.lineaId) {
        return false;
      }

      if (filters.categoriaId && alert.categoriaId !== filters.categoriaId) {
        return false;
      }

      if (filters.soloCriticas && alert.maxDeficit < 5) {
        return false;
      }

      return true;
    });

    filtered.sort((a, b) => {
      if (b.maxDeficit !== a.maxDeficit) {
        return b.maxDeficit - a.maxDeficit;
      }

      return a.descripcion.localeCompare(b.descripcion);
    });

    return filtered.slice(0, filters.limit);
  }

  /**
   * Actualiza stock de un producto de forma atómica y registra movimiento de inventario.
   * - Si el producto usa inventario por talla, requiere tallaId.
   * - Si no usa inventario por talla, actualiza existencias generales.
   * - Registra movimiento en colección `movimientosInventario`.
   */
  async updateStock(
    productoId: string,
    payload: UpdateProductStockDTO,
  ): Promise<ProductStockUpdateResult> {
    const cantidadNueva = Math.floor(Number(payload.cantidadNueva));

    if (!Number.isFinite(cantidadNueva) || cantidadNueva < 0) {
      throw new Error("La nueva cantidad no puede ser negativa");
    }

    const docRef = firestoreTienda
      .collection(PRODUCTOS_COLLECTION)
      .doc(productoId);

    try {
      const result = await firestoreTienda.runTransaction(
        async (transaction) => {
          const snapshot = await transaction.get(docRef);

          if (!snapshot.exists) {
            throw new Error(`Producto con ID ${productoId} no encontrado`);
          }

          const data = snapshot.data() as Producto;
          const now = admin.firestore.Timestamp.now();
          const tallaIdsProducto = normalizeTallaIds(data.tallaIds);
          const inventarioPorTallaActual = this.normalizeInventoryBySize(
            data.inventarioPorTalla,
            tallaIdsProducto,
            false,
          );
          const usaInventarioPorTalla = tallaIdsProducto.length > 0;

          let tallaIdMovimiento: string | null = null;
          let cantidadAnterior = 0;
          let inventarioPorTallaActualizado = inventarioPorTallaActual;
          let existenciasActualizadas = Math.max(
            0,
            Math.floor(Number(data.existencias ?? 0)),
          );

          if (usaInventarioPorTalla) {
            const tallaId = payload.tallaId?.trim();

            if (!tallaId) {
              throw new Error(
                "Se requiere tallaId para actualizar stock por talla en este producto",
              );
            }

            if (!tallaIdsProducto.includes(tallaId)) {
              throw new Error(
                `La talla \"${tallaId}\" no pertenece al producto ${productoId}`,
              );
            }

            const inventarioMap = new Map(
              inventarioPorTallaActual.map((item) => [item.tallaId, item.cantidad]),
            );
            cantidadAnterior = inventarioMap.get(tallaId) ?? 0;
            inventarioMap.set(tallaId, cantidadNueva);

            tallaIdMovimiento = tallaId;
            inventarioPorTallaActualizado = tallaIdsProducto.map((id) => {
              const cantidad = inventarioMap.get(id) ?? 0;
              const existing = inventarioPorTallaActual.find(
                (row) => row.tallaId === id,
              );
              const buckets = normalizeSizeBuckets(id, existing, cantidad);
              if (id === tallaId) {
                buckets.fisica = Math.max(
                  0,
                  cantidadNueva + buckets.reservada + buckets.noDisponible,
                );
                buckets.disponible = cantidadNueva;
              }
              return {
                tallaId: id,
                cantidad: id === tallaId ? cantidadNueva : buckets.disponible,
                fisica: buckets.fisica,
                reservada: buckets.reservada,
                noDisponible: buckets.noDisponible,
                entrante: buckets.entrante,
              };
            });

            existenciasActualizadas = this.getDerivedExistencias(
              tallaIdsProducto,
              inventarioPorTallaActualizado,
              data.existencias,
            );

            transaction.update(docRef, {
              ...(buildFirestoreInventoryPatch({
                tallaIds: tallaIdsProducto,
                inventarioPorTalla: inventarioPorTallaActualizado,
              }) as FirebaseFirestore.UpdateData<FirebaseFirestore.DocumentData>),
              updatedAt: now,
            });
          } else {
            if (payload.tallaId) {
              throw new Error(
                "Este producto no maneja inventario por talla; actualiza stock general sin tallaId",
              );
            }

            cantidadAnterior = existenciasActualizadas;
            existenciasActualizadas = cantidadNueva;
            const globalBuckets = normalizeGlobalBuckets(
              data as unknown as Record<string, unknown>,
              existenciasActualizadas,
            );
            globalBuckets.fisica = Math.max(
              0,
              cantidadNueva + globalBuckets.reservada + globalBuckets.noDisponible,
            );
            globalBuckets.disponible = cantidadNueva;

            transaction.update(docRef, {
              ...(buildFirestoreInventoryPatch({
                tallaIds: [],
                inventarioPorTalla: [],
                inventarioGlobal: globalBuckets,
              }) as FirebaseFirestore.UpdateData<FirebaseFirestore.DocumentData>),
              updatedAt: now,
            });
          }

          const diferencia = cantidadNueva - cantidadAnterior;
          const stockMinimoGlobal = this.getNormalizedGlobalThreshold(
            data.stockMinimoGlobal,
          );
          const stockMinimoPorTalla = this.normalizeStockThresholdBySize(
            data.stockMinimoPorTalla,
          );
          const lowStockSnapshot = this.evaluateLowStock({
            id: productoId,
            clave: data.clave,
            descripcion: data.descripcion,
            lineaId: data.lineaId,
            categoriaId: data.categoriaId,
            existencias: existenciasActualizadas,
            tallaIds: tallaIdsProducto,
            stockMinimoGlobal,
            stockMinimoPorTalla,
            inventarioPorTalla: inventarioPorTallaActualizado,
          });

          const movimientoRef = firestoreTienda
            .collection(MOVIMIENTOS_INVENTARIO_COLLECTION)
            .doc();

          transaction.set(movimientoRef, {
            productoId,
            tallaId: tallaIdMovimiento,
            cantidadAnterior,
            cantidadNueva,
            diferencia,
            tipo: payload.tipo ?? "ajuste",
            motivo: payload.motivo,
            referencia: payload.referencia,
            ordenId: payload.ordenId,
            usuarioId: payload.usuarioId,
            createdAt: now,
          });

          return {
            productoId,
            tallaId: tallaIdMovimiento,
            cantidadAnterior,
            cantidadNueva,
            diferencia,
            existencias: existenciasActualizadas,
            inventarioPorTalla: inventarioPorTallaActualizado,
            stockMinimoGlobal,
            stockMinimoPorTalla,
            alertaStockBajo: {
              activo: lowStockSnapshot.totalAlertas > 0,
              totalAlertas: lowStockSnapshot.totalAlertas,
              maxDeficit: lowStockSnapshot.maxDeficit,
            },
            movimientoId: movimientoRef.id,
            createdAt:
              typeof (now as { toDate?: () => Date }).toDate === "function"
                ? (now as { toDate: () => Date }).toDate()
                : (now as unknown as Date),
            previousExistencias: Math.max(
              0,
              Math.floor(Number(data.existencias ?? 0)),
            ),
          } as ProductStockUpdateResult;
        },
      );

      if (result.alertaStockBajo.activo) {
        const alert = await this.getLowStockAlertByProductId(productoId);

        if (alert) {
          await stockAlertService.notifyRealtime([alert]);
        }
      }

      const updatedProduct = await this.getProductById(productoId);
      const previousExistencias = (
        result as ProductStockUpdateResult & { previousExistencias?: number }
      ).previousExistencias;
      if (updatedProduct) {
        await this.enqueueProductLifecycleEvents(
          {
            ...updatedProduct,
            existencias: previousExistencias ?? updatedProduct.existencias,
            precioPublico: updatedProduct.precioPublico,
          },
          updatedProduct,
          "product_stock_update",
        );
      }

      return result;
    } catch (error) {
      console.error(
        `❌ Error al actualizar stock de producto ${productoId}:`,
        error,
      );
      throw new Error(
        error instanceof Error
          ? error.message
          : "Error al actualizar stock del producto",
      );
    }
  }

  async searchProductsForAssistant(
    searchTerm: string,
    filters: AssistantProductSearchFilters = {},
  ): Promise<AssistantProductSearchResult[]> {
    const products = await this.getAllProducts();
    const query = filters.normalizedQuery || searchTerm;

    const ranked = products
      .map((product) => this.scoreAssistantSearchResult(product, query, filters))
      .filter(
        (product): product is AssistantProductSearchResult => product !== null,
      );

    if (filters.pricePreference === "lowest") {
      ranked.sort((a, b) => {
        if (a.precioPublico !== b.precioPublico) {
          return a.precioPublico - b.precioPublico;
        }
        return b.score - a.score;
      });
    } else if (filters.pricePreference === "premium") {
      ranked.sort((a, b) => {
        if (a.precioPublico !== b.precioPublico) {
          return b.precioPublico - a.precioPublico;
        }
        return b.score - a.score;
      });
    } else {
      ranked.sort((a, b) => {
        if (b.score !== a.score) {
          return b.score - a.score;
        }

        return a.precioPublico - b.precioPublico;
      });
    }

    return ranked.slice(0, 12);
  }

  async replaceSizeInventory(
    productoId: string,
    payload: ReplaceProductSizeInventoryDTO,
  ): Promise<ReplaceProductSizeInventoryResult> {
    const docRef = firestoreTienda
      .collection(PRODUCTOS_COLLECTION)
      .doc(productoId);

    try {
      const txResult = await firestoreTienda.runTransaction(
        async (transaction) => {
          const snapshot = await transaction.get(docRef);

          if (!snapshot.exists) {
            throw new Error(`Producto con ID ${productoId} no encontrado`);
          }

          const data = snapshot.data() as Producto;
          const now = admin.firestore.Timestamp.now();
          const tallaIds = normalizeTallaIds(data.tallaIds);

          if (tallaIds.length === 0) {
            throw new Error(
              "Este producto no maneja inventario por talla; no se puede usar inventario-tallas",
            );
          }

          const inventarioActual = this.normalizeInventoryBySize(
            data.inventarioPorTalla,
            tallaIds,
            false,
          );
          const inventarioNuevo = this.normalizeInventoryBySize(
            payload.inventarioPorTalla,
            tallaIds,
            true,
          );
          const actualMap = new Map(
            inventarioActual.map((item) => [item.tallaId, item.cantidad]),
          );
          const cambios: ReplaceProductSizeInventoryResult["cambios"] = [];

          for (const item of inventarioNuevo) {
            const cantidadAnterior = actualMap.get(item.tallaId) ?? 0;
            const cantidadNueva = item.cantidad;

            if (cantidadAnterior === cantidadNueva) {
              continue;
            }

            const movimientoRef = firestoreTienda
              .collection(MOVIMIENTOS_INVENTARIO_COLLECTION)
              .doc();
            const diferencia = cantidadNueva - cantidadAnterior;

            transaction.set(movimientoRef, {
              productoId,
              tallaId: item.tallaId,
              cantidadAnterior,
              cantidadNueva,
              diferencia,
              tipo: "ajuste",
              motivo: payload.motivo ?? "Ajuste masivo por talla",
              referencia: payload.referencia,
              usuarioId: payload.usuarioId,
              createdAt: now,
            });

            cambios.push({
              tallaId: item.tallaId,
              cantidadAnterior,
              cantidadNueva,
              diferencia,
              movimientoId: movimientoRef.id,
            });
          }

          const existencias = this.getDerivedExistencias(
            tallaIds,
            inventarioNuevo,
            data.existencias,
          );

          transaction.update(docRef, {
            tallaIds,
            inventarioPorTalla: inventarioNuevo,
            existencias,
            disponible: existencias > 0,
            updatedAt: now,
          });

          const stockMinimoGlobal = this.getNormalizedGlobalThreshold(
            data.stockMinimoGlobal,
          );
          const stockMinimoPorTalla = this.normalizeStockThresholdBySize(
            data.stockMinimoPorTalla,
          );
          const lowStockSnapshot = this.evaluateLowStock({
            id: productoId,
            clave: data.clave,
            descripcion: data.descripcion,
            lineaId: data.lineaId,
            categoriaId: data.categoriaId,
            existencias,
            tallaIds,
            stockMinimoGlobal,
            stockMinimoPorTalla,
            inventarioPorTalla: inventarioNuevo,
          });

          return {
            result: {
              productoId,
              tallaIds,
              inventarioPorTalla: inventarioNuevo,
              existencias,
              cambios,
            } as ReplaceProductSizeInventoryResult,
            lowStockActive: lowStockSnapshot.totalAlertas > 0,
            previousExistencias: this.getDerivedExistencias(
              tallaIds,
              inventarioActual,
              data.existencias,
            ),
          };
        },
      );

      if (txResult.lowStockActive) {
        const alert = await this.getLowStockAlertByProductId(productoId);
        if (alert) {
          await stockAlertService.notifyRealtime([alert]);
        }
      }

      const updatedProduct = await this.getProductById(productoId);
      if (updatedProduct) {
        await this.enqueueProductLifecycleEvents(
          {
            ...updatedProduct,
            existencias: txResult.previousExistencias ?? updatedProduct.existencias,
            precioPublico: updatedProduct.precioPublico,
          },
          updatedProduct,
          "product_replace_size_inventory",
        );
      }

      return txResult.result;
    } catch (error) {
      console.error(
        `❌ Error al reemplazar inventario por talla de producto ${productoId}:`,
        error,
      );
      throw new Error(
        error instanceof Error
          ? error.message
          : "Error al actualizar inventario por talla",
      );
    }
  }

  /**
   * Elimina un producto (soft delete - marca como inactivo)
   * @param id - ID del producto a eliminar
   * @returns Promise<void>
   */
  async deleteProduct(id: string): Promise<void> {
    try {
      const docRef = firestoreTienda.collection(PRODUCTOS_COLLECTION).doc(id);
      const doc = await docRef.get();

      if (!doc.exists) {
        throw new Error(`Producto con ID ${id} no encontrado`);
      }

      // Soft delete: marcar como inactivo
      const now = admin.firestore.Timestamp.now();
      await docRef.update({
        activo: false,
        updatedAt: now,
      });

      console.log(`Producto eliminado (inactivo): ID ${id}`);
    } catch (error) {
      console.error("Error al eliminar producto:", error);
      throw new Error(
        error instanceof Error
          ? error.message
          : "Error al eliminar el producto",
      );
    }
  }

  /**
   * Reduce el stock de un producto de manera atómica usando transacciones Firestore
   * REGLAS DE NEGOCIO (AGENTS.MD sección 9):
   * - Usa transacciones para atomicidad (evita race conditions)
   * - Valida que el producto exista
   * - Valida que haya stock suficiente
   * - Actualiza existencias y timestamp
   *
   * @param productoId - ID del producto
   * @param cantidad - Cantidad a reducir
   * @throws Error si:
   *   - El producto no existe
   *   - No hay stock suficiente
   *   - Error en la transacción
   */
  async decrementStock(productoId: string, cantidad: number): Promise<void> {
    const docRef = firestoreTienda
      .collection(PRODUCTOS_COLLECTION)
      .doc(productoId);

    try {
      await firestoreTienda.runTransaction(async (transaction) => {
        const doc = await transaction.get(docRef);

        if (!doc.exists) {
          throw new Error(
            `Producto con ID "${productoId}" no encontrado al reducir stock`,
          );
        }

        const producto = doc.data() as Producto;
        const existenciasActuales = producto.existencias || 0;

        if (existenciasActuales < cantidad) {
          throw new Error(
            `Stock insuficiente para el producto "${producto.descripcion}". ` +
              `Disponible: ${existenciasActuales}, Solicitado: ${cantidad}`,
          );
        }

        const nuevasExistencias = existenciasActuales - cantidad;

        transaction.update(docRef, {
          existencias: nuevasExistencias,
          disponible: nuevasExistencias > 0,
          updatedAt: admin.firestore.Timestamp.now(),
        });

        console.log(
          `✅ Stock reducido: ${producto.descripcion} | ${existenciasActuales} → ${nuevasExistencias}`,
        );
      });
    } catch (error) {
      console.error(
        `❌ Error al reducir stock de producto ${productoId}:`,
        error,
      );
      throw error;
    }
  }

  /**
   * Incrementa el stock de un producto de manera atómica usando transacciones Firestore
   * Usado para restaurar stock al cancelar órdenes
   * REGLAS DE NEGOCIO (AGENTS.MD sección 9):
   * - Usa transacciones para atomicidad
   * - Valida que el producto exista
   * - Actualiza existencias y timestamp
   *
   * @param productoId - ID del producto
   * @param cantidad - Cantidad a incrementar
   * @throws Error si:
   *   - El producto no existe
   *   - Error en la transacción
   */
  async incrementStock(productoId: string, cantidad: number): Promise<void> {
    const docRef = firestoreTienda
      .collection(PRODUCTOS_COLLECTION)
      .doc(productoId);

    try {
      await firestoreTienda.runTransaction(async (transaction) => {
        const doc = await transaction.get(docRef);

        if (!doc.exists) {
          throw new Error(
            `Producto con ID "${productoId}" no encontrado al incrementar stock`,
          );
        }

        const producto = doc.data() as Producto;
        const existenciasActuales = producto.existencias || 0;
        const nuevasExistencias = existenciasActuales + cantidad;

        transaction.update(docRef, {
          existencias: nuevasExistencias,
          disponible: nuevasExistencias > 0,
          updatedAt: admin.firestore.Timestamp.now(),
        });

        console.log(
          `✅ Stock restaurado: ${producto.descripcion} | ${existenciasActuales} → ${nuevasExistencias}`,
        );
      });
    } catch (error) {
      console.error(
        `❌ Error al incrementar stock de producto ${productoId}:`,
        error,
      );
      throw error;
    }
  }

  /**
   * Restaura el stock de múltiples productos a partir de items de una orden
   * Usado al cancelar órdenes para devolver productos al inventario
   * REGLAS DE NEGOCIO:
   * - Procesa items secuencialmente (Firestore no soporta transacciones paralelas)
   * - Si un producto falla, intenta restaurar los demás
   * - Loggea errores pero no detiene el proceso
   *
   * @param items - Array de items de la orden con productoId y cantidad
   * @returns Promise<void>
   */
  async restoreStockFromOrder(
    items: Array<{ productoId: string; cantidad: number }>,
  ): Promise<void> {
    console.log(`🔄 Restaurando stock para ${items.length} productos...`);

    const errores: string[] = [];

    for (const item of items) {
      try {
        await this.incrementStock(item.productoId, item.cantidad);
      } catch (error) {
        const mensaje = `Error al restaurar stock de ${item.productoId}: ${error instanceof Error ? error.message : "Error desconocido"}`;
        console.error(`⚠️ ${mensaje}`);
        errores.push(mensaje);
        // Continuar con los siguientes productos aunque uno falle
      }
    }

    if (errores.length > 0) {
      console.warn(
        `⚠️ Restauración de stock completada con ${errores.length} errores`,
      );
      // No lanzar error para evitar bloquear la cancelación
      // Los errores se loggean para auditoría
    } else {
      console.log(`✅ Stock restaurado exitosamente para todos los productos`);
    }
  }
}

// Exportar instancia única del servicio (Singleton)
export default new ProductService();
