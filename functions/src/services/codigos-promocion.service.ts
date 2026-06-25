import { FieldValue, Timestamp } from "firebase-admin/firestore";

import { firestoreTienda } from "../config/firebase";
import type {
  CodigoPromocion,
  CodigoPromocionFilters,
  CreateCodigoPromocionDto,
  ResultadoValidacionCodigoPromocion,
  UpdateCodigoPromocionDto,
  ValidarCodigoPromocionDto,
} from "../models/codigos-promocion.model";
import {
  calcularPreciosConCodigoPromocion,
  calcularSubtotalOriginalItems,
  construirItemsSinDescuento,
  normalizarCodigoPromocion,
  puedeEliminarCodigoPromocion,
  toDateValue,
} from "../utils/codigos-promocion-pricing.util";

const CODIGOS_PROMOCION_COLLECTION = "codigos_promocion";
const CODIGO_PROMOCION_USOS_COLLECTION = "codigoPromocionUsos";
const PRODUCTOS_COLLECTION = "productos";

type FirestoreData = FirebaseFirestore.DocumentData;

function collectionRef() {
  return firestoreTienda.collection(CODIGOS_PROMOCION_COLLECTION);
}

function toDateOrThrow(value: string | Date, fieldName: string): Date {
  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new Error(`${fieldName} no es una fecha válida.`);
  }

  return date;
}

function normalizeNullableString(value: unknown): string | null {
  if (typeof value !== "string") return null;

  const trimmed = value.trim();

  return trimmed.length > 0 ? trimmed : null;
}

function normalizeNumberOrNull(value: unknown): number | null {
  if (typeof value !== "number") return null;
  if (!Number.isFinite(value)) return null;

  return value;
}

function normalizeArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

function dateToTimestamp(value: string | Date): Timestamp {
  return Timestamp.fromDate(toDateOrThrow(value, "Fecha"));
}

function fromFirestoreDate(value: unknown): Date {
  const date = toDateValue(value);

  return date ?? new Date(0);
}

function mapCodigoPromocionDoc(
  doc: FirebaseFirestore.DocumentSnapshot<FirestoreData>,
): CodigoPromocion {
  const data = doc.data() ?? {};

  return {
    id: doc.id,

    codigo:
      typeof data.codigo === "string"
        ? normalizarCodigoPromocion(data.codigo)
        : "",

    titulo: typeof data.titulo === "string" ? data.titulo : "",

    descripcion: normalizeNullableString(data.descripcion),

    estado: typeof data.estado === "boolean" ? data.estado : true,

    tipoDescuento: "porcentaje",

    valorDescuento:
      typeof data.valorDescuento === "number" ? data.valorDescuento : 0,

    aplicaA:
      data.aplicaA === "productos" ||
      data.aplicaA === "categorias" ||
      data.aplicaA === "lineas"
        ? data.aplicaA
        : "productos",

    productoIds: normalizeArray(data.productoIds),
    categoriaIds: normalizeArray(data.categoriaIds),
    lineaIds: normalizeArray(data.lineaIds),
    tallaIds: normalizeArray(data.tallaIds),

    fechaInicio: fromFirestoreDate(data.fechaInicio),
    fechaFin: fromFirestoreDate(data.fechaFin),

    hastaAgotarExistencias:
      typeof data.hastaAgotarExistencias === "boolean"
        ? data.hastaAgotarExistencias
        : true,

    stockLimiteCodigo: normalizeNumberOrNull(data.stockLimiteCodigo),

    stockUsadoCodigo:
      typeof data.stockUsadoCodigo === "number" ? data.stockUsadoCodigo : 0,

    usoMaximoTotal: normalizeNumberOrNull(data.usoMaximoTotal),

    usosActuales:
      typeof data.usosActuales === "number" ? data.usosActuales : 0,

    usoMaximoPorUsuario: normalizeNumberOrNull(data.usoMaximoPorUsuario),

    montoMinimoCompra: normalizeNumberOrNull(data.montoMinimoCompra),

    acumulableConOfertas:
      typeof data.acumulableConOfertas === "boolean"
        ? data.acumulableConOfertas
        : false,

    createdAt: fromFirestoreDate(data.createdAt),
    updatedAt: fromFirestoreDate(data.updatedAt),
    deletedAt: data.deletedAt ? fromFirestoreDate(data.deletedAt) : null,

    createdBy: normalizeNullableString(data.createdBy),
    updatedBy: normalizeNullableString(data.updatedBy),
  };
}

function buildCreateData(
  dto: CreateCodigoPromocionDto,
  userId?: string | null,
): FirestoreData {
  const fechaInicio = toDateOrThrow(dto.fechaInicio, "fechaInicio");
  const fechaFin = toDateOrThrow(dto.fechaFin, "fechaFin");

  if (fechaFin <= fechaInicio) {
    throw new Error("La fecha de fin debe ser posterior a la fecha de inicio.");
  }

  const hastaAgotarExistencias = dto.hastaAgotarExistencias ?? true;

  return {
    codigo: normalizarCodigoPromocion(dto.codigo),
    titulo: dto.titulo.trim(),
    descripcion: dto.descripcion?.trim() || null,

    estado: dto.estado ?? true,

    tipoDescuento: "porcentaje",
    valorDescuento: dto.valorDescuento,

    aplicaA: dto.aplicaA,
    productoIds: dto.aplicaA === "productos" ? dto.productoIds ?? [] : [],
    categoriaIds: dto.aplicaA === "categorias" ? dto.categoriaIds ?? [] : [],
    lineaIds: dto.aplicaA === "lineas" ? dto.lineaIds ?? [] : [],
    tallaIds: dto.tallaIds ?? [],

    fechaInicio: Timestamp.fromDate(fechaInicio),
    fechaFin: Timestamp.fromDate(fechaFin),

    hastaAgotarExistencias,
    stockLimiteCodigo: hastaAgotarExistencias
      ? null
      : dto.stockLimiteCodigo ?? null,
    stockUsadoCodigo: 0,

    usoMaximoTotal: dto.usoMaximoTotal ?? null,
    usosActuales: 0,

    usoMaximoPorUsuario: dto.usoMaximoPorUsuario ?? null,
    montoMinimoCompra: dto.montoMinimoCompra ?? null,

    acumulableConOfertas: dto.acumulableConOfertas ?? false,

    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    deletedAt: null,

    createdBy: userId ?? null,
    updatedBy: userId ?? null,
  };
}

function buildUpdateData(
  dto: UpdateCodigoPromocionDto,
  current: CodigoPromocion,
  userId?: string | null,
): FirestoreData {
  const nextAplicaA = dto.aplicaA ?? current.aplicaA;
  const nextHastaAgotarExistencias =
    dto.hastaAgotarExistencias ?? current.hastaAgotarExistencias;

  const updateData: FirestoreData = {
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: userId ?? null,
  };

  if (dto.codigo !== undefined) {
    updateData.codigo = normalizarCodigoPromocion(dto.codigo);
  }

  if (dto.titulo !== undefined) {
    updateData.titulo = dto.titulo.trim();
  }

  if (dto.descripcion !== undefined) {
    updateData.descripcion = dto.descripcion?.trim() || null;
  }

  if (dto.estado !== undefined) {
    updateData.estado = dto.estado;
  }

  if (dto.valorDescuento !== undefined) {
    updateData.valorDescuento = dto.valorDescuento;
  }

  if (dto.aplicaA !== undefined) {
    updateData.aplicaA = dto.aplicaA;
  }

  if (dto.productoIds !== undefined || dto.aplicaA !== undefined) {
    updateData.productoIds =
      nextAplicaA === "productos" ? dto.productoIds ?? current.productoIds : [];
  }

  if (dto.categoriaIds !== undefined || dto.aplicaA !== undefined) {
    updateData.categoriaIds =
      nextAplicaA === "categorias"
        ? dto.categoriaIds ?? current.categoriaIds
        : [];
  }

  if (dto.lineaIds !== undefined || dto.aplicaA !== undefined) {
    updateData.lineaIds =
      nextAplicaA === "lineas" ? dto.lineaIds ?? current.lineaIds : [];
  }

  if (dto.tallaIds !== undefined) {
    updateData.tallaIds = dto.tallaIds;
  }

  if (dto.fechaInicio !== undefined) {
    updateData.fechaInicio = dateToTimestamp(dto.fechaInicio);
  }

  if (dto.fechaFin !== undefined) {
    updateData.fechaFin = dateToTimestamp(dto.fechaFin);
  }

  if (
    dto.fechaInicio !== undefined ||
    dto.fechaFin !== undefined
  ) {
    const fechaInicio =
      dto.fechaInicio !== undefined
        ? toDateOrThrow(dto.fechaInicio, "fechaInicio")
        : current.fechaInicio;

    const fechaFin =
      dto.fechaFin !== undefined
        ? toDateOrThrow(dto.fechaFin, "fechaFin")
        : current.fechaFin;

    if (fechaFin <= fechaInicio) {
      throw new Error(
        "La fecha de fin debe ser posterior a la fecha de inicio.",
      );
    }
  }

  if (dto.hastaAgotarExistencias !== undefined) {
    updateData.hastaAgotarExistencias = dto.hastaAgotarExistencias;
  }

  if (
    dto.stockLimiteCodigo !== undefined ||
    dto.hastaAgotarExistencias !== undefined
  ) {
    updateData.stockLimiteCodigo = nextHastaAgotarExistencias
      ? null
      : dto.stockLimiteCodigo ?? current.stockLimiteCodigo;
  }

  if (dto.usoMaximoTotal !== undefined) {
    updateData.usoMaximoTotal = dto.usoMaximoTotal;
  }

  if (dto.usoMaximoPorUsuario !== undefined) {
    updateData.usoMaximoPorUsuario = dto.usoMaximoPorUsuario;
  }

  if (dto.montoMinimoCompra !== undefined) {
    updateData.montoMinimoCompra = dto.montoMinimoCompra;
  }

  if (dto.acumulableConOfertas !== undefined) {
    updateData.acumulableConOfertas = dto.acumulableConOfertas;
  }

  return updateData;
}

function codigoMatchesFilters(
  codigoPromocion: CodigoPromocion,
  filters: CodigoPromocionFilters,
): boolean {
  if (!filters.incluirEliminados && codigoPromocion.deletedAt) {
    return false;
  }

  if (
    filters.estado !== undefined &&
    codigoPromocion.estado !== filters.estado
  ) {
    return false;
  }

  if (filters.codigo) {
    const codigoFiltro = normalizarCodigoPromocion(filters.codigo);

    if (!codigoPromocion.codigo.includes(codigoFiltro)) {
      return false;
    }
  }

  if (filters.aplicaA && codigoPromocion.aplicaA !== filters.aplicaA) {
    return false;
  }

  if (
    filters.productoId &&
    !codigoPromocion.productoIds.includes(filters.productoId)
  ) {
    return false;
  }

  if (
    filters.categoriaId &&
    !codigoPromocion.categoriaIds.includes(filters.categoriaId)
  ) {
    return false;
  }

  if (filters.lineaId && !codigoPromocion.lineaIds.includes(filters.lineaId)) {
    return false;
  }

  return true;
}

function collectStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => entry.trim())
      .filter(Boolean);
  }

  if (typeof value === "string" && value.trim()) {
    return [value.trim()];
  }

  return [];
}

async function enrichCartItemsForCodigoPromocion(
  items: ValidarCodigoPromocionDto["items"],
): Promise<ValidarCodigoPromocionDto["items"]> {
  return Promise.all(
    items.map(async (item) => {
      const categoriaIds = new Set<string>([
        ...collectStringArray(item.categoriaId),
        ...collectStringArray(item.categoriaIds),
      ]);
      const lineaIds = new Set<string>([
        ...collectStringArray(item.lineaId),
        ...collectStringArray(item.lineaIds),
      ]);

      const productoDoc = await firestoreTienda
        .collection(PRODUCTOS_COLLECTION)
        .doc(item.productoId)
        .get();

      if (productoDoc.exists) {
        const producto = productoDoc.data() ?? {};

        for (const categoriaId of [
          ...collectStringArray(producto.categoriaIds),
          ...collectStringArray(producto.categoriasIds),
          ...collectStringArray(producto.categoryIds),
          ...collectStringArray(producto.categoriaId),
        ]) {
          categoriaIds.add(categoriaId);
        }

        for (const lineaId of [
          ...collectStringArray(producto.lineaIds),
          ...collectStringArray(producto.lineasIds),
          ...collectStringArray(producto.lineIds),
          ...collectStringArray(producto.lineaId),
        ]) {
          lineaIds.add(lineaId);
        }
      }

      return {
        ...item,
        ...(categoriaIds.size > 0
          ? { categoriaIds: [...categoriaIds] }
          : {}),
        ...(lineaIds.size > 0 ? { lineaIds: [...lineaIds] } : {}),
      };
    }),
  );
}

async function assertCodigoDisponible(
  codigo: string,
  currentId?: string,
): Promise<void> {
  const normalizedCode = normalizarCodigoPromocion(codigo);

  const snapshot = await collectionRef()
    .where("codigo", "==", normalizedCode)
    .limit(10)
    .get();

  const alreadyExists = snapshot.docs.some((doc) => {
    if (doc.id === currentId) return false;

    const data = doc.data();

    return !data.deletedAt;
  });

  if (alreadyExists) {
    throw new Error(`El código "${normalizedCode}" ya existe.`);
  }
}

export const codigosPromocionService = {
  async listar(
    filters: CodigoPromocionFilters = {},
  ): Promise<CodigoPromocion[]> {
    const snapshot = await collectionRef().orderBy("createdAt", "desc").get();

    return snapshot.docs
      .map((doc) => mapCodigoPromocionDoc(doc))
      .filter((codigoPromocion) =>
        codigoMatchesFilters(codigoPromocion, filters),
      );
  },

  async obtenerPorId(id: string): Promise<CodigoPromocion | null> {
    const doc = await collectionRef().doc(id).get();

    if (!doc.exists) return null;

    const codigoPromocion = mapCodigoPromocionDoc(doc);

    if (codigoPromocion.deletedAt) return null;

    return codigoPromocion;
  },

  async obtenerPorCodigo(codigo: string): Promise<CodigoPromocion | null> {
    const normalizedCode = normalizarCodigoPromocion(codigo);

    const snapshot = await collectionRef()
      .where("codigo", "==", normalizedCode)
      .limit(1)
      .get();

    if (snapshot.empty) return null;

    const codigoPromocion = mapCodigoPromocionDoc(snapshot.docs[0]);

    if (codigoPromocion.deletedAt) return null;

    return codigoPromocion;
  },

  async crear(
    dto: CreateCodigoPromocionDto,
    userId?: string | null,
  ): Promise<CodigoPromocion> {
    await assertCodigoDisponible(dto.codigo);

    const docRef = collectionRef().doc();
    const data = buildCreateData(dto, userId);

    await docRef.set(data);

    const createdDoc = await docRef.get();

    return mapCodigoPromocionDoc(createdDoc);
  },

  async actualizar(
    id: string,
    dto: UpdateCodigoPromocionDto,
    userId?: string | null,
  ): Promise<CodigoPromocion | null> {
    const docRef = collectionRef().doc(id);
    const doc = await docRef.get();

    if (!doc.exists) return null;

    const current = mapCodigoPromocionDoc(doc);

    if (current.deletedAt) return null;

    if (dto.codigo !== undefined) {
      await assertCodigoDisponible(dto.codigo, id);
    }

    const updateData = buildUpdateData(dto, current, userId);

    await docRef.update(updateData);

    const updatedDoc = await docRef.get();

    return mapCodigoPromocionDoc(updatedDoc);
  },

  async eliminar(id: string, _userId?: string | null): Promise<boolean> {
    const docRef = collectionRef().doc(id);
    const doc = await docRef.get();

    if (!doc.exists) return false;

    const codigoPromocion = mapCodigoPromocionDoc(doc);

    if (!puedeEliminarCodigoPromocion(codigoPromocion)) {
      throw new Error(
        "No se puede eliminar un código promocional activo o programado. Desactívalo o espera a que venza.",
      );
    }

    await docRef.delete();

    return true;
  },

  async consultarDisponibilidadCarrito(
  dto: Pick<ValidarCodigoPromocionDto, "items">,
): Promise<{ disponible: boolean }> {
  if (!Array.isArray(dto.items) || dto.items.length === 0) {
    return {
      disponible: false,
    };
  }

  const items = await enrichCartItemsForCodigoPromocion(dto.items);
  const subtotalOriginal = calcularSubtotalOriginalItems(items);

  if (!Number.isFinite(subtotalOriginal) || subtotalOriginal <= 0) {
    return {
      disponible: false,
    };
  }

  const ahora = new Date();

  const snapshot = await collectionRef()
    .where("estado", "==", true)
    .get();

  for (const doc of snapshot.docs) {
    const codigoPromocion = mapCodigoPromocionDoc(doc);

    if (codigoPromocion.deletedAt || !codigoPromocion.estado) {
      continue;
    }

    if (
      ahora < codigoPromocion.fechaInicio ||
      ahora > codigoPromocion.fechaFin
    ) {
      continue;
    }

    if (
      typeof codigoPromocion.usoMaximoTotal === "number" &&
      codigoPromocion.usoMaximoTotal > 0 &&
      codigoPromocion.usosActuales >= codigoPromocion.usoMaximoTotal
    ) {
      continue;
    }

    if (
      !codigoPromocion.hastaAgotarExistencias &&
      typeof codigoPromocion.stockLimiteCodigo === "number" &&
      codigoPromocion.stockLimiteCodigo > 0 &&
      codigoPromocion.stockUsadoCodigo >=
        codigoPromocion.stockLimiteCodigo
    ) {
      continue;
    }

    if (
      typeof codigoPromocion.montoMinimoCompra === "number" &&
      codigoPromocion.montoMinimoCompra > 0 &&
      subtotalOriginal < codigoPromocion.montoMinimoCompra
    ) {
      continue;
    }

    const resultado = calcularPreciosConCodigoPromocion(
      codigoPromocion,
      items,
    );

    const descuentoTotal = Number(resultado.descuentoTotal || 0);

    if (
      resultado.valido !== false &&
      Number.isFinite(descuentoTotal) &&
      descuentoTotal > 0
    ) {
      return {
        disponible: true,
      };
    }
  }

  return {
    disponible: false,
  };
},

  async validar(
    dto: ValidarCodigoPromocionDto,
  ): Promise<ResultadoValidacionCodigoPromocion> {
    const normalizedCode = normalizarCodigoPromocion(dto.codigo);
    const items = await enrichCartItemsForCodigoPromocion(dto.items);

    const codigoPromocion = await this.obtenerPorCodigo(normalizedCode);

    if (!codigoPromocion) {
      const subtotalOriginal = calcularSubtotalOriginalItems(items);

      return {
        valido: false,
        codigo: normalizedCode,
        mensaje: "El código promocional no existe o no está disponible.",
        codigoPromocionId: null,
        codigoTitulo: null,
        subtotalOriginal,
        subtotalFinal: subtotalOriginal,
        descuentoTotal: 0,
        items: construirItemsSinDescuento(items),
      };
    }

    if (
      typeof codigoPromocion.montoMinimoCompra === "number" &&
      codigoPromocion.montoMinimoCompra > 0
    ) {
      const subtotalOriginal = calcularSubtotalOriginalItems(items);

      if (subtotalOriginal < codigoPromocion.montoMinimoCompra) {
        return {
          valido: false,
          codigo: normalizedCode,
          mensaje: `El código requiere una compra mínima de $${codigoPromocion.montoMinimoCompra.toFixed(
            2,
          )}.`,
          codigoPromocionId: codigoPromocion.id,
          codigoTitulo: codigoPromocion.titulo,
          subtotalOriginal,
          subtotalFinal: subtotalOriginal,
          descuentoTotal: 0,
          items: construirItemsSinDescuento(items),
        };
      }
    }

    return calcularPreciosConCodigoPromocion(codigoPromocion, items);
  },

  async registrarUso(
    codigoPromocionId: string,
    cantidadUsada = 1,
  ): Promise<void> {
    const cantidad = Math.max(1, Math.floor(cantidadUsada));
    const codigoRef = collectionRef().doc(codigoPromocionId);

    await firestoreTienda.runTransaction(async (transaction) => {
      const codigoSnap = await transaction.get(codigoRef);
      if (!codigoSnap.exists) {
        throw new Error(
          `Código promocional con ID ${codigoPromocionId} no encontrado`,
        );
      }

      const codigo = mapCodigoPromocionDoc(codigoSnap);
      const usosActuales = codigo.usosActuales ?? 0;
      const stockUsado = codigo.stockUsadoCodigo ?? 0;

      if (
        typeof codigo.usoMaximoTotal === "number" &&
        usosActuales >= codigo.usoMaximoTotal
      ) {
        throw new Error("El código promocional alcanzó su límite de usos");
      }

      if (
        !codigo.hastaAgotarExistencias &&
        typeof codigo.stockLimiteCodigo === "number" &&
        stockUsado + cantidad > codigo.stockLimiteCodigo
      ) {
        throw new Error("El código promocional alcanzó su stock disponible");
      }

      transaction.update(codigoRef, {
        usosActuales: FieldValue.increment(1),
        stockUsadoCodigo: FieldValue.increment(cantidad),
        updatedAt: FieldValue.serverTimestamp(),
      });
    });
  },

  /**
   * Registra el uso de un código promocional al confirmar pago.
   * Idempotente por ordenId + codigoPromocionId.
   */
  async registrarUsoOrden(input: {
    ordenId: string;
    codigoPromocionId: string;
    cantidadUsada?: number;
  }): Promise<void> {
    const cantidadUsada = Math.max(1, Math.floor(input.cantidadUsada ?? 1));
    const codigoRef = collectionRef().doc(input.codigoPromocionId);
    const usoRef = firestoreTienda
      .collection(CODIGO_PROMOCION_USOS_COLLECTION)
      .doc(`${input.ordenId}_${input.codigoPromocionId}`);

    await firestoreTienda.runTransaction(async (transaction) => {
      const [usoSnap, codigoSnap] = await Promise.all([
        transaction.get(usoRef),
        transaction.get(codigoRef),
      ]);

      if (usoSnap.exists) {
        return;
      }

      if (!codigoSnap.exists) {
        throw new Error(
          `Código promocional con ID ${input.codigoPromocionId} no encontrado`,
        );
      }

      const codigo = mapCodigoPromocionDoc(codigoSnap);
      const usosActuales = codigo.usosActuales ?? 0;
      const stockUsado = codigo.stockUsadoCodigo ?? 0;

      if (
        typeof codigo.usoMaximoTotal === "number" &&
        usosActuales >= codigo.usoMaximoTotal
      ) {
        throw new Error("El código promocional alcanzó su límite de usos");
      }

      if (
        !codigo.hastaAgotarExistencias &&
        typeof codigo.stockLimiteCodigo === "number" &&
        stockUsado + cantidadUsada > codigo.stockLimiteCodigo
      ) {
        throw new Error("El código promocional alcanzó su stock disponible");
      }

      transaction.update(codigoRef, {
        usosActuales: FieldValue.increment(1),
        stockUsadoCodigo: FieldValue.increment(cantidadUsada),
        updatedAt: FieldValue.serverTimestamp(),
      });

      transaction.set(usoRef, {
        ordenId: input.ordenId,
        codigoPromocionId: input.codigoPromocionId,
        cantidadUsada,
        createdAt: FieldValue.serverTimestamp(),
      });
    });
  },
};