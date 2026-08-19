/**
 * Serialización de entidades POS hacia JSON.
 *
 * Los documentos guardan `Timestamp` de Firestore, que no es JSON-serializable de forma
 * útil (`{_seconds, _nanoseconds}`). Aquí se convierte a ISO-8601 en un único lugar para
 * que ningún controlador improvise su propio formato.
 *
 * También se filtran campos internos que no deben salir del backend.
 */

import { Timestamp } from "firebase-admin/firestore";
import type { PosActor, PosPageResult } from "../models/pos.types";

/** Campos internos que nunca se devuelven al cliente. */
const STRIPPED_FIELDS = new Set(["content", "requestHash", "responseBody"]);

function isTimestampLike(value: unknown): value is Timestamp {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { toDate?: unknown }).toDate === "function" &&
    typeof (value as { seconds?: unknown }).seconds === "number"
  );
}

/** Convierte recursivamente `Timestamp` en ISO-8601 y elimina campos internos. */
export function toPosJson<T>(value: T): unknown {
  if (value === null || value === undefined) {
    return null;
  }
  if (isTimestampLike(value)) {
    return value.toDate().toISOString();
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    return value.map((entry) => toPosJson(entry));
  }
  if (typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (STRIPPED_FIELDS.has(key) || entry === undefined) {
        continue;
      }
      result[key] = toPosJson(entry);
    }
    return result;
  }
  return value;
}

/** Página con el contrato de paginación por cursor usado en el resto de la API. */
export function toPosPage<T>(page: PosPageResult<T>): {
  items: unknown[];
  pagination: { nextCursor: string | null; hasMore: boolean };
} {
  return {
    items: page.items.map((item) => toPosJson(item)),
    pagination: {
      nextCursor: page.nextCursor,
      hasMore: page.hasMore,
    },
  };
}

/** Vista pública del actor. No expone claims ni datos ajenos al POS. */
export function toActorJson(actor: PosActor): Record<string, unknown> {
  return {
    uid: actor.uid,
    name: actor.name ?? null,
    email: actor.email ?? null,
    baseRole: actor.baseRole,
    posRole: actor.posRole,
    capabilities: [...actor.capabilities],
  };
}
