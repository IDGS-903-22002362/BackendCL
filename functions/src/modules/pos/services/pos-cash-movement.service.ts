/**
 * Movimientos de efectivo: entradas, salidas, retiros de seguridad, reposiciones,
 * transferencias entre cajas y ajustes autorizados.
 *
 * Reglas estructurales:
 *
 * - El ledger es inmutable en importe, tipo y dirección. Solo cambian el estado y sus fechas.
 *   Una corrección se expresa con una reversa (`reverse`), nunca editando el original.
 * - Ningún actor autoriza lo que él mismo solicitó (`SELF_APPROVAL_FORBIDDEN`).
 * - Un retiro o una transferencia solo afectan el efectivo esperado cuando la contraparte
 *   confirma la recepción. Mientras están `IN_TRANSIT` quedan visibles como pendientes y
 *   bloquean el cierre del día.
 * - Una transferencia genera dos efectos relacionados: `TRANSFER_OUT` en la caja origen y
 *   `TRANSFER_IN` en la caja destino, creados en la misma transacción de confirmación.
 */

import { POS_TEXT_LIMITS } from "../constants/pos.constants";
import { computeExpectedCash } from "../domain/expected-cash";
import { assertNonNegativeMinor } from "../domain/money";
import { assertTransition } from "../domain/state-machines";
import PosProblemError from "../errors/pos-problem.error";
import {
  PosAuditEntity,
  PosAuditEventType,
  PosCapability,
  PosCashMovementStatus,
  PosCashMovementType,
  PosIncidentSeverity,
  PosIncidentType,
  PosRegisterStatus,
  PosShiftStatus,
  REQUESTABLE_CASH_MOVEMENT_TYPES,
} from "../models/pos.enums";
import type {
  OperationalDate,
  PosActor,
  PosCashMovement,
  PosPageResult,
  PosRequestContext,
  PosSettings,
  PosShift,
} from "../models/pos.types";
import { nowTimestamp, runPosTransaction } from "../repositories/pos-firestore";
import {
  posCashMovementRepository,
  posRegisterRepository,
  posShiftRepository,
} from "../repositories/pos-operational.repository";
import { posAuditService } from "./pos-audit.service";
import { posAuthorizationService } from "./pos-authorization.service";
import {
  appendLedgerEntryInTransaction,
  resolveDirection,
} from "./pos-cash-ledger.service";
import { posIncidentService } from "./pos-incident.service";
import posSettingsService from "./pos-settings.service";
import { posShiftService } from "./pos-shift.service";

export interface CreateCashMovementInput {
  type: PosCashMovementType;
  amountMinor: number;
  reason: string;
  description?: string;
  /** Solo para `AUTHORIZED_ADJUSTMENT`; los demás tipos tienen dirección canónica. */
  direction?: "IN" | "OUT";
  /** Obligatorio en `TRANSFER_OUT`. */
  targetRegisterId?: string;
  /** Destinatario declarado de un retiro o entrega. */
  receivedBy?: string;
  reference?: string;
  evidenceUrl?: string;
  /** Un supervisor puede registrar el movimiento sobre el turno de otro cajero. */
  shiftId?: string;
}

export interface CashMovementFilters {
  registerId?: string;
  sessionId?: string;
  shiftId?: string;
  type?: PosCashMovementType;
  status?: PosCashMovementStatus;
  operationalDate?: OperationalDate;
  limit?: number;
  cursor?: string;
}

/** Tipos que salen del cajón y por tanto exigen fondos suficientes al solicitarse. */
const OUTFLOW_TYPES: readonly PosCashMovementType[] = [
  PosCashMovementType.CASH_OUT,
  PosCashMovementType.SECURITY_DROP,
  PosCashMovementType.TRANSFER_OUT,
];

/** Tipos que se despachan físicamente y requieren confirmación de recepción. */
const IN_TRANSIT_TYPES: readonly PosCashMovementType[] = [
  PosCashMovementType.SECURITY_DROP,
  PosCashMovementType.TRANSFER_OUT,
];

function assertReason(reason: string | undefined): string {
  const trimmed = (reason ?? "").trim();
  if (trimmed.length < POS_TEXT_LIMITS.REASON_MIN) {
    throw new PosProblemError(
      "REASON_REQUIRED",
      `El motivo debe tener al menos ${POS_TEXT_LIMITS.REASON_MIN} caracteres.`,
    );
  }
  return trimmed.slice(0, POS_TEXT_LIMITS.REASON_MAX);
}

function limitForType(type: PosCashMovementType, settings: PosSettings): number {
  switch (type) {
    case PosCashMovementType.SECURITY_DROP:
      return settings.securityDropMaxMinor;
    case PosCashMovementType.TRANSFER_OUT:
      return settings.transferMaxMinor;
    default:
      return settings.cashMovementMaxMinor;
  }
}

/** Capacidad exigida según el tipo solicitado. */
function capabilityForType(type: PosCashMovementType): PosCapability {
  switch (type) {
    case PosCashMovementType.SECURITY_DROP:
      return PosCapability.CASH_DROP_REQUEST;
    case PosCashMovementType.TRANSFER_OUT:
      return PosCapability.CASH_TRANSFER_REQUEST;
    case PosCashMovementType.AUTHORIZED_ADJUSTMENT:
      return PosCapability.CASH_MOVEMENT_APPROVE;
    default:
      return PosCapability.CASH_MOVEMENT_CREATE;
  }
}

/** Proyección del turno afectada por cada tipo, para mantener `posShifts.totals` alineado. */
function shiftTotalsField(
  type: PosCashMovementType,
  direction: "IN" | "OUT",
): keyof PosShift["totals"] | null {
  switch (type) {
    case PosCashMovementType.CASH_IN:
    case PosCashMovementType.CASH_REPLENISHMENT:
      return "cashInMinor";
    case PosCashMovementType.CASH_OUT:
      return "cashOutMinor";
    case PosCashMovementType.SECURITY_DROP:
      return "securityDropsMinor";
    case PosCashMovementType.TRANSFER_IN:
      return "transfersInMinor";
    case PosCashMovementType.TRANSFER_OUT:
      return "transfersOutMinor";
    case PosCashMovementType.AUTHORIZED_ADJUSTMENT:
      return direction === "IN" ? "cashInMinor" : "cashOutMinor";
    default:
      return null;
  }
}

class PosCashMovementService {
  // ------------------------------------------------------------------ creación

  async create(
    actor: PosActor,
    input: CreateCashMovementInput,
    idempotencyKeyHash: string | null,
    context: PosRequestContext | null,
  ): Promise<PosCashMovement> {
    if (!REQUESTABLE_CASH_MOVEMENT_TYPES.includes(input.type)) {
      throw new PosProblemError(
        "POS_VALIDATION_ERROR",
        "El tipo de movimiento no puede solicitarse directamente.",
      );
    }
    posAuthorizationService.requireCapability(actor, capabilityForType(input.type));

    const settings = await posSettingsService.get();
    const amountMinor = assertNonNegativeMinor(input.amountMinor, "amountMinor");
    if (amountMinor === 0) {
      throw new PosProblemError(
        "POS_VALIDATION_ERROR",
        "El importe del movimiento debe ser mayor a cero.",
      );
    }
    if (amountMinor > limitForType(input.type, settings)) {
      throw new PosProblemError("CASH_MOVEMENT_LIMIT_EXCEEDED");
    }
    const reason = assertReason(input.reason);
    const direction = resolveDirection({
      type: input.type,
      direction: input.direction,
    });

    if (
      input.type === PosCashMovementType.TRANSFER_OUT &&
      !input.targetRegisterId
    ) {
      throw new PosProblemError(
        "TRANSFER_INVALID_TARGET",
        "Una transferencia requiere la caja destino.",
      );
    }

    const shiftId = await this.resolveShiftId(actor, input.shiftId);

    // Un supervisor puede autoaprobar solo si la política lo permite explícitamente.
    const autoApprove =
      settings.requireSupervisorForCashMovements === false &&
      actor.capabilities.includes(PosCapability.CASH_MOVEMENT_APPROVE);

    const movement = await runPosTransaction(async (transaction) => {
      const shift = await posShiftRepository.requireByIdInTransaction(
        transaction,
        shiftId,
      );
      if (shift.status !== PosShiftStatus.ACTIVE) {
        throw new PosProblemError("NO_ACTIVE_SHIFT");
      }

      if (input.targetRegisterId) {
        await this.assertValidTransferTarget(
          transaction,
          shift.registerId,
          input.targetRegisterId,
        );
      }

      if (OUTFLOW_TYPES.includes(input.type) || direction === "OUT") {
        await this.assertSufficientCashInTransaction(
          transaction,
          shift,
          amountMinor,
        );
      }

      const created = appendLedgerEntryInTransaction(transaction, {
        registerId: shift.registerId,
        sessionId: shift.sessionId,
        shiftId: shift.id,
        operationalDate: shift.operationalDate,
        type: input.type,
        status: autoApprove
          ? PosCashMovementStatus.APPROVED
          : PosCashMovementStatus.PENDING_AUTHORIZATION,
        amountMinor,
        direction: input.direction,
        reason,
        description: input.description ?? null,
        requestedBy: actor.uid,
        authorizedBy: autoApprove ? actor.uid : null,
        receivedBy: input.receivedBy ?? null,
        targetRegisterId: input.targetRegisterId ?? null,
        reference: input.reference ?? null,
        evidenceUrl: input.evidenceUrl ?? null,
        idempotencyKeyHash,
      });

      if (autoApprove) {
        this.applyShiftProjectionInTransaction(transaction, shift, created);
      }

      posAuditService.recordInTransaction(transaction, {
        eventType: autoApprove
          ? PosAuditEventType.CASH_MOVEMENT_APPROVED
          : PosAuditEventType.CASH_MOVEMENT_REQUESTED,
        entity: PosAuditEntity.CASH_MOVEMENT,
        entityId: created.id,
        actor,
        context,
        operationalDate: shift.operationalDate,
        registerId: shift.registerId,
        sessionId: shift.sessionId,
        shiftId: shift.id,
        after: {
          type: created.type,
          direction: created.direction,
          amountMinor: created.amountMinor,
          status: created.status,
          targetRegisterId: created.targetRegisterId,
        },
        reason,
      });

      return created;
    });

    return movement;
  }

  // -------------------------------------------------------- autorización

  async approve(
    actor: PosActor,
    movementId: string,
    note: string | undefined,
    context: PosRequestContext | null,
  ): Promise<PosCashMovement> {
    posAuthorizationService.requireCapability(
      actor,
      PosCapability.CASH_MOVEMENT_APPROVE,
    );

    return runPosTransaction(async (transaction) => {
      const movement = await posCashMovementRepository.requireByIdInTransaction(
        transaction,
        movementId,
      );
      posAuthorizationService.assertNotSelfApproval(actor, movement.requestedBy);
      const target = assertTransition(
        "cashMovement",
        "approve",
        movement.status,
      ) as PosCashMovementStatus;

      const shift = await posShiftRepository.requireByIdInTransaction(
        transaction,
        movement.shiftId,
      );

      posCashMovementRepository.updateInTransaction(
        transaction,
        movement.id,
        {
          status: target,
          authorizedBy: actor.uid,
          resolvedAt: nowTimestamp(),
        },
        movement.version,
      );

      const approved: PosCashMovement = {
        ...movement,
        status: target,
        authorizedBy: actor.uid,
        version: movement.version + 1,
      };

      // Un retiro o transferencia aprobados todavía no mueven el esperado: solo lo hacen al
      // confirmarse la recepción, de modo que la proyección se aplica en ese momento.
      if (!IN_TRANSIT_TYPES.includes(movement.type)) {
        this.applyShiftProjectionInTransaction(transaction, shift, approved);
      }

      posAuditService.recordInTransaction(transaction, {
        eventType: PosAuditEventType.CASH_MOVEMENT_APPROVED,
        entity: PosAuditEntity.CASH_MOVEMENT,
        entityId: movement.id,
        actor,
        context,
        operationalDate: movement.operationalDate,
        registerId: movement.registerId,
        sessionId: movement.sessionId,
        shiftId: movement.shiftId,
        before: { status: movement.status },
        after: { status: target },
        reason: note ?? null,
      });

      return approved;
    });
  }

  async reject(
    actor: PosActor,
    movementId: string,
    reason: string,
    context: PosRequestContext | null,
  ): Promise<PosCashMovement> {
    posAuthorizationService.requireCapability(
      actor,
      PosCapability.CASH_MOVEMENT_APPROVE,
    );
    const validReason = assertReason(reason);

    return runPosTransaction(async (transaction) => {
      const movement = await posCashMovementRepository.requireByIdInTransaction(
        transaction,
        movementId,
      );
      posAuthorizationService.assertNotSelfApproval(actor, movement.requestedBy);
      const target = assertTransition(
        "cashMovement",
        "reject",
        movement.status,
      ) as PosCashMovementStatus;

      posCashMovementRepository.updateInTransaction(
        transaction,
        movement.id,
        {
          status: target,
          authorizedBy: actor.uid,
          resolvedAt: nowTimestamp(),
          description: movement.description ?? null,
        },
        movement.version,
      );

      posAuditService.recordInTransaction(transaction, {
        eventType: PosAuditEventType.CASH_MOVEMENT_REJECTED,
        entity: PosAuditEntity.CASH_MOVEMENT,
        entityId: movement.id,
        actor,
        context,
        operationalDate: movement.operationalDate,
        registerId: movement.registerId,
        sessionId: movement.sessionId,
        shiftId: movement.shiftId,
        before: { status: movement.status },
        after: { status: target },
        reason: validReason,
      });

      return {
        ...movement,
        status: target,
        authorizedBy: actor.uid,
        version: movement.version + 1,
      };
    });
  }

  /** Cancelación por el solicitante antes de que el movimiento surta efecto. */
  async cancel(
    actor: PosActor,
    movementId: string,
    reason: string,
    context: PosRequestContext | null,
  ): Promise<PosCashMovement> {
    posAuthorizationService.requireCapability(
      actor,
      PosCapability.CASH_MOVEMENT_CREATE,
    );
    const validReason = assertReason(reason);

    return runPosTransaction(async (transaction) => {
      const movement = await posCashMovementRepository.requireByIdInTransaction(
        transaction,
        movementId,
      );
      if (
        movement.requestedBy !== actor.uid &&
        !actor.capabilities.includes(PosCapability.CASH_MOVEMENT_APPROVE)
      ) {
        throw new PosProblemError("POS_RESOURCE_NOT_FOUND");
      }
      const target = assertTransition(
        "cashMovement",
        "cancel",
        movement.status,
      ) as PosCashMovementStatus;

      // Si ya estaba aprobado y afectaba el cajón, la proyección debe deshacerse.
      if (
        movement.status === PosCashMovementStatus.APPROVED &&
        !IN_TRANSIT_TYPES.includes(movement.type)
      ) {
        const shift = await posShiftRepository.requireByIdInTransaction(
          transaction,
          movement.shiftId,
        );
        this.applyShiftProjectionInTransaction(transaction, shift, movement, -1);
      }

      posCashMovementRepository.updateInTransaction(
        transaction,
        movement.id,
        { status: target, resolvedAt: nowTimestamp() },
        movement.version,
      );

      posAuditService.recordInTransaction(transaction, {
        eventType: PosAuditEventType.CASH_MOVEMENT_CANCELLED,
        entity: PosAuditEntity.CASH_MOVEMENT,
        entityId: movement.id,
        actor,
        context,
        operationalDate: movement.operationalDate,
        registerId: movement.registerId,
        sessionId: movement.sessionId,
        shiftId: movement.shiftId,
        before: { status: movement.status },
        after: { status: target },
        reason: validReason,
      });

      return { ...movement, status: target, version: movement.version + 1 };
    });
  }

  // ------------------------------------------------------ entrega y recepción

  /** El efectivo sale físicamente de la caja: retiro al concentrador o a otra caja. */
  async confirmDelivery(
    actor: PosActor,
    movementId: string,
    context: PosRequestContext | null,
  ): Promise<PosCashMovement> {
    return runPosTransaction(async (transaction) => {
      const movement = await posCashMovementRepository.requireByIdInTransaction(
        transaction,
        movementId,
      );
      if (!IN_TRANSIT_TYPES.includes(movement.type)) {
        throw new PosProblemError(
          "INVALID_STATE_TRANSITION",
          "Solo los retiros y las transferencias se despachan.",
        );
      }
      posAuthorizationService.requireCapability(
        actor,
        movement.type === PosCashMovementType.SECURITY_DROP
          ? PosCapability.CASH_DROP_REQUEST
          : PosCapability.CASH_TRANSFER_REQUEST,
      );
      if (
        movement.requestedBy !== actor.uid &&
        !actor.capabilities.includes(PosCapability.CASH_MOVEMENT_APPROVE)
      ) {
        throw new PosProblemError("POS_RESOURCE_NOT_FOUND");
      }
      const target = assertTransition(
        "cashMovement",
        "confirm-delivery",
        movement.status,
      ) as PosCashMovementStatus;

      posCashMovementRepository.updateInTransaction(
        transaction,
        movement.id,
        { status: target, dispatchedAt: nowTimestamp() },
        movement.version,
      );

      posAuditService.recordInTransaction(transaction, {
        eventType: PosAuditEventType.CASH_TRANSFER_DISPATCHED,
        entity: PosAuditEntity.CASH_MOVEMENT,
        entityId: movement.id,
        actor,
        context,
        operationalDate: movement.operationalDate,
        registerId: movement.registerId,
        sessionId: movement.sessionId,
        shiftId: movement.shiftId,
        before: { status: movement.status },
        after: { status: target },
      });

      return { ...movement, status: target, version: movement.version + 1 };
    });
  }

  /**
   * Cierra el circuito. En una transferencia crea el `TRANSFER_IN` de la caja destino en la
   * misma transacción, de modo que nunca exista una caja que descuenta sin que otra reciba.
   */
  async confirmReceipt(
    actor: PosActor,
    movementId: string,
    input: { confirmedMinor?: number; note?: string },
    context: PosRequestContext | null,
  ): Promise<{ movement: PosCashMovement; counterpart: PosCashMovement | null }> {
    const result = await runPosTransaction(async (transaction) => {
      const movement = await posCashMovementRepository.requireByIdInTransaction(
        transaction,
        movementId,
      );
      if (!IN_TRANSIT_TYPES.includes(movement.type)) {
        throw new PosProblemError(
          "INVALID_STATE_TRANSITION",
          "Solo los retiros y las transferencias se confirman como recibidos.",
        );
      }
      posAuthorizationService.requireCapability(
        actor,
        movement.type === PosCashMovementType.SECURITY_DROP
          ? PosCapability.CASH_DROP_APPROVE
          : PosCapability.CASH_TRANSFER_CONFIRM,
      );
      // Quien entrega no puede confirmar que él mismo recibió.
      posAuthorizationService.assertNotSelfApproval(actor, movement.requestedBy);

      const target = assertTransition(
        "cashMovement",
        "confirm-receipt",
        movement.status,
      ) as PosCashMovementStatus;

      const sourceShift = await posShiftRepository.requireByIdInTransaction(
        transaction,
        movement.shiftId,
      );

      let counterpart: PosCashMovement | null = null;
      let targetShift: PosShift | null = null;

      if (movement.type === PosCashMovementType.TRANSFER_OUT) {
        if (!movement.targetRegisterId) {
          throw new PosProblemError("TRANSFER_INVALID_TARGET");
        }
        const targetRegister = await posRegisterRepository.requireByIdInTransaction(
          transaction,
          movement.targetRegisterId,
        );
        if (
          targetRegister.status !== PosRegisterStatus.OPEN ||
          !targetRegister.currentShiftId
        ) {
          throw new PosProblemError(
            "TRANSFER_INVALID_TARGET",
            "La caja destino no tiene un turno activo que pueda recibir el efectivo.",
          );
        }
        targetShift = await posShiftRepository.requireByIdInTransaction(
          transaction,
          targetRegister.currentShiftId,
        );
        if (targetShift.cashierUid !== actor.uid) {
          throw new PosProblemError(
            "POS_PERMISSION_DENIED",
            "Solo el cajero del turno destino puede confirmar la recepción.",
          );
        }
      }

      posCashMovementRepository.updateInTransaction(
        transaction,
        movement.id,
        {
          status: target,
          receivedBy: actor.uid,
          receivedAt: nowTimestamp(),
          resolvedAt: nowTimestamp(),
          targetShiftId: targetShift?.id ?? null,
        },
        movement.version,
      );

      const received: PosCashMovement = {
        ...movement,
        status: target,
        receivedBy: actor.uid,
        targetShiftId: targetShift?.id ?? null,
        version: movement.version + 1,
      };

      // La salida ya es efectiva en la caja origen.
      this.applyShiftProjectionInTransaction(transaction, sourceShift, received);

      if (targetShift) {
        counterpart = appendLedgerEntryInTransaction(transaction, {
          registerId: targetShift.registerId,
          sessionId: targetShift.sessionId,
          shiftId: targetShift.id,
          operationalDate: targetShift.operationalDate,
          type: PosCashMovementType.TRANSFER_IN,
          status: PosCashMovementStatus.RECEIVED,
          amountMinor: movement.amountMinor,
          reason: `Recepción de transferencia desde la caja ${movement.registerId}`,
          description: input.note ?? null,
          requestedBy: movement.requestedBy,
          authorizedBy: movement.authorizedBy ?? null,
          receivedBy: actor.uid,
          targetRegisterId: movement.registerId,
          linkedMovementId: movement.id,
          reference: movement.reference ?? null,
        });
        this.applyShiftProjectionInTransaction(
          transaction,
          targetShift,
          counterpart,
        );
      }

      posAuditService.recordInTransaction(transaction, {
        eventType: PosAuditEventType.CASH_TRANSFER_COMPLETED,
        entity: PosAuditEntity.CASH_MOVEMENT,
        entityId: movement.id,
        actor,
        context,
        operationalDate: movement.operationalDate,
        registerId: movement.registerId,
        sessionId: movement.sessionId,
        shiftId: movement.shiftId,
        before: { status: movement.status },
        after: {
          status: target,
          counterpartMovementId: counterpart?.id ?? null,
          confirmedMinor: input.confirmedMinor ?? movement.amountMinor,
        },
        reason: input.note ?? null,
      });

      return {
        movement: received,
        counterpart,
        declaredMinor: movement.amountMinor,
        operationalDate: movement.operationalDate,
      };
    });

    // Un importe confirmado distinto al despachado no puede alterar el ledger: se registra
    // como incidencia para seguimiento y, si procede, se corrige con una reversa más ajuste.
    const confirmedMinor = input.confirmedMinor;
    if (confirmedMinor !== undefined && confirmedMinor !== result.declaredMinor) {
      await posIncidentService.createSystem(
        actor.uid,
        {
          type: PosIncidentType.SECURITY_DROP_ISSUE,
          severity: PosIncidentSeverity.HIGH,
          operationalDate: result.operationalDate,
          description: `Diferencia al confirmar el movimiento ${result.movement.id}: despachado ${result.declaredMinor} centavos, confirmado ${confirmedMinor} centavos.`,
          registerId: result.movement.registerId,
          sessionId: result.movement.sessionId,
          shiftId: result.movement.shiftId,
          cashMovementId: result.movement.id,
        },
        actor,
        context,
      );
    }

    return { movement: result.movement, counterpart: result.counterpart };
  }

  // ------------------------------------------------------------------ reversas

  /**
   * Corrección de un movimiento ya efectivo. No edita el original: crea un ajuste autorizado
   * con la dirección opuesta y lo enlaza mediante `reversalOfMovementId`.
   */
  async reverse(
    actor: PosActor,
    movementId: string,
    reason: string,
    context: PosRequestContext | null,
  ): Promise<PosCashMovement> {
    posAuthorizationService.requireCapability(
      actor,
      PosCapability.CASH_MOVEMENT_APPROVE,
    );
    const validReason = assertReason(reason);

    return runPosTransaction(async (transaction) => {
      const original = await posCashMovementRepository.requireByIdInTransaction(
        transaction,
        movementId,
      );
      if (
        original.status !== PosCashMovementStatus.APPROVED &&
        original.status !== PosCashMovementStatus.RECEIVED
      ) {
        throw new PosProblemError(
          "CASH_MOVEMENT_NOT_PENDING",
          "Solo un movimiento efectivo puede revertirse.",
        );
      }

      const existing = await posCashMovementRepository.listByShiftInTransaction(
        transaction,
        original.shiftId,
      );
      if (
        existing.some((entry) => entry.reversalOfMovementId === original.id)
      ) {
        throw new PosProblemError(
          "CASH_MOVEMENT_NOT_PENDING",
          "El movimiento ya tiene una reversa registrada.",
        );
      }

      const shift = await posShiftRepository.requireByIdInTransaction(
        transaction,
        original.shiftId,
      );

      const reversal = appendLedgerEntryInTransaction(transaction, {
        registerId: original.registerId,
        sessionId: original.sessionId,
        shiftId: original.shiftId,
        operationalDate: original.operationalDate,
        type: PosCashMovementType.AUTHORIZED_ADJUSTMENT,
        status: PosCashMovementStatus.APPROVED,
        amountMinor: original.amountMinor,
        direction: original.direction === "IN" ? "OUT" : "IN",
        reason: `Reversa de ${original.type}: ${validReason}`,
        requestedBy: actor.uid,
        authorizedBy: actor.uid,
        reversalOfMovementId: original.id,
        linkedMovementId: original.id,
      });

      this.applyShiftProjectionInTransaction(transaction, shift, reversal);

      posAuditService.recordInTransaction(transaction, {
        eventType: PosAuditEventType.CASH_MOVEMENT_APPROVED,
        entity: PosAuditEntity.CASH_MOVEMENT,
        entityId: reversal.id,
        actor,
        context,
        operationalDate: original.operationalDate,
        registerId: original.registerId,
        sessionId: original.sessionId,
        shiftId: original.shiftId,
        after: {
          type: reversal.type,
          direction: reversal.direction,
          amountMinor: reversal.amountMinor,
          reversalOfMovementId: original.id,
        },
        reason: validReason,
      });

      return reversal;
    });
  }

  // ------------------------------------------------------------------ consulta

  async get(actor: PosActor, movementId: string): Promise<PosCashMovement> {
    const movement = await posCashMovementRepository.requireById(movementId);
    if (
      !actor.capabilities.includes(PosCapability.SHIFT_READ_ALL) &&
      movement.requestedBy !== actor.uid &&
      movement.receivedBy !== actor.uid
    ) {
      const shift = await posShiftRepository.getById(movement.shiftId);
      if (!shift || shift.cashierUid !== actor.uid) {
        throw new PosProblemError("POS_RESOURCE_NOT_FOUND");
      }
    }
    return movement;
  }

  async list(
    actor: PosActor,
    filters: CashMovementFilters,
  ): Promise<PosPageResult<PosCashMovement>> {
    const settings = await posSettingsService.get();
    const limit = Math.min(
      filters.limit ?? settings.defaultPageSize,
      settings.maxPageSize,
    );

    const equals: Array<{ field: string; value: unknown }> = [];
    if (filters.registerId) {
      equals.push({ field: "registerId", value: filters.registerId });
    }
    if (filters.sessionId) {
      equals.push({ field: "sessionId", value: filters.sessionId });
    }
    if (filters.type) equals.push({ field: "type", value: filters.type });
    if (filters.status) equals.push({ field: "status", value: filters.status });
    if (filters.operationalDate) {
      equals.push({ field: "operationalDate", value: filters.operationalDate });
    }

    // Sin lectura global, el alcance se limita a un turno propio.
    let shiftId = filters.shiftId;
    if (!actor.capabilities.includes(PosCapability.SHIFT_READ_ALL)) {
      if (shiftId) {
        const shift = await posShiftRepository.requireById(shiftId);
        if (shift.cashierUid !== actor.uid) {
          throw new PosProblemError("POS_RESOURCE_NOT_FOUND");
        }
      } else {
        const own = await posShiftService.findMyActiveShift(actor);
        if (!own) {
          return { items: [], nextCursor: null, hasMore: false };
        }
        shiftId = own.id;
      }
    }
    if (shiftId) {
      return posCashMovementRepository.listPageForShift({
        shiftId,
        type: filters.type,
        status: filters.status,
        limit,
      });
    }

    return posCashMovementRepository.list({
      limit,
      cursor: filters.cursor,
      orderByField: "createdAt",
      direction: "desc",
      equals,
    });
  }

  /**
   * Efectivo esperado de un turno reconstruido desde el ledger.
   *
   * No aplica arqueo ciego por sí mismo: la capa que lo llama decide si el resultado puede
   * revelarse al actor.
   */
  async expectedCashForShift(shift: PosShift): Promise<number> {
    const movements = await posCashMovementRepository.listByShift(shift.id);
    return computeExpectedCash({
      openingFloatMinor: shift.receivedFloatMinor,
      movements,
    }).expectedCashMinor;
  }

  // ------------------------------------------------------------------ internos

  private async resolveShiftId(
    actor: PosActor,
    requestedShiftId: string | undefined,
  ): Promise<string> {
    if (!requestedShiftId) {
      const own = await posShiftService.requireOperableShift(actor);
      return own.id;
    }
    const shift = await posShiftRepository.requireById(requestedShiftId);
    if (
      shift.cashierUid !== actor.uid &&
      !actor.capabilities.includes(PosCapability.CASH_MOVEMENT_APPROVE)
    ) {
      throw new PosProblemError("SHIFT_NOT_OWNED");
    }
    return shift.id;
  }

  private async assertValidTransferTarget(
    transaction: FirebaseFirestore.Transaction,
    sourceRegisterId: string,
    targetRegisterId: string,
  ): Promise<void> {
    if (sourceRegisterId === targetRegisterId) {
      throw new PosProblemError(
        "TRANSFER_INVALID_TARGET",
        "La caja destino debe ser distinta de la caja origen.",
      );
    }
    const target = await posRegisterRepository.getByIdInTransaction(
      transaction,
      targetRegisterId,
    );
    if (!target || target.archived) {
      throw new PosProblemError("TRANSFER_INVALID_TARGET");
    }
  }

  /** Impide que el cajón quede en negativo por una salida mayor al efectivo disponible. */
  private async assertSufficientCashInTransaction(
    transaction: FirebaseFirestore.Transaction,
    shift: PosShift,
    amountMinor: number,
  ): Promise<void> {
    const movements = await posCashMovementRepository.listByShiftInTransaction(
      transaction,
      shift.id,
    );
    const { expectedCashMinor } = computeExpectedCash({
      openingFloatMinor: shift.receivedFloatMinor,
      movements,
    });
    if (amountMinor > expectedCashMinor) {
      throw new PosProblemError(
        "CASH_MOVEMENT_LIMIT_EXCEEDED",
        "El importe excede el efectivo disponible en la caja.",
      );
    }
  }

  /**
   * Actualiza la proyección acumulada del turno. El ledger sigue siendo la fuente de verdad:
   * esta proyección existe solo para reportes rápidos y siempre se puede reconstruir con
   * `computeExpectedCash`.
   */
  private applyShiftProjectionInTransaction(
    transaction: FirebaseFirestore.Transaction,
    shift: PosShift,
    movement: Pick<PosCashMovement, "type" | "direction" | "amountMinor">,
    sign: 1 | -1 = 1,
  ): void {
    const field = shiftTotalsField(movement.type, movement.direction);
    if (!field) {
      return;
    }
    const totals = {
      ...shift.totals,
      [field]: shift.totals[field] + sign * movement.amountMinor,
    };
    posShiftRepository.updateInTransaction(
      transaction,
      shift.id,
      { totals },
      shift.version,
    );
    // La versión local avanza para que dos proyecciones en la misma transacción no
    // usen la misma versión esperada.
    shift.version += 1;
    shift.totals = totals;
  }
}

export const posCashMovementService = new PosCashMovementService();
export default posCashMovementService;
