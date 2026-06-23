import {
  FieldValue,
  Timestamp,
} from "firebase-admin/firestore";

import type {
  DocumentData,
  DocumentSnapshot,
  Query,
  QueryDocumentSnapshot,
  Transaction,
} from "firebase-admin/firestore";

import { firestoreTienda } from "../config/firebase";

import {
  CalcularPrecioOfertaItemDto,
  CreateOfertaDto,
  FechaOfertaInput,
  Oferta,
  PrecioOfertaCalculado,
  ResultadoCalculoOfertas,
  UpdateOfertaDto,
} from "../models/ofertas.model";

import {
  calcularSubtotal,
  ProductoOfertaBase,
  seleccionarMejorOferta,
  esOfertaVigente,
} from "../utils/ofertas-pricing.util";
import { productOfferSnapshotService } from "./product-offer-snapshot.service";

const db = firestoreTienda;

interface ListarOfertasFiltros {
  estado?: boolean;
  aplicaA?: Oferta["aplicaA"];
  tipoDescuento?: Oferta["tipoDescuento"];
  productoId?: string;
  categoriaId?: string;
  lineaId?: string;
  tallaId?: string;
  q?: string;
  limit?: number;
}

type FechaFirestore = Date | Timestamp | string | number | null | undefined;

function toDate(value: FechaFirestore): Date {
  if (value instanceof Date) return value;

  if (value instanceof Timestamp) {
    return value.toDate();
  }

  if (typeof value === "string" || typeof value === "number") {
    const fecha = new Date(value);
    return Number.isNaN(fecha.getTime()) ? new Date(0) : fecha;
  }

  return new Date(0);
}

function toTimestamp(value: FechaOfertaInput, campo = "fecha"): Timestamp {
  const fecha = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(fecha.getTime())) {
    throw new Error(`${campo} no tiene un formato válido`);
  }

  return Timestamp.fromDate(fecha);
}

function toDateInput(value: FechaOfertaInput, campo = "fecha"): Date {
  const fecha = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(fecha.getTime())) {
    throw new Error(`${campo} no tiene un formato válido`);
  }

  return fecha;
}

function validarRangoFechasOferta(
  fechaInicio: FechaOfertaInput,
  fechaFin: FechaOfertaInput
): void {
  const inicio = toDateInput(fechaInicio, "fechaInicio");
  const fin = toDateInput(fechaFin, "fechaFin");

  if (fin.getTime() <= inicio.getTime()) {
    throw new Error("La fecha de fin debe ser posterior a la fecha de inicio");
  }
}

function stringArrayOrUndefined(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((item): item is string => typeof item === "string");
}

interface OfertaFirestoreData {
  titulo: string;
  descripcion?: string | null;

  estado: boolean;
  tallaIds?: string[];

  tipoDescuento: Oferta["tipoDescuento"];
  valorDescuento: number;

  aplicaA: Oferta["aplicaA"];

  productoIds?: string[];
  categoriaIds?: string[];
  lineaIds?: string[];

  fechaInicio: FechaFirestore;
  fechaFin: FechaFirestore;

  hastaAgotarExistencias: boolean;
  stockLimiteOferta?: number | null;
  stockVendidoOferta: number;

  prioridad: number;
  combinable: boolean;

  badgeTexto?: string | null;
  mostrarBadge: boolean;

  createdAt?: FechaFirestore;
  updatedAt?: FechaFirestore;
  deletedAt?: FechaFirestore;

  createdBy?: string | null;
  updatedBy?: string | null;
}

interface ProductoFirestoreData {
  activo?: boolean;

  precioPublico?: number;

  categoriaId?: string | null;
  categoriaIds?: string[];

  lineaId?: string | null;
  lineaIds?: string[];
}

export class OfertasService {
  private readonly ofertasCollection = db.collection("ofertas");
  private readonly productosCollection = db.collection("productos");

  async listarOfertas(filtros: ListarOfertasFiltros = {}): Promise<Oferta[]> {
    let query: Query<DocumentData> = this.ofertasCollection;

    if (typeof filtros.estado === "boolean") {
      query = query.where("estado", "==", filtros.estado);
    }

    if (filtros.aplicaA) {
      query = query.where("aplicaA", "==", filtros.aplicaA);
    }

    if (filtros.tipoDescuento) {
      query = query.where("tipoDescuento", "==", filtros.tipoDescuento);
    }

    if (filtros.productoId) {
      query = query.where("productoIds", "array-contains", filtros.productoId);
    }

    if (filtros.categoriaId) {
      query = query.where("categoriaIds", "array-contains", filtros.categoriaId);
    }

    if (filtros.lineaId) {
      query = query.where("lineaIds", "array-contains", filtros.lineaId);
    }

    query = query.limit(filtros.limit ?? 50);

    const snapshot = await query.get();

    let ofertas = snapshot.docs
      .map((doc) => this.mapOfertaDoc(doc))
      .filter((oferta) => !oferta.deletedAt);

    if (filtros.q) {
      const termino = filtros.q.toLowerCase();

      ofertas = ofertas.filter((oferta) =>
        oferta.titulo.toLowerCase().includes(termino)
      );
    }

    if (filtros.tallaId) {
      ofertas = ofertas.filter((oferta) => {
        const tallaIds = oferta.tallaIds ?? [];

        return tallaIds.length === 0 || tallaIds.includes(filtros.tallaId!);
      });
    }

    return ofertas.sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
    );
  }

  async listarOfertasActivas(): Promise<Oferta[]> {
    const ofertas = await this.listarOfertas({
      estado: true,
      limit: 100,
    });

    return ofertas.filter((oferta) => esOfertaVigente(oferta));
  }

  async obtenerOfertaPorId(id: string): Promise<Oferta | null> {
    const doc = await this.ofertasCollection.doc(id).get();

    if (!doc.exists) {
      return null;
    }

    const oferta = this.mapOfertaDoc(doc);

    if (oferta.deletedAt) {
      return null;
    }

    return oferta;
  }

  async crearOferta(
  data: CreateOfertaDto,
  userId?: string
): Promise<Oferta> {
  await this.validarTituloDisponible(data.titulo);

  await this.validarProductosActivosParaOferta(
    data.aplicaA,
    data.productoIds
  );

  validarRangoFechasOferta(data.fechaInicio, data.fechaFin);

  const docRef = await this.ofertasCollection.add({
      titulo: data.titulo,
      descripcion: data.descripcion ?? null,

      estado: typeof data.estado === "boolean" ? data.estado : true,
      tallaIds: data.tallaIds ?? [],

      tipoDescuento: data.tipoDescuento,
      valorDescuento: data.valorDescuento,

      aplicaA: data.aplicaA,

      productoIds: data.productoIds ?? [],
      categoriaIds: data.categoriaIds ?? [],
      lineaIds: data.lineaIds ?? [],

      fechaInicio: toTimestamp(data.fechaInicio, "fechaInicio"),
      fechaFin: toTimestamp(data.fechaFin, "fechaFin"),

      hastaAgotarExistencias: data.hastaAgotarExistencias ?? false,
      stockLimiteOferta: data.stockLimiteOferta ?? null,
      stockVendidoOferta: 0,

      prioridad: data.prioridad ?? 1,
      combinable: data.combinable ?? false,

      badgeTexto: data.badgeTexto ?? null,
      mostrarBadge: data.mostrarBadge ?? true,

      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      deletedAt: null,

      createdBy: userId ?? null,
      updatedBy: userId ?? null,
    });

    const oferta = await this.obtenerOfertaPorId(docRef.id);

    if (!oferta) {
      throw new Error("No se pudo crear la oferta");
    }

    await productOfferSnapshotService
      .syncProductsAffectedByOffer(oferta)
      .catch((error) => {
        console.error("Error sincronizando snapshot de oferta tras crear:", error);
      });

    return oferta;
  }

  async actualizarOferta(
    id: string,
    data: UpdateOfertaDto,
    userId?: string
  ): Promise<Oferta> {
    const ofertaActual = await this.obtenerOfertaPorId(id);

    if (!ofertaActual) {
      throw new Error("Oferta no encontrada");
    }

   if (data.titulo && data.titulo !== ofertaActual.titulo) {
  await this.validarTituloDisponible(data.titulo, id);
}

await this.validarProductosActivosParaOferta(
  data.aplicaA ?? ofertaActual.aplicaA,
  data.productoIds ?? ofertaActual.productoIds
);

const fechaInicioParaValidar = data.fechaInicio ?? ofertaActual.fechaInicio;
const fechaFinParaValidar = data.fechaFin ?? ofertaActual.fechaFin;

validarRangoFechasOferta(fechaInicioParaValidar, fechaFinParaValidar);

const payload: Record<string, unknown> = {
  ...data,
  updatedAt: FieldValue.serverTimestamp(),
  updatedBy: userId ?? null,
};

    if (data.fechaInicio) {
  payload.fechaInicio = toTimestamp(data.fechaInicio, "fechaInicio");
}

if (data.fechaFin) {
  payload.fechaFin = toTimestamp(data.fechaFin, "fechaFin");
}

    await this.ofertasCollection.doc(id).update(payload);

    const ofertaActualizada = await this.obtenerOfertaPorId(id);

    if (!ofertaActualizada) {
      throw new Error("No se pudo actualizar la oferta");
    }

    await productOfferSnapshotService
      .syncProductsAffectedByOffers(ofertaActualizada, ofertaActual)
      .catch((error) => {
        console.error(
          "Error sincronizando snapshot de oferta tras actualizar:",
          error,
        );
      });

    return ofertaActualizada;
  }

  async eliminarOferta(id: string, userId?: string): Promise<void> {
    const oferta = await this.obtenerOfertaPorId(id);

    if (!oferta) {
      throw new Error("Oferta no encontrada");
    }

    await this.ofertasCollection.doc(id).update({
      estado: false,
      deletedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: userId ?? null,
    });

    await productOfferSnapshotService
      .syncProductsAffectedByOffer(oferta)
      .catch((error) => {
        console.error("Error sincronizando snapshot de oferta tras eliminar:", error);
      });
  }

  async calcularPreciosCarrito(
    items: CalcularPrecioOfertaItemDto[]
  ): Promise<ResultadoCalculoOfertas> {
    const ofertasActivas = await this.listarOfertasActivas();

    const itemsCalculados: PrecioOfertaCalculado[] = [];

    for (const item of items) {
      const producto = await this.obtenerProductoBase(item.productoId);

      const mejorOferta = seleccionarMejorOferta(
        ofertasActivas,
        producto,
        item.tallaId
      );

      const precioFinal = mejorOferta?.precioFinal ?? producto.precioPublico;

      const subtotalOriginal = calcularSubtotal(
        producto.precioPublico,
        item.cantidad
      );

      const subtotalFinal = calcularSubtotal(precioFinal, item.cantidad);

      itemsCalculados.push({
        productoId: item.productoId,
        cantidad: item.cantidad,

        precioOriginal: producto.precioPublico,
        precioFinal,

        subtotalOriginal,
        subtotalFinal,

        ofertaAplicadaId: mejorOferta?.oferta.id ?? null,
        ofertaTitulo: mejorOferta?.oferta.titulo ?? null,
      });
    }

    const subtotalOriginal = calcularSubtotal(
      itemsCalculados.reduce((total, item) => total + item.subtotalOriginal, 0),
      1
    );

    const subtotalFinal = calcularSubtotal(
      itemsCalculados.reduce((total, item) => total + item.subtotalFinal, 0),
      1
    );

    return {
      items: itemsCalculados,
      subtotalOriginal,
      subtotalFinal,
      ahorroTotal: calcularSubtotal(subtotalOriginal - subtotalFinal, 1),
    };
  }

  async incrementarStockVendidoOferta(
    ofertaId: string,
    cantidad: number
  ): Promise<void> {
    if (cantidad <= 0) {
      throw new Error("La cantidad debe ser mayor a 0");
    }

    const docRef = this.ofertasCollection.doc(ofertaId);

    await db.runTransaction(async (transaction: Transaction) => {
      const snapshot = await transaction.get(docRef);

      if (!snapshot.exists) {
        throw new Error("Oferta no encontrada");
      }

      const oferta = this.mapOfertaDoc(snapshot);

      if (typeof oferta.stockLimiteOferta !== "number") {
  return;
}

const nuevoStockVendido = oferta.stockVendidoOferta + cantidad;

if (nuevoStockVendido > oferta.stockLimiteOferta) {
  throw new Error("La oferta ya no tiene stock disponible");
}

      transaction.update(docRef, {
        stockVendidoOferta: FieldValue.increment(cantidad),
        updatedAt: FieldValue.serverTimestamp(),
      });
    });
  }

  private async validarProductosActivosParaOferta(
  aplicaA: Oferta["aplicaA"],
  productoIds: string[] | undefined
): Promise<void> {
  if (aplicaA !== "productos") {
    return;
  }

  if (!Array.isArray(productoIds) || productoIds.length === 0) {
    return;
  }

  for (const productoId of productoIds) {
    const doc = await this.productosCollection.doc(productoId).get();

    if (!doc.exists) {
      throw new Error(`Producto no encontrado: ${productoId}`);
    }

    const data = doc.data() as ProductoFirestoreData;

    if (data.activo !== true) {
      throw new Error(`Producto no válido o inactivo: ${productoId}`);
    }

    if (typeof data.precioPublico !== "number") {
      throw new Error(`El producto ${productoId} no tiene precioPublico válido`);
    }
  }
}

  private async obtenerProductoBase(
    productoId: string
  ): Promise<ProductoOfertaBase> {
    const doc = await this.productosCollection.doc(productoId).get();

    if (!doc.exists) {
      throw new Error(`Producto no encontrado: ${productoId}`);
    }

    const data = doc.data() as ProductoFirestoreData;

if (data.activo !== true) {
  throw new Error(`Producto no válido o inactivo: ${productoId}`);
}

if (typeof data.precioPublico !== "number") {
  throw new Error(`El producto ${productoId} no tiene precioPublico válido`);
}

    return {
      id: doc.id,
      precioPublico: data.precioPublico,

      categoriaId: data.categoriaId ?? null,
      categoriaIds: stringArrayOrUndefined(data.categoriaIds),

      lineaId: data.lineaId ?? null,
      lineaIds: stringArrayOrUndefined(data.lineaIds),
    };
  }

  private async validarTituloDisponible(
    titulo: string,
    ofertaIdActual?: string
  ): Promise<void> {
    const snapshot = await this.ofertasCollection
      .where("titulo", "==", titulo)
      .limit(1)
      .get();

    if (snapshot.empty) {
      return;
    }

    const ofertaExistente = snapshot.docs[0];

    if (ofertaExistente.id === ofertaIdActual) {
      return;
    }

    throw new Error("Ya existe una oferta con ese título");
  }

  private mapOfertaDoc(
    doc: QueryDocumentSnapshot<DocumentData> | DocumentSnapshot<DocumentData>
  ): Oferta {
    const data = doc.data() as OfertaFirestoreData;

    return {
      id: doc.id,

      titulo: data.titulo,
      descripcion: data.descripcion ?? undefined,

      estado: data.estado,
      tallaIds: data.tallaIds ?? [],

      tipoDescuento: data.tipoDescuento,
      valorDescuento: data.valorDescuento,

      aplicaA: data.aplicaA,

      productoIds: stringArrayOrUndefined(data.productoIds),
      categoriaIds: stringArrayOrUndefined(data.categoriaIds),
      lineaIds: stringArrayOrUndefined(data.lineaIds),

      fechaInicio: toDate(data.fechaInicio),
      fechaFin: toDate(data.fechaFin),

      hastaAgotarExistencias: data.hastaAgotarExistencias,
      stockLimiteOferta: data.stockLimiteOferta ?? null,
      stockVendidoOferta: data.stockVendidoOferta ?? 0,

      prioridad: data.prioridad ?? 1,
      combinable: data.combinable ?? false,

      badgeTexto: data.badgeTexto ?? undefined,
      mostrarBadge: data.mostrarBadge ?? true,

      createdAt: toDate(data.createdAt),
      updatedAt: toDate(data.updatedAt),
      deletedAt: data.deletedAt ? toDate(data.deletedAt) : null,

      createdBy: data.createdBy ?? undefined,
      updatedBy: data.updatedBy ?? undefined,
    };
  }
}

export const ofertasService = new OfertasService();