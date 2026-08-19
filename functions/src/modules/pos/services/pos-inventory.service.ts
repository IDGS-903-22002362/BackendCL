/**
 * Inventario del POS.
 *
 * El POS no tiene inventario propio: escribe sobre `productos` y `movimientosInventario`, las
 * mismas fuentes de verdad del ecommerce, reutilizando las utilidades de proyección de
 * buckets (`inventory-stock.util`) para que la disponibilidad se calcule igual en los dos
 * canales.
 *
 * El descuento ocurre dentro de la transacción que confirma el pago: se relee la existencia,
 * se valida, se descuenta el bucket `fisica` y se registra el movimiento. Con tres unidades y
 * cuatro cajas compitiendo, solo tres transacciones pueden confirmar; la cuarta recibe
 * `INSUFFICIENT_STOCK` y no queda inventario negativo ni venta pagada sin descuento.
 *
 * Las ventas en borrador o suspendidas no reservan inventario (DEC-06): la reserva
 * (`reservada`) sigue siendo exclusiva del checkout ecommerce.
 */

import { TipoMovimientoInventario } from "../../../models/inventario.model";
import type { InventarioPorTallaExtended } from "../../../models/producto.model";
import {
  buildFirestoreInventoryPatch,
  computeDisponible,
  normalizeGlobalBuckets,
  projectLegacyFromProductData,
} from "../../../utils/inventory-stock.util";
import PosProblemError from "../errors/pos-problem.error";
import type { OperationalDate } from "../models/pos.types";
import {
  nowTimestamp,
  sharedCollection,
} from "../repositories/pos-firestore";

export interface PosProductSnapshot {
  productoId: string;
  clave: string;
  descripcion: string;
  precioPublicoMajor: number;
  activo: boolean;
  tallaIds: string[];
  personalizable: boolean;
  categoriaId?: string | null;
  lineaId?: string | null;
  raw: Record<string, unknown>;
}

export interface InventoryCommitLine {
  productoId: string;
  tallaId: string | null;
  quantity: number;
}

export interface InventoryMovementContext {
  saleId?: string | null;
  returnId?: string | null;
  registerId: string;
  shiftId: string;
  operationalDate: OperationalDate;
  actorUid: string;
  actorRole: string;
  idempotencyKey?: string | null;
  reason: string;
}

export interface InventoryCommitResult {
  productoId: string;
  tallaId: string | null;
  availableBefore: number;
  availableAfter: number;
  quantity: number;
}

function productRef(productoId: string): FirebaseFirestore.DocumentReference {
  return sharedCollection("PRODUCTS").doc(productoId);
}

const sizeCodeCache = new Map<string, string>();

export function clearPosSizeCache(): void {
  sizeCodeCache.clear();
}

export function toProductSnapshot(
  id: string,
  data: Record<string, unknown>,
): PosProductSnapshot {
  return {
    productoId: id,
    clave: String(data.clave ?? ""),
    descripcion: String(data.descripcion ?? ""),
    precioPublicoMajor: Number(data.precioPublico ?? 0),
    activo: data.activo !== false,
    tallaIds: Array.isArray(data.tallaIds)
      ? (data.tallaIds as unknown[]).map((value) => String(value))
      : [],
    personalizable: data.personalizable === true,
    categoriaId: (data.categoriaId as string | undefined) ?? null,
    lineaId: (data.lineaId as string | undefined) ?? null,
    raw: data,
  };
}

class PosInventoryService {
  /** Lectura por lote fuera de transacción, para repricing y validaciones previas. */
  async loadProducts(
    productoIds: readonly string[],
  ): Promise<Map<string, PosProductSnapshot>> {
    const unique = Array.from(new Set(productoIds));
    if (unique.length === 0) {
      return new Map();
    }
    const snapshots = await sharedCollection("PRODUCTS").firestore.getAll(
      ...unique.map((id) => productRef(id)),
    );
    const result = new Map<string, PosProductSnapshot>();
    for (const snapshot of snapshots) {
      if (!snapshot.exists) continue;
      result.set(
        snapshot.id,
        toProductSnapshot(
          snapshot.id,
          snapshot.data() as Record<string, unknown>,
        ),
      );
    }
    return result;
  }

  /**
   * Códigos legibles de talla para el snapshot de la venta y el ticket.
   * Cache corto en memoria: el catálogo de tallas es pequeño y casi estático.
   */
  async loadSizeCodes(
    tallaIds: readonly string[],
  ): Promise<Map<string, string>> {
    const pending = Array.from(
      new Set(tallaIds.filter((id) => id && !sizeCodeCache.has(id))),
    );
    if (pending.length > 0) {
      const snapshots = await sharedCollection("SIZES").firestore.getAll(
        ...pending.map((id) => sharedCollection("SIZES").doc(id)),
      );
      for (const snapshot of snapshots) {
        const data = snapshot.data() as Record<string, unknown> | undefined;
        sizeCodeCache.set(
          snapshot.id,
          snapshot.exists ? String(data?.codigo ?? snapshot.id) : snapshot.id,
        );
      }
    }
    const result = new Map<string, string>();
    for (const id of new Set(tallaIds)) {
      if (!id) continue;
      result.set(id, sizeCodeCache.get(id) ?? id);
    }
    return result;
  }

  /** Lectura dentro de una transacción abierta. Debe ocurrir antes de cualquier escritura. */
  async loadProductsInTransaction(
    transaction: FirebaseFirestore.Transaction,
    productoIds: readonly string[],
  ): Promise<Map<string, PosProductSnapshot>> {
    const unique = Array.from(new Set(productoIds));
    if (unique.length === 0) {
      return new Map();
    }
    const snapshots = await transaction.getAll(
      ...unique.map((id) => productRef(id)),
    );
    const result = new Map<string, PosProductSnapshot>();
    for (const snapshot of snapshots) {
      if (!snapshot.exists) {
        continue;
      }
      result.set(
        snapshot.id,
        toProductSnapshot(
          snapshot.id,
          snapshot.data() as Record<string, unknown>,
        ),
      );
    }
    return result;
  }

  availableFor(
    product: PosProductSnapshot,
    tallaId: string | null,
  ): number {
    const projection = projectLegacyFromProductData(product.raw);
    if (projection.tallaIds.length === 0) {
      return projection.existencias;
    }
    if (!tallaId) {
      return 0;
    }
    return (
      projection.inventarioPorTalla.find((row) => row.tallaId === tallaId)
        ?.cantidad ?? 0
    );
  }

  /**
   * Aplica el delta de inventario y crea el movimiento, todo dentro de la transacción.
   * `delta` negativo descuenta (venta) y positivo repone (devolución con reingreso físico).
   */
  applyDeltaInTransaction(input: {
    transaction: FirebaseFirestore.Transaction;
    product: PosProductSnapshot;
    tallaId: string | null;
    delta: number;
    tipo: TipoMovimientoInventario;
    context: InventoryMovementContext;
  }): InventoryCommitResult {
    const { transaction, product, tallaId, delta, tipo, context } = input;

    if (!Number.isInteger(delta) || delta === 0) {
      throw new PosProblemError(
        "POS_VALIDATION_ERROR",
        "El delta de inventario debe ser un entero distinto de cero.",
      );
    }

    const projection = projectLegacyFromProductData(product.raw);
    let availableBefore: number;
    let availableAfter: number;
    let patch: Record<string, unknown>;

    if (projection.tallaIds.length === 0) {
      const global = normalizeGlobalBuckets(
        product.raw,
        Number(product.raw.existencias ?? 0),
      );
      availableBefore = global.disponible;
      const nextFisica = global.fisica + delta;
      if (nextFisica < 0 || global.disponible + delta < 0) {
        throw new PosProblemError(
          "INSUFFICIENT_STOCK",
          `Existencias insuficientes para ${product.clave}.`,
        );
      }
      const nextGlobal = {
        ...global,
        fisica: nextFisica,
        disponible: computeDisponible(
          nextFisica,
          global.reservada,
          global.noDisponible,
        ),
      };
      availableAfter = nextGlobal.disponible;
      patch = buildFirestoreInventoryPatch({
        tallaIds: [],
        inventarioPorTalla: [],
        inventarioGlobal: nextGlobal,
      });
    } else {
      if (!tallaId) {
        throw new PosProblemError(
          "PRODUCT_UNAVAILABLE",
          `El producto ${product.clave} requiere talla.`,
        );
      }
      const rows = projection.inventarioPorTalla;
      const row = rows.find((entry) => entry.tallaId === tallaId);
      if (!row) {
        throw new PosProblemError(
          "PRODUCT_UNAVAILABLE",
          `La talla indicada no existe para ${product.clave}.`,
        );
      }
      availableBefore = row.cantidad;
      const fisica = Number(row.fisica ?? row.cantidad);
      const reservada = Number(row.reservada ?? 0);
      const noDisponible = Number(row.noDisponible ?? 0);
      const nextFisica = fisica + delta;
      const nextDisponible = computeDisponible(
        nextFisica,
        reservada,
        noDisponible,
      );
      if (nextFisica < 0 || availableBefore + delta < 0) {
        throw new PosProblemError(
          "INSUFFICIENT_STOCK",
          `Existencias insuficientes para ${product.clave} en la talla seleccionada.`,
        );
      }
      availableAfter = nextDisponible;

      const nextRows: InventarioPorTallaExtended[] = rows.map((entry) =>
        entry.tallaId === tallaId
          ? {
              ...entry,
              fisica: nextFisica,
              reservada,
              noDisponible,
              cantidad: nextDisponible,
            }
          : entry,
      );
      patch = buildFirestoreInventoryPatch({
        tallaIds: projection.tallaIds,
        inventarioPorTalla: nextRows,
      });
    }

    transaction.update(productRef(product.productoId), {
      ...patch,
      updatedAt: nowTimestamp(),
    });

    // Mismos nombres de campo que `product.service.updateStock` para que el historial de
    // inventario siga siendo homogéneo entre ecommerce y POS.
    transaction.create(sharedCollection("INVENTORY_MOVEMENTS").doc(), {
      productoId: product.productoId,
      tallaId: tallaId ?? null,
      cantidadAnterior: availableBefore,
      cantidadNueva: availableAfter,
      diferencia: availableAfter - availableBefore,
      tipo,
      motivo: context.reason,
      referencia: context.saleId ?? context.returnId ?? null,
      ventaPosId: context.saleId ?? null,
      usuarioId: context.actorUid,
      rolUsuario: context.actorRole,
      origen: "pos",
      idempotencyKey: context.idempotencyKey ?? null,
      posRegisterId: context.registerId,
      posShiftId: context.shiftId,
      operationalDate: context.operationalDate,
      createdAt: nowTimestamp(),
    });

    return {
      productoId: product.productoId,
      tallaId,
      availableBefore,
      availableAfter,
      quantity: Math.abs(delta),
    };
  }

  /** Descuento por venta confirmada. */
  commitSaleLinesInTransaction(
    transaction: FirebaseFirestore.Transaction,
    products: Map<string, PosProductSnapshot>,
    lines: readonly InventoryCommitLine[],
    context: InventoryMovementContext,
  ): InventoryCommitResult[] {
    // Se agrupan las líneas repetidas del mismo producto y talla: dos líneas de la misma
    // variante deben validarse contra la existencia total, no cada una por separado.
    const grouped = new Map<string, InventoryCommitLine>();
    for (const line of lines) {
      const key = `${line.productoId}::${line.tallaId ?? ""}`;
      const existing = grouped.get(key);
      grouped.set(
        key,
        existing
          ? { ...existing, quantity: existing.quantity + line.quantity }
          : { ...line },
      );
    }

    const results: InventoryCommitResult[] = [];
    for (const line of grouped.values()) {
      const product = products.get(line.productoId);
      if (!product) {
        throw new PosProblemError(
          "PRODUCT_UNAVAILABLE",
          "Un producto de la venta ya no existe en el catálogo.",
        );
      }
      results.push(
        this.applyDeltaInTransaction({
          transaction,
          product,
          tallaId: line.tallaId,
          delta: -line.quantity,
          tipo: TipoMovimientoInventario.VENTA,
          context,
        }),
      );
    }
    return results;
  }

  /** Reingreso por devolución con mercancía apta para reventa. */
  restockLinesInTransaction(
    transaction: FirebaseFirestore.Transaction,
    products: Map<string, PosProductSnapshot>,
    lines: readonly InventoryCommitLine[],
    context: InventoryMovementContext,
  ): InventoryCommitResult[] {
    const results: InventoryCommitResult[] = [];
    for (const line of lines) {
      const product = products.get(line.productoId);
      if (!product) {
        throw new PosProblemError(
          "PRODUCT_UNAVAILABLE",
          "El producto de la devolución ya no existe en el catálogo.",
        );
      }
      results.push(
        this.applyDeltaInTransaction({
          transaction,
          product,
          tallaId: line.tallaId,
          delta: line.quantity,
          tipo: TipoMovimientoInventario.DEVOLUCION,
          context,
        }),
      );
    }
    return results;
  }
}

export const posInventoryService = new PosInventoryService();
export default posInventoryService;
