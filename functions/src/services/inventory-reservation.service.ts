import { firestoreTienda } from "../config/firebase";
import { admin } from "../config/firebase.admin";
import { INVENTORY_RESERVATION_TTL_MINUTES } from "../config/inventory.config";
import {
  EstadoReservaInventario,
  ReservaInventario,
  TipoMovimientoInventario,
} from "../models/inventario.model";
import { Orden } from "../models/orden.model";
import { InventarioPorTallaExtended } from "../models/producto.model";
import {
  buildFirestoreInventoryPatch,
  computeDisponible,
  getAvailableForVariant,
  normalizeGlobalBuckets,
  normalizeSizeBuckets,
  projectLegacyFromProductData,
} from "../utils/inventory-stock.util";
import { normalizeTallaIds } from "../utils/size-inventory.util";
import inventoryService from "./inventory.service";

const PRODUCTOS_COLLECTION = "productos";
const RESERVAS_INVENTARIO_COLLECTION = "reservasInventario";
const MOVIMIENTOS_INVENTARIO_COLLECTION = "movimientosInventario";
const ORDENES_COLLECTION = "ordenes";

type ReserveItemInput = {
  productoId: string;
  tallaId?: string | null;
  cantidad: number;
};

class InventoryReservationService {
  private buildReservationDocId(ordenId: string, item: ReserveItemInput): string {
    const tallaKey = item.tallaId?.trim() || "_";
    return Buffer.from(`${ordenId}:${item.productoId}:${tallaKey}`).toString(
      "base64url",
    );
  }

  private buildReservationIdempotencyKey(
    ordenId: string,
    item: ReserveItemInput,
    paymentRef: string,
  ): string {
    const tallaKey = item.tallaId?.trim() || "_";
    return `reserve:${paymentRef}:${ordenId}:${item.productoId}:${tallaKey}`;
  }

  async orderHasActiveReservations(ordenId: string): Promise<boolean> {
    const snapshot = await firestoreTienda
      .collection(RESERVAS_INVENTARIO_COLLECTION)
      .where("ordenId", "==", ordenId)
      .where("estado", "==", EstadoReservaInventario.ACTIVA)
      .limit(1)
      .get();
    return !snapshot.empty;
  }

  async reserveForOrder(input: {
    ordenId: string;
    usuarioId?: string;
    paymentAttemptId?: string;
    pagoId?: string;
    idempotencyPrefix: string;
  }): Promise<ReservaInventario[]> {
    const ordenDoc = await firestoreTienda
      .collection(ORDENES_COLLECTION)
      .doc(input.ordenId)
      .get();

    if (!ordenDoc.exists) {
      throw new Error(`Orden con ID ${input.ordenId} no encontrada`);
    }

    const orden = ordenDoc.data() as Orden;
    const paymentRef = input.pagoId || input.paymentAttemptId || input.ordenId;
    const expiraEn = admin.firestore.Timestamp.fromDate(
      new Date(Date.now() + INVENTORY_RESERVATION_TTL_MINUTES * 60 * 1000),
    );
    const now = admin.firestore.Timestamp.now();
    const reservas: ReservaInventario[] = [];

    for (const item of orden.items) {
      const tallaId = item.tallaId?.trim() || null;
      const reservationId = this.buildReservationDocId(input.ordenId, {
        productoId: item.productoId,
        tallaId,
        cantidad: item.cantidad,
      });
      const reservationRef = firestoreTienda
        .collection(RESERVAS_INVENTARIO_COLLECTION)
        .doc(reservationId);

      const existing = await reservationRef.get();
      if (existing.exists) {
        const data = existing.data() as ReservaInventario;
        if (data.estado === EstadoReservaInventario.ACTIVA) {
          reservas.push({ ...data, id: reservationRef.id });
          continue;
        }
        if (data.estado === EstadoReservaInventario.CONFIRMADA) {
          continue;
        }
      }

      await firestoreTienda.runTransaction(async (transaction) => {
        const productRef = firestoreTienda
          .collection(PRODUCTOS_COLLECTION)
          .doc(item.productoId);
        const [productSnap, reservationSnap] = await Promise.all([
          transaction.get(productRef),
          transaction.get(reservationRef),
        ]);

        if (!productSnap.exists) {
          throw new Error(`Producto con ID ${item.productoId} no encontrado`);
        }

        if (reservationSnap.exists) {
          const existingReservation = reservationSnap.data() as ReservaInventario;
          if (existingReservation.estado === EstadoReservaInventario.ACTIVA) {
            return;
          }
          if (existingReservation.estado === EstadoReservaInventario.CONFIRMADA) {
            return;
          }
        }

        const productData = productSnap.data() as Record<string, unknown>;
        const available = getAvailableForVariant(productData, tallaId);
        if (available < item.cantidad) {
          throw new Error(
            `Stock insuficiente para reservar "${item.productoId}"` +
              `${tallaId ? ` talla ${tallaId}` : ""}. Disponible: ${available}, solicitado: ${item.cantidad}`,
          );
        }

        const tallaIds = normalizeTallaIds(productData.tallaIds);
        const projection = projectLegacyFromProductData(productData);

        if (tallaIds.length === 0) {
          const global = normalizeGlobalBuckets(
            productData,
            projection.existencias,
          );
          global.reservada += item.cantidad;
          global.disponible = computeDisponible(
            global.fisica,
            global.reservada,
            global.noDisponible,
          );

          transaction.update(
            productRef,
            buildFirestoreInventoryPatch({
              tallaIds: [],
              inventarioPorTalla: [],
              inventarioGlobal: global,
            }) as FirebaseFirestore.UpdateData<FirebaseFirestore.DocumentData>,
          );
        } else {
          const inventarioPorTalla = projection.inventarioPorTalla.map(
            (row) => {
              if (row.tallaId !== tallaId) {
                return row;
              }
              const buckets = normalizeSizeBuckets(
                row.tallaId,
                row,
                row.cantidad,
              );
              buckets.reservada += item.cantidad;
              buckets.disponible = computeDisponible(
                buckets.fisica,
                buckets.reservada,
                buckets.noDisponible,
              );
              return {
                tallaId: row.tallaId,
                cantidad: buckets.disponible,
                fisica: buckets.fisica,
                reservada: buckets.reservada,
                noDisponible: buckets.noDisponible,
                entrante: buckets.entrante,
              } satisfies InventarioPorTallaExtended;
            },
          );

          transaction.update(
            productRef,
            buildFirestoreInventoryPatch({
              tallaIds,
              inventarioPorTalla,
            }) as FirebaseFirestore.UpdateData<FirebaseFirestore.DocumentData>,
          );
        }

        const movimientoRef = firestoreTienda
          .collection(MOVIMIENTOS_INVENTARIO_COLLECTION)
          .doc();

        transaction.set(movimientoRef, {
          tipo: TipoMovimientoInventario.RESERVA,
          productoId: item.productoId,
          tallaId,
          cantidadAnterior: available,
          cantidadNueva: available - item.cantidad,
          diferencia: -item.cantidad,
          ordenId: input.ordenId,
          usuarioId: input.usuarioId,
          referencia: paymentRef,
          motivo: "Reserva al iniciar pago",
          origen: "checkout",
          createdAt: now,
        });

        transaction.set(reservationRef, {
          ordenId: input.ordenId,
          productoId: item.productoId,
          tallaId,
          cantidad: item.cantidad,
          estado: EstadoReservaInventario.ACTIVA,
          paymentAttemptId: input.paymentAttemptId,
          pagoId: input.pagoId,
          usuarioId: input.usuarioId,
          expiraEn,
          idempotencyKey: this.buildReservationIdempotencyKey(
            input.ordenId,
            { productoId: item.productoId, tallaId, cantidad: item.cantidad },
            paymentRef,
          ),
          createdAt: now,
          updatedAt: now,
        });
      });

      const saved = await reservationRef.get();
      reservas.push({
        ...(saved.data() as ReservaInventario),
        id: saved.id,
        expiraEn: saved.data()?.expiraEn?.toDate?.() ?? new Date(),
        createdAt: saved.data()?.createdAt?.toDate?.() ?? new Date(),
      });
    }

    return reservas;
  }

  async releaseOrderReservations(input: {
    ordenId: string;
    motivo: string;
    usuarioId?: string;
    targetStatus?: EstadoReservaInventario;
  }): Promise<void> {
    const targetStatus = input.targetStatus ?? EstadoReservaInventario.LIBERADA;
    const snapshot = await firestoreTienda
      .collection(RESERVAS_INVENTARIO_COLLECTION)
      .where("ordenId", "==", input.ordenId)
      .where("estado", "==", EstadoReservaInventario.ACTIVA)
      .get();

    if (snapshot.empty) {
      return;
    }

    const now = admin.firestore.Timestamp.now();

    for (const doc of snapshot.docs) {
      const reserva = doc.data() as ReservaInventario;
      await firestoreTienda.runTransaction(async (transaction) => {
        const productRef = firestoreTienda
          .collection(PRODUCTOS_COLLECTION)
          .doc(reserva.productoId);
        const [productSnap, reservationSnap] = await Promise.all([
          transaction.get(productRef),
          transaction.get(doc.ref),
        ]);

        if (!reservationSnap.exists) {
          return;
        }

        const current = reservationSnap.data() as ReservaInventario;
        if (current.estado !== EstadoReservaInventario.ACTIVA) {
          return;
        }

        if (!productSnap.exists) {
          transaction.update(doc.ref, {
            estado: targetStatus,
            updatedAt: now,
            motivo: input.motivo,
          });
          return;
        }

        const productData = productSnap.data() as Record<string, unknown>;
        const tallaIds = normalizeTallaIds(productData.tallaIds);
        const projection = projectLegacyFromProductData(productData);
        const availableBefore = getAvailableForVariant(
          productData,
          reserva.tallaId,
        );

        if (tallaIds.length === 0) {
          const global = normalizeGlobalBuckets(
            productData,
            projection.existencias,
          );
          global.reservada = Math.max(0, global.reservada - reserva.cantidad);
          global.disponible = computeDisponible(
            global.fisica,
            global.reservada,
            global.noDisponible,
          );
          transaction.update(
            productRef,
            buildFirestoreInventoryPatch({
              tallaIds: [],
              inventarioPorTalla: [],
              inventarioGlobal: global,
            }) as FirebaseFirestore.UpdateData<FirebaseFirestore.DocumentData>,
          );
        } else {
          const inventarioPorTalla = projection.inventarioPorTalla.map((row) => {
            if (row.tallaId !== reserva.tallaId) {
              return row;
            }
            const buckets = normalizeSizeBuckets(row.tallaId, row, row.cantidad);
            buckets.reservada = Math.max(0, buckets.reservada - reserva.cantidad);
            buckets.disponible = computeDisponible(
              buckets.fisica,
              buckets.reservada,
              buckets.noDisponible,
            );
            return {
              tallaId: row.tallaId,
              cantidad: buckets.disponible,
              fisica: buckets.fisica,
              reservada: buckets.reservada,
              noDisponible: buckets.noDisponible,
              entrante: buckets.entrante,
            };
          });

          transaction.update(
            productRef,
            buildFirestoreInventoryPatch({
              tallaIds,
              inventarioPorTalla,
            }) as FirebaseFirestore.UpdateData<FirebaseFirestore.DocumentData>,
          );
        }

        const movimientoRef = firestoreTienda
          .collection(MOVIMIENTOS_INVENTARIO_COLLECTION)
          .doc();

        transaction.set(movimientoRef, {
          tipo: TipoMovimientoInventario.LIBERACION_RESERVA,
          productoId: reserva.productoId,
          tallaId: reserva.tallaId,
          cantidadAnterior: availableBefore,
          cantidadNueva: availableBefore + reserva.cantidad,
          diferencia: reserva.cantidad,
          ordenId: input.ordenId,
          usuarioId: input.usuarioId,
          referencia: input.ordenId,
          motivo: input.motivo,
          origen: "pago",
          createdAt: now,
        });

        transaction.update(doc.ref, {
          estado: targetStatus,
          updatedAt: now,
          motivo: input.motivo,
        });
      });
    }
  }

  async confirmOrderReservations(ordenId: string, usuarioId?: string): Promise<void> {
    const snapshot = await firestoreTienda
      .collection(RESERVAS_INVENTARIO_COLLECTION)
      .where("ordenId", "==", ordenId)
      .where("estado", "==", EstadoReservaInventario.ACTIVA)
      .get();

    if (snapshot.empty) {
      return;
    }

    const now = admin.firestore.Timestamp.now();

    for (const doc of snapshot.docs) {
      const reserva = doc.data() as ReservaInventario;
      await firestoreTienda.runTransaction(async (transaction) => {
        const productRef = firestoreTienda
          .collection(PRODUCTOS_COLLECTION)
          .doc(reserva.productoId);
        const [productSnap, reservationSnap] = await Promise.all([
          transaction.get(productRef),
          transaction.get(doc.ref),
        ]);

        if (!reservationSnap.exists) {
          return;
        }

        const current = reservationSnap.data() as ReservaInventario;
        if (current.estado !== EstadoReservaInventario.ACTIVA) {
          return;
        }

        if (!productSnap.exists) {
          throw new Error(`Producto con ID ${reserva.productoId} no encontrado`);
        }

        const productData = productSnap.data() as Record<string, unknown>;
        const tallaIds = normalizeTallaIds(productData.tallaIds);
        const projection = projectLegacyFromProductData(productData);

        if (tallaIds.length === 0) {
          const global = normalizeGlobalBuckets(
            productData,
            projection.existencias,
          );
          global.fisica = Math.max(0, global.fisica - reserva.cantidad);
          global.reservada = Math.max(0, global.reservada - reserva.cantidad);
          global.disponible = computeDisponible(
            global.fisica,
            global.reservada,
            global.noDisponible,
          );
          transaction.update(
            productRef,
            buildFirestoreInventoryPatch({
              tallaIds: [],
              inventarioPorTalla: [],
              inventarioGlobal: global,
            }) as FirebaseFirestore.UpdateData<FirebaseFirestore.DocumentData>,
          );
        } else {
          const inventarioPorTalla = projection.inventarioPorTalla.map((row) => {
            if (row.tallaId !== reserva.tallaId) {
              return row;
            }
            const buckets = normalizeSizeBuckets(row.tallaId, row, row.cantidad);
            buckets.fisica = Math.max(0, buckets.fisica - reserva.cantidad);
            buckets.reservada = Math.max(0, buckets.reservada - reserva.cantidad);
            buckets.disponible = computeDisponible(
              buckets.fisica,
              buckets.reservada,
              buckets.noDisponible,
            );
            return {
              tallaId: row.tallaId,
              cantidad: buckets.disponible,
              fisica: buckets.fisica,
              reservada: buckets.reservada,
              noDisponible: buckets.noDisponible,
              entrante: buckets.entrante,
            };
          });

          transaction.update(
            productRef,
            buildFirestoreInventoryPatch({
              tallaIds,
              inventarioPorTalla,
            }) as FirebaseFirestore.UpdateData<FirebaseFirestore.DocumentData>,
          );
        }

        transaction.update(doc.ref, {
          estado: EstadoReservaInventario.CONFIRMADA,
          updatedAt: now,
        });

        const movimientoRef = firestoreTienda
          .collection(MOVIMIENTOS_INVENTARIO_COLLECTION)
          .doc();

        const availableAfter = getAvailableForVariant(
          productSnap.data() as Record<string, unknown>,
          reserva.tallaId,
        );

        transaction.set(movimientoRef, {
          tipo: TipoMovimientoInventario.VENTA,
          productoId: reserva.productoId,
          tallaId: reserva.tallaId,
          cantidadAnterior: availableAfter + reserva.cantidad,
          cantidadNueva: availableAfter,
          diferencia: -reserva.cantidad,
          ordenId,
          usuarioId,
          referencia: ordenId,
          motivo: "Venta confirmada por pago",
          origen: "pago",
          idempotencyKey: `paid:${ordenId}:${reserva.productoId}:${reserva.tallaId ?? "_"}`,
          createdAt: now,
        });
      });
    }
  }

  async expireDueReservations(limit = 100): Promise<number> {
    const now = admin.firestore.Timestamp.now();
    const snapshot = await firestoreTienda
      .collection(RESERVAS_INVENTARIO_COLLECTION)
      .where("estado", "==", EstadoReservaInventario.ACTIVA)
      .where("expiraEn", "<=", now)
      .limit(limit)
      .get();

    const ordenIds = [...new Set(snapshot.docs.map((doc) => doc.data().ordenId))];
    for (const ordenId of ordenIds) {
      await this.releaseOrderReservations({
        ordenId,
        motivo: "Reserva expirada por tiempo",
        targetStatus: EstadoReservaInventario.EXPIRADA,
      });
    }

    return ordenIds.length;
  }

  async reconcilePaidOrdersWithoutSale(limit = 50): Promise<number> {
    const snapshot = await firestoreTienda
      .collection(ORDENES_COLLECTION)
      .where("estado", "in", ["CONFIRMADA", "EN_PROCESO"])
      .limit(limit)
      .get();

    let reconciled = 0;
    for (const doc of snapshot.docs) {
      const ordenId = doc.id;
      const hasSale = await inventoryService.orderHasSaleMovements(ordenId);
      if (hasSale) {
        continue;
      }

      const hasReservation = await this.orderHasActiveReservations(ordenId);
      if (hasReservation) {
        await this.confirmOrderReservations(
          ordenId,
          (doc.data() as Orden).usuarioId,
        );
        reconciled += 1;
        continue;
      }

      const orden = doc.data() as Orden;
      for (const item of orden.items) {
        await inventoryService.registerMovement({
          tipo: TipoMovimientoInventario.VENTA,
          productoId: item.productoId,
          tallaId: item.tallaId,
          cantidad: item.cantidad,
          ordenId,
          referencia: ordenId,
          motivo: "Reconciliación pago confirmado sin venta",
          usuarioId: orden.usuarioId,
          idempotencyKey: `reconcile:${ordenId}:${item.productoId}:${item.tallaId ?? "_"}`,
        });
      }
      reconciled += 1;
    }

    return reconciled;
  }
}

export const inventoryReservationService = new InventoryReservationService();
export default inventoryReservationService;
