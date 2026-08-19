/**
 * Idempotencia persistida en Firestore.
 *
 * Cloud Functions ejecuta múltiples instancias, así que la memoria del proceso no sirve.
 * La clave se ancla a actor + operación + recurso + hash del payload normalizado, de modo
 * que la misma key con payload distinto es un conflicto y no un replay silencioso.
 */

import { createHash } from "crypto";
import { PosIdempotencyStatus } from "../models/pos.enums";
import PosProblemError from "../errors/pos-problem.error";
import type { PosIdempotencyRecord } from "../models/pos.types";
import { posIdempotencyRepository } from "../repositories/pos-support.repository";

/** Normaliza el payload: orden de claves estable y `undefined` tratado como ausente. */
export function normalizePayload(value: unknown): unknown {
  if (value === null || value === undefined) {
    return null;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => normalizePayload(entry));
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return entries.reduce<Record<string, unknown>>((acc, [key, entry]) => {
      acc[key] = normalizePayload(entry);
      return acc;
    }, {});
  }
  return value;
}

export function hashPayload(payload: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(normalizePayload(payload)))
    .digest("hex");
}

/** ID de documento determinista y seguro para Firestore (la key del cliente es libre). */
export function idempotencyDocId(input: {
  actorUid: string;
  operation: string;
  resourceKey: string;
  key: string;
}): string {
  return createHash("sha256")
    .update(
      `${input.actorUid}|${input.operation}|${input.resourceKey}|${input.key}`,
    )
    .digest("hex");
}

export interface IdempotentExecutionInput<T> {
  /** Identificador estable de la operación, p. ej. `sales.payments.cash`. */
  operation: string;
  /** Recurso afectado. Evita que la misma key sirva para dos recursos distintos. */
  resourceKey: string;
  actorUid: string;
  idempotencyKey: string;
  payload: unknown;
  ttlMs: number;
  execute: () => Promise<{ statusCode: number; body: T }>;
}

export interface IdempotentExecutionResult<T> {
  statusCode: number;
  body: T;
  replayed: boolean;
}

class PosIdempotencyService {
  /**
   * Ejecuta la operación a lo más una vez por clave.
   *
   * `execute` solo corre cuando la reserva es nueva. Si falla, el registro se marca
   * `FAILED` para permitir un reintento seguro: los efectos del POS son transaccionales,
   * por lo que un fallo implica que no quedó nada aplicado.
   */
  async execute<T>(
    input: IdempotentExecutionInput<T>,
  ): Promise<IdempotentExecutionResult<T>> {
    const requestHash = hashPayload(input.payload);
    const docId = idempotencyDocId({
      actorUid: input.actorUid,
      operation: input.operation,
      resourceKey: input.resourceKey,
      key: input.idempotencyKey,
    });

    const reservation = await posIdempotencyRepository.reserve({
      docId,
      operation: input.operation,
      actorUid: input.actorUid,
      resourceKey: input.resourceKey,
      requestHash,
      ttlMs: input.ttlMs,
    });

    if (reservation.outcome === "replay") {
      const record = reservation.record as PosIdempotencyRecord;
      this.assertSamePayload(record, requestHash);

      if (record.status === PosIdempotencyStatus.IN_PROGRESS) {
        throw new PosProblemError("IDEMPOTENCY_IN_PROGRESS");
      }

      return {
        statusCode: record.statusCode ?? 200,
        body: record.responseBody as T,
        replayed: true,
      };
    }

    try {
      const result = await input.execute();
      await posIdempotencyRepository.complete(
        docId,
        result.statusCode,
        result.body,
      );
      return { ...result, replayed: false };
    } catch (error) {
      const errorCode =
        error instanceof PosProblemError ? error.code : "INTERNAL_ERROR";
      await posIdempotencyRepository.fail(docId, errorCode);
      throw error;
    }
  }

  private assertSamePayload(
    record: PosIdempotencyRecord,
    requestHash: string,
  ): void {
    if (record.requestHash !== requestHash) {
      throw new PosProblemError(
        "IDEMPOTENCY_CONFLICT",
        "La Idempotency-Key ya se usó con un payload diferente para esta operación.",
      );
    }
  }
}

export const posIdempotencyService = new PosIdempotencyService();
export default posIdempotencyService;
