/**
 * Escritura del ledger de efectivo.
 *
 * Único punto donde se crean movimientos: apertura de caja, ventas en efectivo, reembolsos,
 * entregas de turno, entradas/salidas, retiros y transferencias. Los movimientos son
 * inmutables en importe y tipo; una corrección se expresa con una reversa más un ajuste.
 */

import { POS_STORE_ID, POS_TEXT_LIMITS } from "../constants/pos.constants";
import { cashMovementDirection } from "../domain/expected-cash";
import { assertNonNegativeMinor } from "../domain/money";
import PosProblemError from "../errors/pos-problem.error";
import {
  PosCashMovementStatus,
  PosCashMovementType,
} from "../models/pos.enums";
import type {
  OperationalDate,
  PosCashMovement,
} from "../models/pos.types";
import { nowTimestamp } from "../repositories/pos-firestore";
import { posCashMovementRepository } from "../repositories/pos-operational.repository";

export interface LedgerEntryInput {
  registerId: string;
  sessionId: string;
  shiftId: string;
  operationalDate: OperationalDate;
  type: PosCashMovementType;
  status: PosCashMovementStatus;
  amountMinor: number;
  reason: string;
  description?: string | null;
  requestedBy: string;
  authorizedBy?: string | null;
  receivedBy?: string | null;
  saleId?: string | null;
  returnId?: string | null;
  paymentId?: string | null;
  targetRegisterId?: string | null;
  targetShiftId?: string | null;
  linkedMovementId?: string | null;
  reversalOfMovementId?: string | null;
  evidenceUrl?: string | null;
  reference?: string | null;
  idempotencyKeyHash?: string | null;
  /** Dirección explícita, obligatoria solo para ajustes autorizados. */
  direction?: "IN" | "OUT";
}

/** Dirección definitiva del movimiento. Los ajustes son los únicos bidireccionales. */
export function resolveDirection(input: {
  type: PosCashMovementType;
  direction?: "IN" | "OUT";
}): "IN" | "OUT" {
  const canonical = cashMovementDirection(input.type);
  if (canonical !== "EITHER") {
    return canonical;
  }
  if (!input.direction) {
    throw new PosProblemError(
      "POS_VALIDATION_ERROR",
      "Un ajuste autorizado requiere indicar la dirección IN u OUT.",
    );
  }
  return input.direction;
}

export function buildLedgerEntry(
  input: LedgerEntryInput,
): Omit<PosCashMovement, "id" | "createdAt" | "updatedAt" | "version"> {
  assertNonNegativeMinor(input.amountMinor, "amountMinor");
  if (input.amountMinor === 0) {
    throw new PosProblemError(
      "POS_VALIDATION_ERROR",
      "El importe del movimiento debe ser mayor a cero.",
    );
  }

  const reason = input.reason.trim();
  if (reason.length < POS_TEXT_LIMITS.REASON_MIN) {
    throw new PosProblemError(
      "REASON_REQUIRED",
      `El motivo debe tener al menos ${POS_TEXT_LIMITS.REASON_MIN} caracteres.`,
    );
  }

  return {
    storeId: POS_STORE_ID,
    registerId: input.registerId,
    sessionId: input.sessionId,
    shiftId: input.shiftId,
    operationalDate: input.operationalDate,
    type: input.type,
    status: input.status,
    amountMinor: input.amountMinor,
    direction: resolveDirection(input),
    reason: reason.slice(0, POS_TEXT_LIMITS.REASON_MAX),
    description: input.description
      ? input.description.slice(0, POS_TEXT_LIMITS.DESCRIPTION_MAX)
      : null,
    requestedBy: input.requestedBy,
    authorizedBy: input.authorizedBy ?? null,
    receivedBy: input.receivedBy ?? null,
    saleId: input.saleId ?? null,
    returnId: input.returnId ?? null,
    paymentId: input.paymentId ?? null,
    targetRegisterId: input.targetRegisterId ?? null,
    targetShiftId: input.targetShiftId ?? null,
    linkedMovementId: input.linkedMovementId ?? null,
    reversalOfMovementId: input.reversalOfMovementId ?? null,
    evidenceUrl: input.evidenceUrl ?? null,
    reference: input.reference ?? null,
    idempotencyKeyHash: input.idempotencyKeyHash ?? null,
    dispatchedAt: null,
    receivedAt:
      input.status === PosCashMovementStatus.RECEIVED ? nowTimestamp() : null,
    resolvedAt:
      input.status === PosCashMovementStatus.APPROVED ||
      input.status === PosCashMovementStatus.RECEIVED
        ? nowTimestamp()
        : null,
  };
}

/** Crea el movimiento dentro de una transacción ya abierta. */
export function appendLedgerEntryInTransaction(
  transaction: FirebaseFirestore.Transaction,
  input: LedgerEntryInput,
): PosCashMovement {
  return posCashMovementRepository.createInTransaction(
    transaction,
    buildLedgerEntry(input),
  );
}

export async function appendLedgerEntry(
  input: LedgerEntryInput,
): Promise<PosCashMovement> {
  return posCashMovementRepository.create(buildLedgerEntry(input));
}
