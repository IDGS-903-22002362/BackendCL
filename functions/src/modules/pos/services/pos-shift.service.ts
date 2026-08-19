/**
 * Turnos: inicio, entrega entre cajeros, cierre y cierre forzado.
 *
 * Reglas de concurrencia:
 *
 * - Un cajero no puede tener dos turnos activos: se garantiza con un documento de bloqueo
 *   único `posShiftLocks/{cashierUid}` creado con `transaction.create`.
 * - Una caja no puede tener dos cajeros: `posRegisters.currentShiftId` se valida y escribe
 *   dentro de la misma transacción.
 *
 * Relación entre arqueo y entrega (DEC-14/DEC-15): el corte de turno se calcula al enviar el
 * conteo, con el efectivo esperado de ese instante. La entrega posterior genera un movimiento
 * `SHIFT_HANDOFF` que se aprueba cuando el cajero entrante confirma la recepción, de modo que
 * el ledger refleje que ese efectivo ya no está bajo la responsabilidad del turno anterior.
 */

import { POS_STORE_ID, POS_TEXT_LIMITS } from "../constants/pos.constants";
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
  PosSessionStatus,
  PosShiftStatus,
} from "../models/pos.enums";
import type {
  OperationalDate,
  PosActor,
  PosCashMovement,
  PosPageResult,
  PosRegister,
  PosRegisterSession,
  PosRequestContext,
  PosShift,
  PosShiftTotals,
} from "../models/pos.types";
import {
  nowTimestamp,
  posDoc,
  runPosTransaction,
} from "../repositories/pos-firestore";
import {
  posCashCountRepository,
  posCashMovementRepository,
  posCutRepository,
  posRegisterRepository,
  posSaleRepository,
  posSessionRepository,
  posShiftRepository,
} from "../repositories/pos-operational.repository";
import { posAuditService } from "./pos-audit.service";
import { posAuthorizationService } from "./pos-authorization.service";
import { appendLedgerEntryInTransaction } from "./pos-cash-ledger.service";
import { posIncidentService } from "./pos-incident.service";
import posSettingsService from "./pos-settings.service";

export const EMPTY_SHIFT_TOTALS: PosShiftTotals = Object.freeze({
  salesCount: 0,
  grossSalesMinor: 0,
  discountMinor: 0,
  netSalesMinor: 0,
  cashSalesMinor: 0,
  cardSalesMinor: 0,
  cashRefundsMinor: 0,
  cardRefundsMinor: 0,
  voidedSalesMinor: 0,
  cashInMinor: 0,
  cashOutMinor: 0,
  securityDropsMinor: 0,
  transfersInMinor: 0,
  transfersOutMinor: 0,
  adjustmentsMinor: 0,
});

/** Estados en los que el turno sigue ocupando la caja y el bloqueo del cajero. */
export const OCCUPYING_SHIFT_STATUSES: readonly PosShiftStatus[] = [
  PosShiftStatus.ACTIVE,
  PosShiftStatus.HANDOFF_PENDING,
  PosShiftStatus.COUNTING,
  PosShiftStatus.SUBMITTED,
  PosShiftStatus.SECOND_COUNT_REQUIRED,
  PosShiftStatus.UNDER_REVIEW,
  PosShiftStatus.REJECTED,
  PosShiftStatus.ESCALATED,
];

function shiftLockRef(cashierUid: string): FirebaseFirestore.DocumentReference {
  return posDoc("SHIFT_LOCKS", cashierUid);
}

export interface CreateShiftInTransactionInput {
  session: PosRegisterSession;
  register: PosRegister;
  cashierUid: string;
  cashierName?: string;
  receivedFloatMinor: number;
}

/**
 * Crea el turno y adquiere el bloqueo del cajero dentro de una transacción abierta.
 * Falla con `ACTIVE_SHIFT_EXISTS` si el cajero ya tiene un turno vivo.
 */
export function createShiftInTransaction(
  transaction: FirebaseFirestore.Transaction,
  input: CreateShiftInTransactionInput,
): PosShift {
  const shift = posShiftRepository.createInTransaction(transaction, {
    storeId: POS_STORE_ID,
    sessionId: input.session.id,
    registerId: input.register.id,
    registerCode: input.register.code,
    operationalDate: input.session.operationalDate,
    cashierUid: input.cashierUid,
    cashierName: input.cashierName,
    status: PosShiftStatus.ACTIVE,
    receivedFloatMinor: input.receivedFloatMinor,
    handedOverMinor: null,
    handoffToUid: null,
    handoffRequestedAt: null,
    totals: { ...EMPTY_SHIFT_TOTALS },
    cutId: null,
    supervisorUid: null,
    forced: false,
    closeReason: null,
    startedAt: nowTimestamp(),
    endedAt: null,
  });

  transaction.create(shiftLockRef(input.cashierUid), {
    cashierUid: input.cashierUid,
    shiftId: shift.id,
    registerId: input.register.id,
    sessionId: input.session.id,
    createdAt: nowTimestamp(),
  });

  return shift;
}

/** Libera el bloqueo del cajero. Idempotente: borrar un lock inexistente no falla. */
export function releaseShiftLockInTransaction(
  transaction: FirebaseFirestore.Transaction,
  cashierUid: string,
): void {
  transaction.delete(shiftLockRef(cashierUid));
}

export async function shiftLockExists(cashierUid: string): Promise<boolean> {
  return (await shiftLockRef(cashierUid).get()).exists;
}

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

class PosShiftService {
  /** Turno activo del actor, si existe. Base del contexto del POS. */
  async findMyActiveShift(actor: PosActor): Promise<PosShift | null> {
    return posShiftRepository.findActiveByCashier(actor.uid);
  }

  /**
   * Turno propio y operable. Cualquier operación de venta o efectivo lo exige, de modo que
   * un cajero nunca pueda operar el turno de otro ni un turno ya cerrado.
   */
  async requireOperableShift(actor: PosActor): Promise<PosShift> {
    const shift = await posShiftRepository.findActiveByCashier(actor.uid);
    if (!shift || shift.status !== PosShiftStatus.ACTIVE) {
      throw new PosProblemError("NO_ACTIVE_SHIFT");
    }
    return shift;
  }

  async get(actor: PosActor, shiftId: string): Promise<PosShift> {
    const shift = await posShiftRepository.requireById(shiftId);
    posAuthorizationService.assertCanReadOwned(
      actor,
      shift.cashierUid,
      PosCapability.SHIFT_READ_ALL,
    );
    return shift;
  }

  async list(
    actor: PosActor,
    filters: {
      registerId?: string;
      sessionId?: string;
      cashierUid?: string;
      status?: PosShiftStatus;
      operationalDate?: OperationalDate;
      limit?: number;
      cursor?: string;
    },
  ): Promise<PosPageResult<PosShift>> {
    const settings = await posSettingsService.get();
    const limit = Math.min(
      filters.limit ?? settings.defaultPageSize,
      settings.maxPageSize,
    );

    const cashierUid = posAuthorizationService.scopeCashierFilter(
      actor,
      PosCapability.SHIFT_READ_ALL,
      filters.cashierUid,
    );

    const equals: Array<{ field: string; value: unknown }> = [];
    if (filters.registerId) {
      equals.push({ field: "registerId", value: filters.registerId });
    }
    if (filters.sessionId) {
      equals.push({ field: "sessionId", value: filters.sessionId });
    }
    if (filters.status) equals.push({ field: "status", value: filters.status });
    if (filters.operationalDate) {
      equals.push({ field: "operationalDate", value: filters.operationalDate });
    }
    if (cashierUid) equals.push({ field: "cashierUid", value: cashierUid });

    return posShiftRepository.list({
      limit,
      cursor: filters.cursor,
      orderByField: "startedAt",
      direction: "desc",
      equals,
    });
  }

  /**
   * Inicia un turno en una sesión abierta que no tiene cajero asignado.
   * Ocurre tras completar una entrega o tras un cierre forzado de turno.
   */
  async startShiftInSession(
    actor: PosActor,
    sessionId: string,
    input: { receivedFloatMinor: number; cashierUid?: string },
    context: PosRequestContext | null,
  ): Promise<PosShift> {
    posAuthorizationService.requireCapability(actor, PosCapability.SHIFT_START);

    const settings = await posSettingsService.get();
    const receivedFloatMinor = assertNonNegativeMinor(
      input.receivedFloatMinor,
      "receivedFloatMinor",
    );
    if (receivedFloatMinor > settings.openingFloatMaxMinor) {
      throw new PosProblemError(
        "SALE_LIMIT_EXCEEDED",
        "El fondo recibido excede el límite configurado.",
      );
    }

    // Un cajero solo puede iniciar su propio turno; un supervisor puede asignar a otro.
    const cashierUid = input.cashierUid ?? actor.uid;
    if (
      cashierUid !== actor.uid &&
      !actor.capabilities.includes(PosCapability.SHIFT_READ_ALL)
    ) {
      throw new PosProblemError(
        "POS_PERMISSION_DENIED",
        "No puedes iniciar el turno de otro cajero.",
      );
    }

    const shift = await runPosTransaction(async (transaction) => {
      const session = await posSessionRepository.requireByIdInTransaction(
        transaction,
        sessionId,
      );
      if (session.status !== PosSessionStatus.OPEN) {
        throw new PosProblemError(
          "REGISTER_NOT_OPEN",
          "La sesión de caja no está abierta.",
        );
      }
      if (session.currentShiftId) {
        throw new PosProblemError("ACTIVE_SHIFT_EXISTS");
      }

      const register = await posRegisterRepository.requireByIdInTransaction(
        transaction,
        session.registerId,
      );
      if (register.status !== PosRegisterStatus.OPEN) {
        throw new PosProblemError("REGISTER_NOT_OPEN");
      }
      if (register.currentShiftId) {
        throw new PosProblemError("ACTIVE_SHIFT_EXISTS");
      }

      const created = createShiftInTransaction(transaction, {
        session,
        register,
        cashierUid,
        receivedFloatMinor,
      });

      posSessionRepository.updateInTransaction(
        transaction,
        session.id,
        {
          currentShiftId: created.id,
          shiftIds: [...session.shiftIds, created.id],
        },
        session.version,
      );
      posRegisterRepository.updateInTransaction(
        transaction,
        register.id,
        {
          currentShiftId: created.id,
          currentCashierUid: cashierUid,
          lastActivityAt: nowTimestamp(),
        },
        register.version,
      );

      posAuditService.recordInTransaction(transaction, {
        eventType: PosAuditEventType.SHIFT_STARTED,
        entity: PosAuditEntity.SHIFT,
        entityId: created.id,
        actor,
        context,
        operationalDate: session.operationalDate,
        registerId: register.id,
        sessionId: session.id,
        shiftId: created.id,
        after: {
          cashierUid,
          receivedFloatMinor,
          status: created.status,
        },
      });

      return created;
    });

    return shift;
  }

  /** El cajero saliente declara cuánto entrega y a quién. */
  async requestHandoff(
    actor: PosActor,
    shiftId: string,
    input: { handoffToUid: string; handedOverMinor: number; note?: string },
    context: PosRequestContext | null,
  ): Promise<{ shift: PosShift; movement: PosCashMovement }> {
    posAuthorizationService.requireCapability(actor, PosCapability.SHIFT_HANDOFF);

    const handedOverMinor = assertNonNegativeMinor(
      input.handedOverMinor,
      "handedOverMinor",
    );
    if (input.handoffToUid === actor.uid) {
      throw new PosProblemError(
        "POS_VALIDATION_ERROR",
        "El cajero entrante debe ser distinto del saliente.",
      );
    }

    return runPosTransaction(async (transaction) => {
      const shift = await posShiftRepository.requireByIdInTransaction(
        transaction,
        shiftId,
      );
      if (shift.cashierUid !== actor.uid) {
        throw new PosProblemError("SHIFT_NOT_OWNED");
      }
      const target = assertTransition(
        "shift",
        "request-handoff",
        shift.status,
      ) as PosShiftStatus;

      const session = await posSessionRepository.requireByIdInTransaction(
        transaction,
        shift.sessionId,
      );

      const movement = appendLedgerEntryInTransaction(transaction, {
        registerId: shift.registerId,
        sessionId: shift.sessionId,
        shiftId: shift.id,
        operationalDate: shift.operationalDate,
        type: PosCashMovementType.SHIFT_HANDOFF,
        status: PosCashMovementStatus.PENDING_AUTHORIZATION,
        amountMinor: handedOverMinor,
        reason: "Entrega de efectivo por cambio de cajero",
        description: input.note ?? null,
        requestedBy: actor.uid,
        receivedBy: input.handoffToUid,
      });

      posShiftRepository.updateInTransaction(
        transaction,
        shift.id,
        {
          status: target,
          handedOverMinor,
          handoffToUid: input.handoffToUid,
          handoffRequestedAt: nowTimestamp(),
        },
        shift.version,
      );

      if (session.status === PosSessionStatus.OPEN) {
        const sessionTarget = assertTransition(
          "session",
          "request-handoff",
          session.status,
        ) as PosSessionStatus;
        posSessionRepository.updateInTransaction(
          transaction,
          session.id,
          { status: sessionTarget },
          session.version,
        );
      }

      posAuditService.recordInTransaction(transaction, {
        eventType: PosAuditEventType.SHIFT_HANDOFF_REQUESTED,
        entity: PosAuditEntity.SHIFT,
        entityId: shift.id,
        actor,
        context,
        operationalDate: shift.operationalDate,
        registerId: shift.registerId,
        sessionId: shift.sessionId,
        shiftId: shift.id,
        before: { status: shift.status },
        after: {
          status: target,
          handedOverMinor,
          handoffToUid: input.handoffToUid,
          movementId: movement.id,
        },
      });

      return {
        shift: {
          ...shift,
          status: target,
          handedOverMinor,
          handoffToUid: input.handoffToUid,
          version: shift.version + 1,
        },
        movement,
      };
    });
  }

  /**
   * El cajero entrante confirma la recepción, cierra el turno anterior y abre el suyo.
   * Si el importe confirmado difiere del declarado se levanta una incidencia.
   */
  async completeHandoff(
    actor: PosActor,
    shiftId: string,
    input: { confirmedMinor: number; note?: string },
    context: PosRequestContext | null,
  ): Promise<{ previousShift: PosShift; newShift: PosShift }> {
    posAuthorizationService.requireCapability(actor, PosCapability.SHIFT_HANDOFF);
    posAuthorizationService.requireCapability(actor, PosCapability.SHIFT_START);

    const confirmedMinor = assertNonNegativeMinor(
      input.confirmedMinor,
      "confirmedMinor",
    );

    const result = await runPosTransaction(async (transaction) => {
      const previous = await posShiftRepository.requireByIdInTransaction(
        transaction,
        shiftId,
      );
      if (previous.status !== PosShiftStatus.HANDOFF_PENDING) {
        throw new PosProblemError("HANDOFF_NOT_PENDING");
      }
      if (previous.handoffToUid !== actor.uid) {
        throw new PosProblemError(
          "POS_PERMISSION_DENIED",
          "La entrega está dirigida a otro cajero.",
        );
      }

      const session = await posSessionRepository.requireByIdInTransaction(
        transaction,
        previous.sessionId,
      );
      const register = await posRegisterRepository.requireByIdInTransaction(
        transaction,
        previous.registerId,
      );

      const handoffMovements = await posCashMovementRepository.listByShiftInTransaction(
        transaction,
        previous.id,
      );
      const pendingHandoff = handoffMovements.find(
        (movement) =>
          movement.type === PosCashMovementType.SHIFT_HANDOFF &&
          movement.status === PosCashMovementStatus.PENDING_AUTHORIZATION,
      );
      if (!pendingHandoff) {
        throw new PosProblemError("HANDOFF_NOT_PENDING");
      }

      const previousTarget = assertTransition(
        "shift",
        "complete-handoff",
        previous.status,
      ) as PosShiftStatus;

      // El movimiento pasa a APPROVED: el efectivo deja de pertenecer al turno anterior.
      posCashMovementRepository.updateInTransaction(
        transaction,
        pendingHandoff.id,
        {
          status: PosCashMovementStatus.APPROVED,
          authorizedBy: actor.uid,
          receivedBy: actor.uid,
          receivedAt: nowTimestamp(),
          resolvedAt: nowTimestamp(),
        },
        pendingHandoff.version,
      );

      posShiftRepository.updateInTransaction(
        transaction,
        previous.id,
        {
          status: previousTarget,
          endedAt: nowTimestamp(),
        },
        previous.version,
      );
      releaseShiftLockInTransaction(transaction, previous.cashierUid);

      const newShift = createShiftInTransaction(transaction, {
        session,
        register,
        cashierUid: actor.uid,
        cashierName: actor.name,
        receivedFloatMinor: confirmedMinor,
      });

      posSessionRepository.updateInTransaction(
        transaction,
        session.id,
        {
          status: PosSessionStatus.OPEN,
          currentShiftId: newShift.id,
          shiftIds: [...session.shiftIds, newShift.id],
        },
        session.version,
      );
      posRegisterRepository.updateInTransaction(
        transaction,
        register.id,
        {
          currentShiftId: newShift.id,
          currentCashierUid: actor.uid,
          lastActivityAt: nowTimestamp(),
        },
        register.version,
      );

      posAuditService.recordInTransaction(transaction, {
        eventType: PosAuditEventType.SHIFT_HANDOFF_COMPLETED,
        entity: PosAuditEntity.SHIFT,
        entityId: previous.id,
        actor,
        context,
        operationalDate: previous.operationalDate,
        registerId: previous.registerId,
        sessionId: previous.sessionId,
        shiftId: previous.id,
        before: { status: previous.status },
        after: {
          status: previousTarget,
          declaredMinor: previous.handedOverMinor,
          confirmedMinor,
          newShiftId: newShift.id,
        },
        reason: input.note ?? null,
      });

      return {
        previousShift: {
          ...previous,
          status: previousTarget,
          version: previous.version + 1,
        },
        newShift,
        declaredMinor: previous.handedOverMinor ?? 0,
      };
    });

    const differenceMinor = confirmedMinor - result.declaredMinor;
    if (differenceMinor !== 0) {
      const settings = await posSettingsService.get();
      const magnitude = Math.abs(differenceMinor);
      await posIncidentService.createSystem(
        actor.uid,
        {
          type: PosIncidentType.CASH_DIFFERENCE,
          severity:
            magnitude > settings.supervisorDifferenceLimitMinor
              ? PosIncidentSeverity.HIGH
              : PosIncidentSeverity.MEDIUM,
          operationalDate: result.previousShift.operationalDate,
          description: `Diferencia en entrega de turno: declarado ${result.declaredMinor} centavos, confirmado ${confirmedMinor} centavos.`,
          registerId: result.previousShift.registerId,
          sessionId: result.previousShift.sessionId,
          shiftId: result.previousShift.id,
        },
        actor,
        context,
      );
    }

    return {
      previousShift: result.previousShift,
      newShift: result.newShift,
    };
  }

  /** Cierre normal del turno propio, disponible cuando el corte fue aprobado. */
  async endShift(
    actor: PosActor,
    shiftId: string,
    context: PosRequestContext | null,
  ): Promise<PosShift> {
    posAuthorizationService.requireCapability(actor, PosCapability.SHIFT_END_OWN);

    return runPosTransaction(async (transaction) => {
      const shift = await posShiftRepository.requireByIdInTransaction(
        transaction,
        shiftId,
      );
      if (shift.cashierUid !== actor.uid) {
        throw new PosProblemError("SHIFT_NOT_OWNED");
      }
      const target = assertTransition("shift", "end", shift.status) as PosShiftStatus;

      const session = await posSessionRepository.requireByIdInTransaction(
        transaction,
        shift.sessionId,
      );
      const register = await posRegisterRepository.requireByIdInTransaction(
        transaction,
        shift.registerId,
      );

      posShiftRepository.updateInTransaction(
        transaction,
        shift.id,
        { status: target, endedAt: nowTimestamp() },
        shift.version,
      );
      releaseShiftLockInTransaction(transaction, shift.cashierUid);

      if (session.currentShiftId === shift.id) {
        posSessionRepository.updateInTransaction(
          transaction,
          session.id,
          { currentShiftId: null },
          session.version,
        );
      }
      if (register.currentShiftId === shift.id) {
        posRegisterRepository.updateInTransaction(
          transaction,
          register.id,
          { currentShiftId: null, currentCashierUid: null },
          register.version,
        );
      }

      posAuditService.recordInTransaction(transaction, {
        eventType: PosAuditEventType.SHIFT_ENDED,
        entity: PosAuditEntity.SHIFT,
        entityId: shift.id,
        actor,
        context,
        operationalDate: shift.operationalDate,
        registerId: shift.registerId,
        sessionId: shift.sessionId,
        shiftId: shift.id,
        before: { status: shift.status },
        after: { status: target },
      });

      return { ...shift, status: target, version: shift.version + 1 };
    });
  }

  /**
   * Cierre forzado por un administrador (sesión abandonada, cajero ausente).
   * Requiere motivo y genera incidencia obligatoria.
   */
  async forceCloseShift(
    actor: PosActor,
    shiftId: string,
    reason: string,
    context: PosRequestContext | null,
  ): Promise<PosShift> {
    posAuthorizationService.requireCapability(
      actor,
      PosCapability.REGISTER_FORCE_CLOSE,
    );
    const validReason = assertReason(reason);

    const shift = await runPosTransaction(async (transaction) => {
      const current = await posShiftRepository.requireByIdInTransaction(
        transaction,
        shiftId,
      );
      const target = assertTransition(
        "shift",
        "force-close",
        current.status,
      ) as PosShiftStatus;

      const session = await posSessionRepository.requireByIdInTransaction(
        transaction,
        current.sessionId,
      );
      const register = await posRegisterRepository.requireByIdInTransaction(
        transaction,
        current.registerId,
      );

      posShiftRepository.updateInTransaction(
        transaction,
        current.id,
        {
          status: target,
          forced: true,
          closeReason: validReason,
          endedAt: nowTimestamp(),
          supervisorUid: actor.uid,
        },
        current.version,
      );
      releaseShiftLockInTransaction(transaction, current.cashierUid);

      if (session.currentShiftId === current.id) {
        posSessionRepository.updateInTransaction(
          transaction,
          session.id,
          { currentShiftId: null, status: PosSessionStatus.OPEN },
          session.version,
        );
      }
      if (register.currentShiftId === current.id) {
        posRegisterRepository.updateInTransaction(
          transaction,
          register.id,
          { currentShiftId: null, currentCashierUid: null },
          register.version,
        );
      }

      posAuditService.recordInTransaction(transaction, {
        eventType: PosAuditEventType.SHIFT_FORCE_CLOSED,
        entity: PosAuditEntity.SHIFT,
        entityId: current.id,
        actor,
        context,
        operationalDate: current.operationalDate,
        registerId: current.registerId,
        sessionId: current.sessionId,
        shiftId: current.id,
        before: { status: current.status },
        after: { status: target, forced: true },
        reason: validReason,
      });

      return { ...current, status: target, forced: true, version: current.version + 1 };
    });

    await posIncidentService.createSystem(
      actor.uid,
      {
        type: PosIncidentType.FORCED_CLOSE,
        severity: PosIncidentSeverity.HIGH,
        operationalDate: shift.operationalDate,
        description: `Cierre forzado del turno ${shift.id} del cajero ${shift.cashierUid}. Motivo: ${validReason}`,
        registerId: shift.registerId,
        sessionId: shift.sessionId,
        shiftId: shift.id,
      },
      actor,
      context,
    );

    return shift;
  }

  /**
   * Línea de tiempo del turno: ventas, movimientos, conteos y corte en orden cronológico.
   * Acotada por el turno, nunca por colección completa.
   */
  async getTimeline(
    actor: PosActor,
    shiftId: string,
  ): Promise<{
    shift: PosShift;
    events: Array<{
      at: string;
      kind: "SALE" | "CASH_MOVEMENT" | "CASH_COUNT" | "CUT" | "SHIFT";
      entityId: string;
      summary: string;
      amountMinor: number | null;
      status: string;
    }>;
  }> {
    const shift = await this.get(actor, shiftId);
    const [sales, movements, counts, cut] = await Promise.all([
      posSaleRepository.listByShift(shiftId),
      posCashMovementRepository.listByShift(shiftId),
      posCashCountRepository.listByShift(shiftId),
      posCutRepository.findByShift(shiftId),
    ]);

    const events = [
      {
        at: shift.startedAt.toDate().toISOString(),
        kind: "SHIFT" as const,
        entityId: shift.id,
        summary: `Inicio de turno con fondo recibido`,
        amountMinor: shift.receivedFloatMinor,
        status: shift.status,
      },
      ...sales.map((sale) => ({
        at: sale.createdAt.toDate().toISOString(),
        kind: "SALE" as const,
        entityId: sale.id,
        summary: `Venta ${sale.folio}`,
        amountMinor: sale.totals.totalMinor,
        status: sale.status,
      })),
      ...movements.map((movement) => ({
        at: movement.createdAt.toDate().toISOString(),
        kind: "CASH_MOVEMENT" as const,
        entityId: movement.id,
        summary: `${movement.type} (${movement.direction})`,
        amountMinor: movement.amountMinor,
        status: movement.status,
      })),
      ...counts.map((count) => ({
        at: count.createdAt.toDate().toISOString(),
        kind: "CASH_COUNT" as const,
        entityId: count.id,
        summary: `Arqueo versión ${count.version}`,
        // El total contado solo se revela a quien puede revisar cortes (arqueo ciego).
        amountMinor: actor.capabilities.includes(PosCapability.CUT_REVIEW)
          ? count.countedCashMinor
          : null,
        status: count.status,
      })),
      ...(cut
        ? [
            {
              at: cut.createdAt.toDate().toISOString(),
              kind: "CUT" as const,
              entityId: cut.id,
              summary: `Corte ${cut.folio}`,
              amountMinor: actor.capabilities.includes(PosCapability.CUT_REVIEW)
                ? cut.totals.differenceMinor
                : null,
              status: cut.status,
            },
          ]
        : []),
      ...(shift.endedAt
        ? [
            {
              at: shift.endedAt.toDate().toISOString(),
              kind: "SHIFT" as const,
              entityId: shift.id,
              summary: shift.forced
                ? "Cierre forzado del turno"
                : "Cierre del turno",
              amountMinor: shift.handedOverMinor,
              status: shift.status,
            },
          ]
        : []),
    ].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));

    return { shift, events };
  }
}

export const posShiftService = new PosShiftService();
export default posShiftService;
