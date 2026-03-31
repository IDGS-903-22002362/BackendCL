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
  AlertaStockProducto,
  AlertaStockTalla,
  ListarAlertasStockQuery,
} from "../models/inventario.model";
import {
  completeInventarioPorTalla,
  deriveExistenciasFromSizeInventory,
  normalizeTallaIds,
} from "../utils/size-inventory.util";
import stockAlertService from "./stock-alert.service";

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

export interface UpdateProductStockDTO {
  cantidadNueva: number;
  tallaId?: string;
  tipo?: "entrada" | "salida" | "ajuste" | "venta" | "devolucion";
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
      const docRef = await firestoreTienda
        .collection(PRODUCTOS_COLLECTION)
        .add({
          ...productoData,
          tallaIds,
          inventarioPorTalla,
          stockMinimoGlobal,
          stockMinimoPorTalla,
          existencias,
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
            inventarioPorTallaActualizado = tallaIdsProducto.map((id) => ({
              tallaId: id,
              cantidad: inventarioMap.get(id) ?? 0,
            }));

            existenciasActualizadas = this.getDerivedExistencias(
              tallaIdsProducto,
              inventarioPorTallaActualizado,
              data.existencias,
            );

            transaction.update(docRef, {
              inventarioPorTalla: inventarioPorTallaActualizado,
              tallaIds: tallaIdsProducto,
              existencias: existenciasActualizadas,
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

            transaction.update(docRef, {
              tallaIds: [],
              inventarioPorTalla: [],
              existencias: existenciasActualizadas,
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
