/**
 * Acceso READ-ONLY a los datos reales de la tienda para el Asistente
 * Administrativo.
 *
 * Este repositorio nunca escribe. Proyecta los documentos de Firestore a
 * estructuras minimas (sin direcciones, telefonos, emails, datos de pago ni
 * identificadores personales) para que las tools puedan agregar informacion
 * sin exponer datos sensibles al modelo.
 */

import { Timestamp } from "firebase-admin/firestore";
import { firestoreTienda } from "../../../config/firebase";
import {
  EstadoOrden,
  FulfillmentMethod,
  MetodoPago,
  PaymentState,
} from "../../../models/orden.model";
import { ResolvedPeriod, toAnalyticsDayKey } from "./period.util";

const COLECCION_ORDENES = "ordenes";
const COLECCION_PRODUCTOS = "productos";
const COLECCION_CATEGORIAS = "categorias";
const COLECCION_LINEAS = "lineas";
const COLECCION_OFERTAS = "ofertas";
const COLECCION_CODIGOS = "codigos_promocion";

/** Tope defensivo: evita cargar periodos gigantes en memoria. */
export const MAX_ORDERS_SCANNED = 4000;
export const MAX_PRODUCTS_SCANNED = 2000;

export interface AnalyticsOrderItem {
  productoId: string;
  cantidad: number;
  precioUnitario: number;
  subtotal: number;
}

export interface AnalyticsOrder {
  id: string;
  createdAt: Date;
  dayKey: string;
  estado: string;
  paymentStatus: string | null;
  fulfillmentMethod: string | null;
  metodoPago: string | null;
  total: number;
  subtotal: number;
  shippingTotal: number;
  discountTotal: number;
  promoCode: string | null;
  promoCodeDiscount: number;
  /** Solo para conteo de clientes distintos; nunca se envia al modelo. */
  customerKey: string | null;
  items: AnalyticsOrderItem[];
}

export interface AnalyticsOrdersPage {
  orders: AnalyticsOrder[];
  /** true cuando se alcanzo MAX_ORDERS_SCANNED y el periodo quedo incompleto. */
  truncated: boolean;
}

export interface AnalyticsProduct {
  id: string;
  sku: string;
  name: string;
  categoriaId: string | null;
  lineaId: string | null;
  price: number;
  offerPrice: number | null;
  hasActiveOffer: boolean;
  active: boolean;
  availableStock: number;
  reservedStock: number;
  minStock: number;
  tracksSizes: boolean;
}

export interface AnalyticsCatalogEntry {
  id: string;
  name: string;
}

export interface AnalyticsOfferSummary {
  id: string;
  title: string;
  enabled: boolean;
  discountType: string;
  discountValue: number;
  scope: string;
  startsAt: string | null;
  endsAt: string | null;
  soldUnderOffer: number;
  offerStockLimit: number | null;
}

export interface AnalyticsPromoCodeSummary {
  id: string;
  code: string;
  title: string;
  enabled: boolean;
  discountValue: number;
  startsAt: string | null;
  endsAt: string | null;
  totalUses: number;
  maxUses: number | null;
  minPurchaseAmount: number | null;
}

const toNumber = (value: unknown, fallback = 0): number => {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const toDate = (value: unknown): Date | null => {
  if (value instanceof Timestamp) {
    return value.toDate();
  }

  if (value instanceof Date) {
    return value;
  }

  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  if (
    value &&
    typeof value === "object" &&
    typeof (value as { toDate?: unknown }).toDate === "function"
  ) {
    try {
      const parsed = (value as { toDate: () => Date }).toDate();
      return parsed instanceof Date && !Number.isNaN(parsed.getTime())
        ? parsed
        : null;
    } catch {
      return null;
    }
  }

  return null;
};

const toIsoDay = (value: unknown): string | null => {
  const date = toDate(value);
  return date ? toAnalyticsDayKey(date) : null;
};

const normalizeEnum = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed.toUpperCase() : null;
};

const mapOrderItems = (value: unknown): AnalyticsOrderItem[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((raw) => {
      const item = (raw || {}) as Record<string, unknown>;
      const productoId =
        typeof item.productoId === "string" ? item.productoId : "";

      if (!productoId) {
        return null;
      }

      const cantidad = Math.max(0, toNumber(item.cantidad));
      const precioUnitario = Math.max(0, toNumber(item.precioUnitario));

      return {
        productoId,
        cantidad,
        precioUnitario,
        subtotal: Math.max(
          0,
          toNumber(item.subtotal, cantidad * precioUnitario),
        ),
      } satisfies AnalyticsOrderItem;
    })
    .filter((item): item is AnalyticsOrderItem => item !== null);
};

const mapOrder = (
  id: string,
  data: Record<string, unknown>,
): AnalyticsOrder | null => {
  const createdAt = toDate(data.createdAt);
  if (!createdAt) {
    return null;
  }

  const subtotal = toNumber(data.subtotalFinal, toNumber(data.subtotal));
  const shippingTotal = toNumber(
    data.shippingTotal,
    toNumber(data.costoEnvio),
  );

  return {
    id,
    createdAt,
    dayKey: toAnalyticsDayKey(createdAt),
    estado: normalizeEnum(data.estado) || EstadoOrden.PENDIENTE,
    paymentStatus: normalizeEnum(data.paymentStatus),
    fulfillmentMethod: normalizeEnum(data.fulfillmentMethod),
    metodoPago: normalizeEnum(data.metodoPago),
    total: toNumber(data.total),
    subtotal,
    shippingTotal,
    discountTotal: toNumber(data.discountTotal),
    promoCode:
      typeof data.codigoPromocion === "string" && data.codigoPromocion.trim()
        ? data.codigoPromocion.trim().toUpperCase()
        : null,
    promoCodeDiscount: toNumber(data.descuentoCodigoPromocion),
    customerKey:
      typeof data.usuarioId === "string" && data.usuarioId.trim()
        ? data.usuarioId.trim()
        : null,
    items: mapOrderItems(data.items),
  };
};

const resolveAvailableStock = (
  data: Record<string, unknown>,
): { available: number; reserved: number; tracksSizes: boolean } => {
  const porTalla = Array.isArray(data.inventarioPorTalla)
    ? (data.inventarioPorTalla as Array<Record<string, unknown>>)
    : [];

  if (porTalla.length > 0) {
    return {
      available: porTalla.reduce(
        (acc, entry) => acc + Math.max(0, toNumber(entry?.cantidad)),
        0,
      ),
      reserved: porTalla.reduce(
        (acc, entry) => acc + Math.max(0, toNumber(entry?.reservada)),
        0,
      ),
      tracksSizes: true,
    };
  }

  const global = (data.inventarioGlobal || null) as Record<
    string,
    unknown
  > | null;

  if (global && global.disponible !== undefined) {
    return {
      available: Math.max(0, toNumber(global.disponible)),
      reserved: Math.max(0, toNumber(global.reservada)),
      tracksSizes: false,
    };
  }

  return {
    available: Math.max(0, toNumber(data.existencias)),
    reserved: 0,
    tracksSizes: false,
  };
};

const mapProduct = (
  id: string,
  data: Record<string, unknown>,
): AnalyticsProduct => {
  const stock = resolveAvailableStock(data);

  return {
    id,
    sku: typeof data.clave === "string" ? data.clave : id,
    name:
      typeof data.descripcion === "string" && data.descripcion.trim()
        ? data.descripcion.trim()
        : `Producto ${id}`,
    categoriaId:
      typeof data.categoriaId === "string" && data.categoriaId.trim()
        ? data.categoriaId
        : null,
    lineaId:
      typeof data.lineaId === "string" && data.lineaId.trim()
        ? data.lineaId
        : null,
    price: toNumber(data.precioPublico),
    offerPrice:
      data.precioOferta === null || data.precioOferta === undefined
        ? null
        : toNumber(data.precioOferta),
    hasActiveOffer: data.tieneOfertaActiva === true,
    active: data.activo !== false,
    availableStock: stock.available,
    reservedStock: stock.reserved,
    minStock: Math.max(0, toNumber(data.stockMinimoGlobal)),
    tracksSizes: stock.tracksSizes,
  };
};

class AnalyticsRepository {
  /**
   * Ordenes creadas dentro del periodo. Firestore filtra por `createdAt`
   * (Timestamp), igual que `orden.service.getAllOrdenes`.
   */
  async listOrdersInPeriod(period: ResolvedPeriod): Promise<AnalyticsOrdersPage> {
    const snapshot = await firestoreTienda
      .collection(COLECCION_ORDENES)
      .where("createdAt", ">=", Timestamp.fromDate(period.start))
      .where("createdAt", "<", Timestamp.fromDate(period.endExclusive))
      .orderBy("createdAt", "asc")
      .limit(MAX_ORDERS_SCANNED + 1)
      .get();

    const docs = snapshot.docs.slice(0, MAX_ORDERS_SCANNED);
    const orders = docs
      .map((doc) => mapOrder(doc.id, doc.data() as Record<string, unknown>))
      .filter((order): order is AnalyticsOrder => order !== null);

    return {
      orders,
      truncated: snapshot.size > MAX_ORDERS_SCANNED,
    };
  }

  /** Productos por id (batches de 30 por restriccion de `in`). */
  async getProductsByIds(
    productIds: string[],
  ): Promise<Map<string, AnalyticsProduct>> {
    const unique = Array.from(new Set(productIds.filter(Boolean)));
    const result = new Map<string, AnalyticsProduct>();

    if (unique.length === 0) {
      return result;
    }

    const collection = firestoreTienda.collection(COLECCION_PRODUCTOS);
    const refs = unique.map((id) => collection.doc(id));

    for (let index = 0; index < refs.length; index += 100) {
      const chunk = refs.slice(index, index + 100);
      const docs = await firestoreTienda.getAll(...chunk);

      for (const doc of docs) {
        if (doc.exists) {
          result.set(
            doc.id,
            mapProduct(doc.id, doc.data() as Record<string, unknown>),
          );
        }
      }
    }

    return result;
  }

  /** Catalogo completo de productos (usado por inventario). */
  async listProducts(options: { onlyActive?: boolean } = {}): Promise<{
    products: AnalyticsProduct[];
    truncated: boolean;
  }> {
    let query = firestoreTienda
      .collection(COLECCION_PRODUCTOS)
      .limit(MAX_PRODUCTS_SCANNED + 1);

    if (options.onlyActive) {
      query = firestoreTienda
        .collection(COLECCION_PRODUCTOS)
        .where("activo", "==", true)
        .limit(MAX_PRODUCTS_SCANNED + 1);
    }

    const snapshot = await query.get();
    const docs = snapshot.docs.slice(0, MAX_PRODUCTS_SCANNED);

    return {
      products: docs.map((doc) =>
        mapProduct(doc.id, doc.data() as Record<string, unknown>),
      ),
      truncated: snapshot.size > MAX_PRODUCTS_SCANNED,
    };
  }

  private async listCatalog(
    collectionName: string,
  ): Promise<Map<string, AnalyticsCatalogEntry>> {
    const snapshot = await firestoreTienda.collection(collectionName).get();
    const entries = new Map<string, AnalyticsCatalogEntry>();

    for (const doc of snapshot.docs) {
      const data = doc.data() as Record<string, unknown>;
      entries.set(doc.id, {
        id: doc.id,
        name:
          typeof data.nombre === "string" && data.nombre.trim()
            ? data.nombre.trim()
            : `Sin nombre (${doc.id})`,
      });
    }

    return entries;
  }

  async getCategories(): Promise<Map<string, AnalyticsCatalogEntry>> {
    return this.listCatalog(COLECCION_CATEGORIAS);
  }

  async getLines(): Promise<Map<string, AnalyticsCatalogEntry>> {
    return this.listCatalog(COLECCION_LINEAS);
  }

  async listOffers(): Promise<AnalyticsOfferSummary[]> {
    const snapshot = await firestoreTienda
      .collection(COLECCION_OFERTAS)
      .limit(200)
      .get();

    return snapshot.docs
      .filter((doc) => !(doc.data() as Record<string, unknown>).deletedAt)
      .map((doc) => {
        const data = doc.data() as Record<string, unknown>;
        return {
          id: doc.id,
          title:
            typeof data.titulo === "string" && data.titulo.trim()
              ? data.titulo.trim()
              : `Oferta ${doc.id}`,
          enabled: data.estado === true,
          discountType:
            typeof data.tipoDescuento === "string" ? data.tipoDescuento : "",
          discountValue: toNumber(data.valorDescuento),
          scope: typeof data.aplicaA === "string" ? data.aplicaA : "",
          startsAt: toIsoDay(data.fechaInicio),
          endsAt: toIsoDay(data.fechaFin),
          soldUnderOffer: toNumber(data.stockVendidoOferta),
          offerStockLimit:
            data.stockLimiteOferta === null ||
            data.stockLimiteOferta === undefined
              ? null
              : toNumber(data.stockLimiteOferta),
        } satisfies AnalyticsOfferSummary;
      });
  }

  async listPromoCodes(): Promise<AnalyticsPromoCodeSummary[]> {
    const snapshot = await firestoreTienda
      .collection(COLECCION_CODIGOS)
      .limit(200)
      .get();

    return snapshot.docs
      .filter((doc) => !(doc.data() as Record<string, unknown>).deletedAt)
      .map((doc) => {
        const data = doc.data() as Record<string, unknown>;
        return {
          id: doc.id,
          code:
            typeof data.codigo === "string"
              ? data.codigo.trim().toUpperCase()
              : doc.id,
          title:
            typeof data.titulo === "string" && data.titulo.trim()
              ? data.titulo.trim()
              : `Codigo ${doc.id}`,
          enabled: data.estado === true,
          discountValue: toNumber(data.valorDescuento),
          startsAt: toIsoDay(data.fechaInicio),
          endsAt: toIsoDay(data.fechaFin),
          totalUses: toNumber(data.usosActuales),
          maxUses:
            data.usoMaximoTotal === null || data.usoMaximoTotal === undefined
              ? null
              : toNumber(data.usoMaximoTotal),
          minPurchaseAmount:
            data.montoMinimoCompra === null ||
            data.montoMinimoCompra === undefined
              ? null
              : toNumber(data.montoMinimoCompra),
        } satisfies AnalyticsPromoCodeSummary;
      });
  }
}

export const analyticsRepository = new AnalyticsRepository();
export default analyticsRepository;

export const __testables = {
  mapOrder,
  mapProduct,
  resolveAvailableStock,
  toDate,
};

export const ANALYTICS_COLLECTIONS = {
  ordenes: COLECCION_ORDENES,
  productos: COLECCION_PRODUCTOS,
  categorias: COLECCION_CATEGORIAS,
  lineas: COLECCION_LINEAS,
  ofertas: COLECCION_OFERTAS,
  codigosPromocion: COLECCION_CODIGOS,
} as const;

export const ORDER_ENUMS = {
  EstadoOrden,
  PaymentState,
  FulfillmentMethod,
  MetodoPago,
} as const;
