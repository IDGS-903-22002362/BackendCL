/**
 * Auditoría append-only del POS.
 *
 * No expone update ni delete. Sanitiza `before`/`after` con allowlist y trunca textos para
 * que nunca lleguen tokens, secretos, payloads completos ni datos de tarjeta al registro.
 */

import { createHash } from "crypto";
import { POS_STORE_ID } from "../constants/pos.constants";
import {
  PosAuditEntity,
  PosAuditEventType,
  PosAuditResult,
} from "../models/pos.enums";
import type {
  PosActor,
  PosAuditEvent,
  PosRequestContext,
} from "../models/pos.types";
import { nowTimestamp } from "../repositories/pos-firestore";
import { posAuditRepository } from "../repositories/pos-support.repository";

/** Claves cuyo valor nunca se persiste, aunque venga anidado. */
const FORBIDDEN_KEY_PATTERN =
  /(token|secret|password|authorization|cookie|apikey|api_key|pan|cvv|cvc|expiry|expiration|track|pin|clientsecret)/i;

const MAX_STRING_LENGTH = 300;
const MAX_SNAPSHOT_KEYS = 40;
const MAX_DEPTH = 4;

export function sanitizeAuditValue(
  value: unknown,
  depth = 0,
): unknown {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "string") {
    return value.length > MAX_STRING_LENGTH
      ? `${value.slice(0, MAX_STRING_LENGTH)}…`
      : value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (depth >= MAX_DEPTH) {
    return "[truncated]";
  }
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((entry) => sanitizeAuditValue(entry, depth + 1));
  }
  if (typeof value === "object") {
    // Los Timestamp de Firestore se conservan tal cual: son valores seguros y consultables.
    if (
      typeof (value as { toDate?: unknown }).toDate === "function" &&
      typeof (value as { seconds?: unknown }).seconds === "number"
    ) {
      return value;
    }
    const result: Record<string, unknown> = {};
    let keys = 0;
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (keys >= MAX_SNAPSHOT_KEYS) {
        result["…"] = "[truncated]";
        break;
      }
      if (FORBIDDEN_KEY_PATTERN.test(key)) {
        result[key] = "[redacted]";
        keys += 1;
        continue;
      }
      result[key] = sanitizeAuditValue(entry, depth + 1);
      keys += 1;
    }
    return result;
  }
  return null;
}

export function sanitizeAuditSnapshot(
  value: unknown,
): Record<string, unknown> | null {
  if (value === null || value === undefined) {
    return null;
  }
  const sanitized = sanitizeAuditValue(value);
  return sanitized && typeof sanitized === "object" && !Array.isArray(sanitized)
    ? (sanitized as Record<string, unknown>)
    : { value: sanitized };
}

/** Hash irreversible de la IP: permite correlacionar sin almacenar el dato personal. */
export function hashIpAddress(ip: string | undefined): string | null {
  if (!ip) {
    return null;
  }
  return createHash("sha256").update(ip).digest("hex").slice(0, 32);
}

export interface AuditInput {
  eventType: PosAuditEventType;
  entity: PosAuditEntity;
  entityId: string;
  actor: PosActor | null;
  context: PosRequestContext | null;
  operationalDate?: string | null;
  registerId?: string | null;
  sessionId?: string | null;
  shiftId?: string | null;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  result?: PosAuditResult;
  metadata?: Record<string, unknown> | null;
}

function buildEvent(input: AuditInput): Omit<PosAuditEvent, "id"> {
  return {
    storeId: POS_STORE_ID,
    eventType: input.eventType,
    entity: input.entity,
    entityId: input.entityId,
    operationalDate: input.operationalDate ?? null,
    actorUid: input.actor?.uid ?? "anonymous",
    actorRole: input.actor?.posRole ?? null,
    actorBaseRole: input.actor?.baseRole ?? null,
    actorCapabilities: input.actor ? [...input.actor.capabilities] : [],
    requestId: input.context?.requestId ?? null,
    deviceId: input.context?.deviceId ?? null,
    ipHash: input.context?.ipHash ?? null,
    userAgent: input.context?.userAgent
      ? input.context.userAgent.slice(0, MAX_STRING_LENGTH)
      : null,
    registerId: input.registerId ?? null,
    sessionId: input.sessionId ?? null,
    shiftId: input.shiftId ?? null,
    before: sanitizeAuditSnapshot(input.before),
    after: sanitizeAuditSnapshot(input.after),
    reason: input.reason ? input.reason.slice(0, MAX_STRING_LENGTH) : null,
    result: input.result ?? PosAuditResult.SUCCESS,
    metadata: (sanitizeAuditSnapshot(input.metadata ?? null) ??
      null) as Record<string, unknown> | null,
    occurredAt: nowTimestamp(),
  };
}

class PosAuditService {
  async record(input: AuditInput): Promise<PosAuditEvent> {
    return posAuditRepository.append(buildEvent(input));
  }

  /**
   * Registra el evento dentro de la transacción que produjo el efecto, de modo que un
   * rollback nunca deje auditoría de algo que no ocurrió.
   */
  recordInTransaction(
    transaction: FirebaseFirestore.Transaction,
    input: AuditInput,
  ): string {
    return posAuditRepository.appendInTransaction(transaction, buildEvent(input));
  }

  /**
   * Denegaciones de permiso. Se registran best-effort: un fallo al auditar no debe
   * convertir un 403 en un 500 para el cliente.
   */
  async recordDenied(input: Omit<AuditInput, "result">): Promise<void> {
    try {
      await this.record({ ...input, result: PosAuditResult.DENIED });
    } catch (error) {
      console.warn("pos_audit_denied_write_failed", {
        eventType: input.eventType,
        reason: error instanceof Error ? error.message : "unknown",
      });
    }
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
    return posAuditRepository.list(filters);
  }
}

export const posAuditService = new PosAuditService();
export default posAuditService;
