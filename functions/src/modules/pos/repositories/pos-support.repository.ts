/**
 * Repositorios de soporte del POS: configuración, operadores, idempotencia, folios,
 * locks lógicos y auditoría.
 */

import { Timestamp } from "firebase-admin/firestore";
import { firestoreApp } from "../../../config/app.firebase";
import {
  POS_COLLECTIONS,
  POS_STORE_ID,
} from "../constants/pos.constants";
import {
  PosIdempotencyStatus,
  PosRole,
} from "../models/pos.enums";
import type {
  PosAuditEvent,
  PosIdempotencyRecord,
  PosOperator,
  PosSettings,
} from "../models/pos.types";
import {
  isAlreadyExistsError,
  newPosDoc,
  nowTimestamp,
  posCollection,
  posDoc,
  runPosTransaction,
} from "./pos-firestore";

export class PosSettingsRepository {
  async get(): Promise<PosSettings | null> {
    const snapshot = await posDoc("SETTINGS", POS_STORE_ID).get();
    if (!snapshot.exists) {
      return null;
    }
    return { ...(snapshot.data() as PosSettings), storeId: POS_STORE_ID };
  }

  async create(settings: PosSettings): Promise<PosSettings> {
    const now = nowTimestamp();
    const payload: PosSettings = { ...settings, createdAt: now, updatedAt: now };
    await posDoc("SETTINGS", POS_STORE_ID).set(payload, { merge: false });
    return payload;
  }

  /** Escritura con versión optimista: falla si otro admin cambió la configuración. */
  async update(
    patch: Partial<PosSettings>,
    expectedVersion: number,
    updatedBy: string,
  ): Promise<PosSettings> {
    return runPosTransaction(async (transaction) => {
      const ref = posDoc("SETTINGS", POS_STORE_ID);
      const snapshot = await transaction.get(ref);
      const current = snapshot.data() as PosSettings | undefined;
      if (!current) {
        throw new Error("posSettings no inicializado");
      }
      if (current.version !== expectedVersion) {
        const error = new Error("pos_settings_version_conflict");
        (error as { code?: string }).code = "pos/version-conflict";
        throw error;
      }
      const next: PosSettings = {
        ...current,
        ...patch,
        storeId: POS_STORE_ID,
        version: current.version + 1,
        updatedBy,
        updatedAt: nowTimestamp(),
      };
      transaction.set(ref, next, { merge: false });
      return next;
    });
  }
}

export class PosOperatorRepository {
  async get(uid: string): Promise<PosOperator | null> {
    const snapshot = await posDoc("OPERATORS", uid).get();
    if (!snapshot.exists) {
      return null;
    }
    return { ...(snapshot.data() as PosOperator), uid };
  }

  async upsert(input: {
    uid: string;
    posRole: PosRole;
    active: boolean;
    defaultRegisterId?: string | null;
    updatedBy: string;
  }): Promise<PosOperator> {
    const ref = posDoc("OPERATORS", input.uid);
    const now = nowTimestamp();
    const existing = await ref.get();
    const payload: PosOperator = {
      uid: input.uid,
      posRole: input.posRole,
      active: input.active,
      defaultRegisterId: input.defaultRegisterId ?? null,
      updatedBy: input.updatedBy,
      createdAt: (existing.data() as PosOperator | undefined)?.createdAt ?? now,
      updatedAt: now,
    };
    await ref.set(payload, { merge: false });
    return payload;
  }

  async list(limit: number): Promise<PosOperator[]> {
    const snapshot = await posCollection("OPERATORS").limit(limit).get();
    return snapshot.docs.map((doc) => ({
      ...(doc.data() as PosOperator),
      uid: doc.id,
    }));
  }
}

export interface IdempotencyReservation {
  /** `replay` devuelve la respuesta previa; `fresh` autoriza ejecutar la operación. */
  outcome: "fresh" | "replay";
  docId: string;
  record?: PosIdempotencyRecord;
}

export class PosIdempotencyRepository {
  async reserve(input: {
    docId: string;
    operation: string;
    actorUid: string;
    resourceKey: string;
    requestHash: string;
    ttlMs: number;
  }): Promise<IdempotencyReservation> {
    const ref = posDoc("IDEMPOTENCY", input.docId);
    const now = nowTimestamp();
    const record: PosIdempotencyRecord = {
      operation: input.operation,
      actorUid: input.actorUid,
      resourceKey: input.resourceKey,
      requestHash: input.requestHash,
      status: PosIdempotencyStatus.IN_PROGRESS,
      statusCode: null,
      responseBody: null,
      expiresAt: Date.now() + input.ttlMs,
      createdAt: now,
      updatedAt: now,
    };

    try {
      await ref.create(record);
      return { outcome: "fresh", docId: input.docId, record };
    } catch (error) {
      if (!isAlreadyExistsError(error)) {
        throw error;
      }
    }

    const existingSnapshot = await ref.get();
    const existing = existingSnapshot.data() as PosIdempotencyRecord | undefined;
    if (!existing) {
      // Carrera improbable: el documento desapareció entre create y get.
      await ref.set(record, { merge: false });
      return { outcome: "fresh", docId: input.docId, record };
    }

    if (existing.expiresAt <= Date.now()) {
      await ref.set(record, { merge: false });
      return { outcome: "fresh", docId: input.docId, record };
    }

    if (existing.status === PosIdempotencyStatus.FAILED) {
      // Falló antes de producir efectos: se permite reintento seguro.
      await ref.set(record, { merge: false });
      return { outcome: "fresh", docId: input.docId, record };
    }

    return { outcome: "replay", docId: input.docId, record: existing };
  }

  async complete(
    docId: string,
    statusCode: number,
    responseBody: unknown,
  ): Promise<void> {
    await posDoc("IDEMPOTENCY", docId).set(
      {
        status: PosIdempotencyStatus.COMPLETED,
        statusCode,
        responseBody: responseBody ?? null,
        updatedAt: nowTimestamp(),
      },
      { merge: true },
    );
  }

  async fail(docId: string, errorCode: string): Promise<void> {
    await posDoc("IDEMPOTENCY", docId).set(
      {
        status: PosIdempotencyStatus.FAILED,
        errorCode,
        updatedAt: nowTimestamp(),
      },
      { merge: true },
    );
  }

  async get(docId: string): Promise<PosIdempotencyRecord | null> {
    const snapshot = await posDoc("IDEMPOTENCY", docId).get();
    return snapshot.exists
      ? (snapshot.data() as PosIdempotencyRecord)
      : null;
  }
}

/**
 * Folios legibles por tipo, fecha operativa y caja: evita un contador global contendido
 * (DEC-10). El ID técnico del documento es independiente del folio.
 */
export class PosSequenceRepository {
  async next(scope: string, prefix: string): Promise<string> {
    const ref = posDoc("SEQUENCES", scope);
    const value = await runPosTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      const current = (snapshot.data()?.value as number | undefined) ?? 0;
      const next = current + 1;
      transaction.set(
        ref,
        { value: next, scope, updatedAt: nowTimestamp() },
        { merge: true },
      );
      return next;
    });
    return `${prefix}-${String(value).padStart(5, "0")}`;
  }

  /** Reserva un folio dentro de una transacción ya abierta. */
  reserveInTransaction(
    transaction: FirebaseFirestore.Transaction,
    scope: string,
    prefix: string,
    currentValue: number,
  ): string {
    const ref = posDoc("SEQUENCES", scope);
    const next = currentValue + 1;
    transaction.set(
      ref,
      { value: next, scope, updatedAt: nowTimestamp() },
      { merge: true },
    );
    return `${prefix}-${String(next).padStart(5, "0")}`;
  }

  async readValue(scope: string): Promise<number> {
    const snapshot = await posDoc("SEQUENCES", scope).get();
    return (snapshot.data()?.value as number | undefined) ?? 0;
  }

  sequenceRef(scope: string): FirebaseFirestore.DocumentReference {
    return posDoc("SEQUENCES", scope);
  }
}

/** Locks lógicos de unicidad (apertura de caja, referencia de terminal, etc.). */
export class PosLockRepository {
  ref(key: string): FirebaseFirestore.DocumentReference {
    return posDoc("LOCKS", encodeURIComponent(key));
  }

  /** Crea el lock dentro de una transacción. Falla si ya existe. */
  acquireInTransaction(
    transaction: FirebaseFirestore.Transaction,
    key: string,
    metadata: Record<string, unknown>,
  ): void {
    transaction.create(this.ref(key), {
      key,
      ...metadata,
      createdAt: nowTimestamp(),
    });
  }

  releaseInTransaction(
    transaction: FirebaseFirestore.Transaction,
    key: string,
  ): void {
    transaction.delete(this.ref(key));
  }

  async exists(key: string): Promise<boolean> {
    const snapshot = await this.ref(key).get();
    return snapshot.exists;
  }
}

/**
 * Lectura del directorio de personal (`usuariosApp` en la base `(default)`).
 *
 * Solo se usa para resolver a un autorizador o receptor por UID: el cliente envía el UID y el
 * backend obtiene su rol real, nunca al revés. No escribe usuarios ni duplica el modelo.
 */
export class PosUserDirectoryRepository {
  async findByUid(uid: string): Promise<{
    uid: string;
    email?: string;
    nombre?: string;
    rol?: string;
    activo?: boolean;
  } | null> {
    const snapshot = await firestoreApp
      .collection("usuariosApp")
      .where("uid", "==", uid)
      .limit(1)
      .get();
    const doc = snapshot.docs[0];
    if (!doc) {
      return null;
    }
    const data = doc.data() as Record<string, unknown>;
    return {
      uid,
      email: typeof data.email === "string" ? data.email : undefined,
      nombre: typeof data.nombre === "string" ? data.nombre : undefined,
      rol: typeof data.rol === "string" ? data.rol : undefined,
      activo: data.activo === undefined ? undefined : data.activo !== false,
    };
  }

  /**
   * Listado de personal por rol base. Usado únicamente por la migración/seed del POS;
   * no se expone por HTTP.
   */
  async listByRole(
    rol: string,
    limit = 500,
  ): Promise<
    Array<{
      uid: string;
      email?: string;
      nombre?: string;
      rol?: string;
      activo?: boolean;
    }>
  > {
    const snapshot = await firestoreApp
      .collection("usuariosApp")
      .where("rol", "==", rol)
      .limit(limit)
      .get();
    return snapshot.docs.map((doc) => {
      const data = doc.data() as Record<string, unknown>;
      const uid =
        typeof data.uid === "string" && data.uid.length > 0 ? data.uid : doc.id;
      return {
        uid,
        email: typeof data.email === "string" ? data.email : undefined,
        nombre: typeof data.nombre === "string" ? data.nombre : undefined,
        rol: typeof data.rol === "string" ? data.rol : undefined,
        activo: data.activo === undefined ? undefined : data.activo !== false,
      };
    });
  }
}

export class PosAuditRepository {
  /** Escritura append-only. No existe update ni delete en esta clase por diseño. */
  async append(event: Omit<PosAuditEvent, "id">): Promise<PosAuditEvent> {
    const ref = newPosDoc("AUDIT_EVENTS");
    await ref.set(event, { merge: false });
    return { id: ref.id, ...event };
  }

  appendInTransaction(
    transaction: FirebaseFirestore.Transaction,
    event: Omit<PosAuditEvent, "id">,
  ): string {
    const ref = newPosDoc("AUDIT_EVENTS");
    transaction.create(ref, event);
    return ref.id;
  }

  async list(filters: {
    entity?: string;
    entityId?: string;
    actorUid?: string;
    eventType?: string;
    operationalDate?: string;
    limit: number;
    cursor?: string;
  }): Promise<{ items: PosAuditEvent[]; nextCursor: string | null }> {
    let query: FirebaseFirestore.Query = posCollection("AUDIT_EVENTS");

    if (filters.entity) {
      query = query.where("entity", "==", filters.entity);
    }
    if (filters.entityId) {
      query = query.where("entityId", "==", filters.entityId);
    }
    if (filters.actorUid) {
      query = query.where("actorUid", "==", filters.actorUid);
    }
    if (filters.eventType) {
      query = query.where("eventType", "==", filters.eventType);
    }
    if (filters.operationalDate) {
      query = query.where("operationalDate", "==", filters.operationalDate);
    }

    query = query.orderBy("occurredAt", "desc").limit(filters.limit + 1);

    if (filters.cursor) {
      const cursorSnapshot = await posDoc("AUDIT_EVENTS", filters.cursor).get();
      if (cursorSnapshot.exists) {
        query = query.startAfter(cursorSnapshot);
      }
    }

    const snapshot = await query.get();
    const docs = snapshot.docs.slice(0, filters.limit);
    return {
      items: docs.map(
        (doc) => ({ ...(doc.data() as PosAuditEvent), id: doc.id }) as PosAuditEvent,
      ),
      nextCursor:
        snapshot.docs.length > filters.limit
          ? (docs[docs.length - 1]?.id ?? null)
          : null,
    };
  }
}

/** Utilidad compartida por repositorios: cursor por ID de documento. */
export async function applyCursor(
  query: FirebaseFirestore.Query,
  collectionName: string,
  cursor: string | undefined,
): Promise<FirebaseFirestore.Query> {
  if (!cursor) {
    return query;
  }
  const snapshot = await posCollectionByName(collectionName).doc(cursor).get();
  return snapshot.exists ? query.startAfter(snapshot) : query;
}

export function posCollectionByName(
  name: string,
): FirebaseFirestore.CollectionReference {
  const known = Object.values(POS_COLLECTIONS) as string[];
  if (!known.includes(name)) {
    throw new Error(`Colección POS desconocida: ${name}`);
  }
  return posCollection(
    (Object.keys(POS_COLLECTIONS) as Array<keyof typeof POS_COLLECTIONS>).find(
      (key) => POS_COLLECTIONS[key] === name,
    ) as keyof typeof POS_COLLECTIONS,
  );
}

export function toIsoString(value: Timestamp | null | undefined): string | null {
  return value ? value.toDate().toISOString() : null;
}

export const posSettingsRepository = new PosSettingsRepository();
export const posOperatorRepository = new PosOperatorRepository();
export const posIdempotencyRepository = new PosIdempotencyRepository();
export const posSequenceRepository = new PosSequenceRepository();
export const posLockRepository = new PosLockRepository();
export const posUserDirectoryRepository = new PosUserDirectoryRepository();
export const posAuditRepository = new PosAuditRepository();
