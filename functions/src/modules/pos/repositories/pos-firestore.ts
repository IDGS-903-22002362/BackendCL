/**
 * Punto único de acceso a Firestore para el módulo POS.
 *
 * Reutiliza el cliente `firestoreTienda` ya inicializado (database `tiendacl`). No se crea
 * ninguna app de Firebase Admin ni cliente adicional.
 */

import { Timestamp } from "firebase-admin/firestore";
import { firestoreTienda } from "../../../config/firebase";
import {
  POS_COLLECTIONS,
  SHARED_COLLECTIONS,
} from "../constants/pos.constants";

export const posDb = firestoreTienda;

type PosCollectionKey = keyof typeof POS_COLLECTIONS;
type SharedCollectionKey = keyof typeof SHARED_COLLECTIONS;

export function posCollection(
  key: PosCollectionKey,
): FirebaseFirestore.CollectionReference {
  return posDb.collection(POS_COLLECTIONS[key]);
}

export function sharedCollection(
  key: SharedCollectionKey,
): FirebaseFirestore.CollectionReference {
  return posDb.collection(SHARED_COLLECTIONS[key]);
}

export function posDoc(
  key: PosCollectionKey,
  id: string,
): FirebaseFirestore.DocumentReference {
  return posCollection(key).doc(id);
}

/** Referencia con ID autogenerado, útil para escribir dentro de una transacción. */
export function newPosDoc(
  key: PosCollectionKey,
): FirebaseFirestore.DocumentReference {
  return posCollection(key).doc();
}

/** Timestamp de servidor. Nunca se acepta la hora del cliente. */
export function nowTimestamp(): Timestamp {
  return Timestamp.now();
}

export function timestampFromDate(date: Date): Timestamp {
  return Timestamp.fromDate(date);
}

/** Mapea un snapshot a entidad tipada añadiendo el `id` del documento. */
export function mapSnapshot<T>(
  snapshot: FirebaseFirestore.DocumentSnapshot,
): T | null {
  if (!snapshot.exists) {
    return null;
  }
  return { id: snapshot.id, ...(snapshot.data() as Record<string, unknown>) } as T;
}

export function mapQuerySnapshot<T>(
  snapshot: FirebaseFirestore.QuerySnapshot,
): T[] {
  return snapshot.docs.map(
    (doc) => ({ id: doc.id, ...(doc.data() as Record<string, unknown>) }) as T,
  );
}

/** `true` cuando el error corresponde a `tx.create`/`create` sobre un documento existente. */
export function isAlreadyExistsError(error: unknown): boolean {
  const code = String((error as { code?: unknown })?.code ?? "").toLowerCase();
  const message = String((error as { message?: unknown })?.message ?? "").toLowerCase();
  return (
    code === "6" ||
    code === "already-exists" ||
    message.includes("already exists")
  );
}

/** `true` cuando Firestore abortó la transacción por contención. */
export function isAbortedError(error: unknown): boolean {
  const code = String((error as { code?: unknown })?.code ?? "").toLowerCase();
  const message = String((error as { message?: unknown })?.message ?? "").toLowerCase();
  return (
    code === "10" ||
    code === "aborted" ||
    message.includes("too much contention") ||
    message.includes("transaction lock timeout")
  );
}

export function runPosTransaction<T>(
  handler: (transaction: FirebaseFirestore.Transaction) => Promise<T>,
): Promise<T> {
  return posDb.runTransaction(handler);
}
