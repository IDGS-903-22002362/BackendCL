/**
 * Base común de los repositorios de agregados del POS.
 *
 * Encapsula lectura por ID, creación con timestamps de servidor, escritura con versión
 * optimista y paginación por cursor. Evita repetir el mismo código en doce repositorios.
 */

import { Timestamp } from "firebase-admin/firestore";
import { POS_COLLECTIONS, POS_STORE_ID } from "../constants/pos.constants";
import PosProblemError from "../errors/pos-problem.error";
import type { PosPageResult } from "../models/pos.types";
import {
  mapSnapshot,
  newPosDoc,
  nowTimestamp,
  posCollection,
  posDoc,
  runPosTransaction,
} from "./pos-firestore";

type PosCollectionKey = keyof typeof POS_COLLECTIONS;

export interface VersionedEntity {
  id: string;
  version: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export type SortDirection = "asc" | "desc";

export interface ListOptions {
  limit: number;
  cursor?: string;
  orderByField: string;
  direction?: SortDirection;
  /** Filtros de igualdad ya validados por el llamador (nunca provienen crudos del cliente). */
  equals?: Array<{ field: string; value: unknown }>;
  range?: Array<{ field: string; operator: ">=" | "<=" | ">" | "<"; value: unknown }>;
  inFilter?: { field: string; values: unknown[] };
}

export abstract class PosAggregateRepository<T extends { id: string }> {
  protected constructor(protected readonly collectionKey: PosCollectionKey) {}

  protected collection(): FirebaseFirestore.CollectionReference {
    return posCollection(this.collectionKey);
  }

  /**
   * Referencia de colección para consultas que deben ejecutarse dentro de una transacción
   * abierta por un servicio (por ejemplo, la lectura de bloqueos al cerrar una caja).
   */
  collectionRef(): FirebaseFirestore.CollectionReference {
    return this.collection();
  }

  ref(id: string): FirebaseFirestore.DocumentReference {
    return posDoc(this.collectionKey, id);
  }

  newRef(): FirebaseFirestore.DocumentReference {
    return newPosDoc(this.collectionKey);
  }

  async getById(id: string): Promise<T | null> {
    return mapSnapshot<T>(await this.ref(id).get());
  }

  /** Igual que `getById` pero lanza 404 uniforme para evitar enumeración de recursos. */
  async requireById(id: string): Promise<T> {
    const entity = await this.getById(id);
    if (!entity) {
      throw new PosProblemError("POS_RESOURCE_NOT_FOUND");
    }
    return entity;
  }

  async getByIdInTransaction(
    transaction: FirebaseFirestore.Transaction,
    id: string,
  ): Promise<T | null> {
    return mapSnapshot<T>(await transaction.get(this.ref(id)));
  }

  async requireByIdInTransaction(
    transaction: FirebaseFirestore.Transaction,
    id: string,
  ): Promise<T> {
    const entity = await this.getByIdInTransaction(transaction, id);
    if (!entity) {
      throw new PosProblemError("POS_RESOURCE_NOT_FOUND");
    }
    return entity;
  }

  async create(
    data: Omit<T, "id" | "createdAt" | "updatedAt" | "version"> &
      Partial<Pick<VersionedEntity, "version">>,
    id?: string,
  ): Promise<T> {
    const ref = id ? this.ref(id) : this.newRef();
    const now = nowTimestamp();
    const payload = {
      ...data,
      storeId: POS_STORE_ID,
      version: data.version ?? 1,
      createdAt: now,
      updatedAt: now,
    };
    await ref.create(payload);
    return { id: ref.id, ...payload } as unknown as T;
  }

  createInTransaction(
    transaction: FirebaseFirestore.Transaction,
    data: Omit<T, "id" | "createdAt" | "updatedAt" | "version"> &
      Partial<Pick<VersionedEntity, "version">>,
    id?: string,
  ): T {
    const ref = id ? this.ref(id) : this.newRef();
    const now = nowTimestamp();
    const payload = {
      ...data,
      storeId: POS_STORE_ID,
      version: data.version ?? 1,
      createdAt: now,
      updatedAt: now,
    };
    transaction.create(ref, payload);
    return { id: ref.id, ...payload } as unknown as T;
  }

  /**
   * Actualiza incrementando `version`. Cuando se pasa `expectedVersion`, la escritura falla
   * con `CONCURRENT_MODIFICATION` si otro actor modificó el documento antes.
   */
  updateInTransaction(
    transaction: FirebaseFirestore.Transaction,
    id: string,
    patch: Record<string, unknown>,
    currentVersion: number,
  ): void {
    transaction.update(this.ref(id), {
      ...patch,
      version: currentVersion + 1,
      updatedAt: nowTimestamp(),
    });
  }

  async update(
    id: string,
    patch: Record<string, unknown>,
    expectedVersion?: number,
  ): Promise<T> {
    return runPosTransaction(async (transaction) => {
      const current = await this.requireByIdInTransaction(transaction, id);
      const version = (current as unknown as VersionedEntity).version ?? 1;
      if (expectedVersion !== undefined && expectedVersion !== version) {
        throw new PosProblemError("CONCURRENT_MODIFICATION");
      }
      this.updateInTransaction(transaction, id, patch, version);
      return {
        ...(current as unknown as Record<string, unknown>),
        ...patch,
        version: version + 1,
      } as unknown as T;
    });
  }

  async list(options: ListOptions): Promise<PosPageResult<T>> {
    let query: FirebaseFirestore.Query = this.collection().where(
      "storeId",
      "==",
      POS_STORE_ID,
    );

    for (const filter of options.equals ?? []) {
      if (filter.value === undefined || filter.value === null) continue;
      query = query.where(filter.field, "==", filter.value);
    }
    for (const filter of options.range ?? []) {
      if (filter.value === undefined || filter.value === null) continue;
      query = query.where(filter.field, filter.operator, filter.value);
    }
    if (options.inFilter && options.inFilter.values.length > 0) {
      query = query.where(
        options.inFilter.field,
        "in",
        options.inFilter.values.slice(0, 30),
      );
    }

    query = query
      .orderBy(options.orderByField, options.direction ?? "desc")
      .limit(options.limit + 1);

    if (options.cursor) {
      const cursorSnapshot = await this.ref(options.cursor).get();
      if (cursorSnapshot.exists) {
        query = query.startAfter(cursorSnapshot);
      }
    }

    const snapshot = await query.get();
    const hasMore = snapshot.docs.length > options.limit;
    const docs = snapshot.docs.slice(0, options.limit);
    const items = docs.map(
      (doc) => ({ id: doc.id, ...(doc.data() as Record<string, unknown>) }) as T,
    );

    return {
      items,
      hasMore,
      nextCursor: hasMore ? (docs[docs.length - 1]?.id ?? null) : null,
    };
  }

  /**
   * Lee todos los documentos que cumplen filtros de igualdad, en páginas internas.
   * Se usa solo para consolidaciones acotadas (un turno, una sesión, un día) con un límite
   * duro para no cargar colecciones completas en memoria.
   */
  async collectAll(
    equals: Array<{ field: string; value: unknown }>,
    orderByField: string,
    hardLimit: number,
  ): Promise<T[]> {
    let query: FirebaseFirestore.Query = this.collection().where(
      "storeId",
      "==",
      POS_STORE_ID,
    );
    for (const filter of equals) {
      if (filter.value === undefined || filter.value === null) continue;
      query = query.where(filter.field, "==", filter.value);
    }
    const snapshot = await query.orderBy(orderByField, "asc").limit(hardLimit).get();
    return snapshot.docs.map(
      (doc) => ({ id: doc.id, ...(doc.data() as Record<string, unknown>) }) as T,
    );
  }

  /**
   * Lee un rango cerrado de fechas operativas.
   * Consulta día por día con igualdad en `operationalDate` (índice de un campo) y filtra
   * en memoria, para no depender de índices compuestos aún no desplegados.
   */
  async collectByOperationalDateRange(
    from: string,
    to: string,
    equals: Array<{ field: string; value: unknown }>,
    hardLimit: number,
  ): Promise<T[]> {
    const items: T[] = [];
    const span = (() => {
      const [fy, fm, fd] = from.split("-").map(Number);
      const [ty, tm, td] = to.split("-").map(Number);
      const fromUtc = Date.UTC(fy, fm - 1, fd);
      const toUtc = Date.UTC(ty, tm - 1, td);
      return Math.round((toUtc - fromUtc) / 86_400_000);
    })();

    for (let offset = 0; offset <= span; offset += 1) {
      const [year, month, day] = from.split("-").map(Number);
      const utc = new Date(Date.UTC(year, month - 1, day + offset));
      const operationalDate = [
        utc.getUTCFullYear(),
        String(utc.getUTCMonth() + 1).padStart(2, "0"),
        String(utc.getUTCDate()).padStart(2, "0"),
      ].join("-");

      const snapshot = await this.collection()
        .where("operationalDate", "==", operationalDate)
        .limit(hardLimit)
        .get();

      for (const doc of snapshot.docs) {
        const item = {
          id: doc.id,
          ...(doc.data() as Record<string, unknown>),
        } as T & Record<string, unknown>;
        if (item.storeId !== POS_STORE_ID) continue;
        const matches = equals.every((filter) => {
          if (filter.value === undefined || filter.value === null) return true;
          return item[filter.field] === filter.value;
        });
        if (!matches) continue;
        items.push(item);
        if (items.length >= hardLimit) return items;
      }
    }

    return items;
  }
}
