/**
 * Cortes de turno y conciliación de caja.
 *
 * - Al iniciar el arqueo el turno pasa a `COUNTING`; en ese estado no pueden crearse ventas,
 *   pagos ni movimientos nuevos, así que las fuentes del corte quedan congeladas.
 * - El envío del conteo cierra el corte de forma autónoma (`APPROVED`) sin exigir un
 *   supervisor. Los totales se revelan al dueño del turno y a quien tenga `cut.read_all`.
 * - Cada conteo es una versión nueva e inmutable (`posCashCounts.version`).
 * - Los movimientos de efectivo se releen dentro de la transacción de envío porque una
 *   transferencia entrante puede confirmarse mientras el turno cuenta.
 */

import { POS_STORE_ID, POS_TEXT_LIMITS } from "../constants/pos.constants";
import { roleAtLeast } from "../domain/capabilities";
import {
  resolveCountedCash,
  type DenominationInput,
} from "../domain/cash-count";
import {
  canRevealCutResult,
  classifyCutDifference,
} from "../domain/cut-classification";
import { computeCutTotals, mergeCutTotals } from "../domain/cut-totals";
import { computeExpectedCash } from "../domain/expected-cash";
import { assertTransition } from "../domain/state-machines";
import PosProblemError from "../errors/pos-problem.error";
import {
  PosAuditEntity,
  PosAuditEventType,
  PosCapability,
  PosCashCountStatus,
  PosCutClassification,
  PosCutScope,
  PosCutStatus,
  PosDailyCloseStatus,
  PosIncidentSeverity,
  PosIncidentType,
  PosRole,
  PosSessionStatus,
  PosShiftStatus,
} from "../models/pos.enums";
import type {
  OperationalDate,
  PosActor,
  PosCashCount,
  PosCut,
  PosCutTotals,
  PosCutVersion,
  PosPageResult,
  PosRequestContext,
  PosSettings,
} from "../models/pos.types";
import { POS_METRICS, posMetric } from "../observability/pos-logger";
import { nowTimestamp, runPosTransaction } from "../repositories/pos-firestore";
import {
  posCashCountRepository,
  posCashMovementRepository,
  posCutRepository,
  posCutVersionRepository,
  posDailyCloseRepository,
  posPaymentRepository,
  posReturnRepository,
  posSaleRepository,
  posSessionRepository,
  posShiftRepository,
} from "../repositories/pos-operational.repository";
import { posAuditService } from "./pos-audit.service";
import { posAuthorizationService } from "./pos-authorization.service";
import { posFolioService } from "./pos-folio.service";
import { posIncidentService } from "./pos-incident.service";
import posSettingsService from "./pos-settings.service";

export interface SubmitCashCountInput {
  denominations?: readonly DenominationInput[];
  countedCashMinor?: number;
  note?: string;
  witnessUid?: string;
}

/** Vista del corte con los importes sensibles ocultos cuando el actor no puede verlos. */
export interface CutView extends Omit<PosCut, "totals"> {
  totals: PosCutTotals | null;
  blindForActor: boolean;
}

export interface CashCountView extends Omit<PosCashCount, "countedCashMinor"> {
  countedCashMinor: number | null;
  blindForActor: boolean;
}

export interface CutPreview {
  cut: CutView | null;
  shiftId: string;
  registerId: string;
  registerCode: string;
  sessionId: string;
  cashierUid: string;
  operationalDate: OperationalDate;
  shiftStatus: PosShiftStatus;
  startedAt: ReturnType<typeof nowTimestamp> | unknown;
  receivedFloatMinor: number;
  blocking: {
    pendingSales: number;
    unresolvedMovements: number;
    canStartOrContinue: boolean;
    messages: string[];
  };
  totals: PosCutTotals;
}

const EMPTY_CUT_TOTALS: PosCutTotals = Object.freeze({
  openingFloatMinor: 0,
  salesCount: 0,
  grossSalesMinor: 0,
  discountMinor: 0,
  netSalesMinor: 0,
  cancelledCount: 0,
  voidedMinor: 0,
  returnsCount: 0,
  refundsMinor: 0,
  cashRefundsMinor: 0,
  cardRefundsMinor: 0,
  cashInMinor: 0,
  cashOutMinor: 0,
  securityDropsMinor: 0,
  transfersInMinor: 0,
  transfersOutMinor: 0,
  adjustmentsMinor: 0,
  paymentBreakdown: [],
  expectedCashMinor: 0,
  countedCashMinor: 0,
  differenceMinor: 0,
});

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

function thresholdsFrom(settings: PosSettings) {
  return {
    cutToleranceMinor: settings.cutToleranceMinor,
    supervisorDifferenceLimitMinor: settings.supervisorDifferenceLimitMinor,
    adminDifferenceLimitMinor: settings.adminDifferenceLimitMinor,
  };
}

function severityFor(rank: string): PosIncidentSeverity {
  switch (rank) {
    case "CRITICAL":
      return PosIncidentSeverity.CRITICAL;
    case "HIGH":
      return PosIncidentSeverity.HIGH;
    case "MEDIUM":
      return PosIncidentSeverity.MEDIUM;
    default:
      return PosIncidentSeverity.LOW;
  }
}

class PosCutService {
  // ------------------------------------------------------------ arqueo ciego

  /**
   * Inicia el arqueo del turno propio. Congela las fuentes del corte y crea el corte en
   * `COUNTING`. Exige que no queden ventas ni movimientos sin resolver.
   */
  async startCount(
    actor: PosActor,
    shiftId: string,
    context: PosRequestContext | null,
  ): Promise<CutView> {
    posAuthorizationService.requireCapability(actor, PosCapability.CUT_CREATE_OWN);

    const shift = await posShiftRepository.requireById(shiftId);
    if (shift.cashierUid !== actor.uid) {
      throw new PosProblemError("SHIFT_NOT_OWNED");
    }

    const [pendingSales, unresolvedMovements] = await Promise.all([
      posSaleRepository.countPendingByShift(shift.id),
      posCashMovementRepository.countUnresolvedByShift(shift.id),
    ]);
    if (pendingSales > 0) {
      throw new PosProblemError(
        "SHIFT_HAS_PENDING_WORK",
        "El turno tiene ventas en proceso o suspendidas. Resuélvelas antes del arqueo.",
      );
    }
    if (unresolvedMovements > 0) {
      throw new PosProblemError(
        "SHIFT_HAS_PENDING_WORK",
        "El turno tiene movimientos de efectivo pendientes o en tránsito.",
      );
    }

    const cut = await runPosTransaction(async (transaction) => {
      const current = await posShiftRepository.requireByIdInTransaction(
        transaction,
        shift.id,
      );

      // Idempotente: si el turno ya está contando, devolver el corte actual.
      if (current.status === PosShiftStatus.COUNTING) {
        const existingCounting = await posCutRepository.findByShiftInTransaction(
          transaction,
          current.id,
        );
        if (existingCounting) {
          return existingCounting;
        }
      }

      const shiftTarget = assertTransition(
        "shift",
        "start-count",
        current.status,
      ) as PosShiftStatus;

      const session = await posSessionRepository.requireByIdInTransaction(
        transaction,
        current.sessionId,
      );
      const existing = await posCutRepository.findByShiftInTransaction(
        transaction,
        current.id,
      );
      const folioValue = existing
        ? 0
        : await posFolioService.readValueInTransaction(
            transaction,
            "CUT",
            current.operationalDate,
            current.registerCode,
          );

      let resolved: PosCut;
      if (existing) {
        const cutTarget = assertTransition(
          "cut",
          "start-count",
          existing.status,
        ) as PosCutStatus;
        posCutRepository.updateInTransaction(
          transaction,
          existing.id,
          { status: cutTarget },
          existing.version,
        );
        resolved = { ...existing, status: cutTarget, version: existing.version + 1 };
      } else {
        const folio = posFolioService.reserveInTransaction(
          transaction,
          "CUT",
          current.operationalDate,
          folioValue,
          current.registerCode,
        );
        resolved = posCutRepository.createInTransaction(transaction, {
          storeId: POS_STORE_ID,
          folio,
          scope: PosCutScope.SHIFT,
          operationalDate: current.operationalDate,
          registerId: current.registerId,
          registerCode: current.registerCode,
          sessionId: current.sessionId,
          shiftId: current.id,
          cashierUid: current.cashierUid,
          status: PosCutStatus.COUNTING,
          classification: PosCutClassification.BALANCED,
          toleranceMinor: 0,
          requiredApproverRole: PosRole.SUPERVISOR,
          totals: { ...EMPTY_CUT_TOTALS, openingFloatMinor: current.receivedFloatMinor },
          cashCountId: null,
          cashCountVersion: 0,
          observations: null,
          clarificationRequest: null,
          clarificationResponse: null,
          rejectionReason: null,
          escalationReason: null,
          reopenReason: null,
          incidentIds: [],
          reviewerUid: null,
          approverUid: null,
          startedAt: current.startedAt,
          endedAt: null,
          submittedAt: null,
          reviewedAt: null,
          approvedAt: null,
          dailyCloseId: null,
        });
      }

      posShiftRepository.updateInTransaction(
        transaction,
        current.id,
        { status: shiftTarget, cutId: resolved.id },
        current.version,
      );

      if (
        session.status === PosSessionStatus.OPEN &&
        session.currentShiftId === current.id
      ) {
        const sessionTarget = assertTransition(
          "session",
          "start-count",
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
        eventType: PosAuditEventType.CASH_COUNT_STARTED,
        entity: PosAuditEntity.CUT,
        entityId: resolved.id,
        actor,
        context,
        operationalDate: current.operationalDate,
        registerId: current.registerId,
        sessionId: current.sessionId,
        shiftId: current.id,
        before: { shiftStatus: current.status },
        after: { shiftStatus: shiftTarget, cutStatus: resolved.status },
      });

      return resolved;
    });

    return this.toCutView(actor, cut);
  }

  /**
   * Envía el conteo del turno. Crea una versión inmutable del arqueo, calcula el efectivo
   * esperado desde el ledger, consolida el corte y lo aprueba de forma autónoma.
   */
  async submitCount(
    actor: PosActor,
    shiftId: string,
    input: SubmitCashCountInput,
    context: PosRequestContext | null,
  ): Promise<{ count: CashCountView; cut: CutView }> {
    posAuthorizationService.requireCapability(actor, PosCapability.CUT_CREATE_OWN);

    const settings = await posSettingsService.get();
    const shift = await posShiftRepository.requireById(shiftId);
    if (shift.cashierUid !== actor.uid) {
      throw new PosProblemError("SHIFT_NOT_OWNED");
    }
    if (shift.status !== PosShiftStatus.COUNTING) {
      throw new PosProblemError(
        "INVALID_STATE_TRANSITION",
        "El turno debe estar en arqueo para enviar el conteo.",
      );
    }

    // Preferir denominaciones recalculadas; si no hay, aceptar countedCashMinor.
    const computed = resolveCountedCash({
      denominations: input.denominations,
      countedCashMinor: input.countedCashMinor,
      allowedDenominationsMinor: settings.denominationsMinor,
    });

    // El turno está en COUNTING: no pueden crearse ventas, pagos ni devoluciones nuevas, así
    // que estas fuentes ya están congeladas y se leen fuera de la transacción.
    const [sales, payments, returns] = await Promise.all([
      posSaleRepository.listByShift(shift.id),
      posPaymentRepository.listByShift(shift.id),
      posReturnRepository.listByShift(shift.id),
    ]);

    const result = await runPosTransaction(async (transaction) => {
      const current = await posShiftRepository.requireByIdInTransaction(
        transaction,
        shift.id,
      );
      if (current.status !== PosShiftStatus.COUNTING) {
        throw new PosProblemError("CASH_COUNT_ALREADY_SUBMITTED");
      }
      const shiftTarget = assertTransition(
        "shift",
        "submit-count",
        current.status,
      ) as PosShiftStatus;

      const cut = await posCutRepository.findByShiftInTransaction(
        transaction,
        current.id,
      );
      if (!cut) {
        throw new PosProblemError(
          "INVALID_STATE_TRANSITION",
          "El arqueo no fue iniciado para este turno.",
        );
      }
      const cutTarget = assertTransition(
        "cut",
        "submit",
        cut.status,
      ) as PosCutStatus;

      const session = await posSessionRepository.requireByIdInTransaction(
        transaction,
        current.sessionId,
      );
      const previousVersion =
        await posCashCountRepository.latestVersionForShiftInTransaction(
          transaction,
          current.id,
        );
      // El ledger se relee aquí: una transferencia entrante puede confirmarse mientras cuenta.
      const movements = await posCashMovementRepository.listByShiftInTransaction(
        transaction,
        current.id,
      );

      const countVersion = previousVersion + 1;
      const count = posCashCountRepository.createInTransaction(transaction, {
        storeId: POS_STORE_ID,
        registerId: current.registerId,
        sessionId: current.sessionId,
        shiftId: current.id,
        operationalDate: current.operationalDate,
        status: PosCashCountStatus.SUBMITTED,
        blind: false,
        denominations: computed.denominations,
        countedCashMinor: computed.countedCashMinor,
        countedBy: actor.uid,
        witnessUid: input.witnessUid ?? null,
        note: input.note ? input.note.slice(0, settings.maxNoteLength) : null,
        submittedAt: nowTimestamp(),
        version: countVersion,
      });

      const totals = computeCutTotals({
        openingFloatMinor: current.receivedFloatMinor,
        countedCashMinor: computed.countedCashMinor,
        sales,
        payments,
        returns,
        movements,
      });
      const classification = classifyCutDifference(
        totals.differenceMinor,
        thresholdsFrom(settings),
      );

      if (classification.requiresObservation && !input.note) {
        throw new PosProblemError(
          "REASON_REQUIRED",
          "Una diferencia fuera de tolerancia requiere una observación del cajero.",
        );
      }

      const now = nowTimestamp();
      posCutRepository.updateInTransaction(
        transaction,
        cut.id,
        {
          status: cutTarget,
          classification: classification.classification,
          toleranceMinor: settings.cutToleranceMinor,
          requiredApproverRole: classification.requiredApproverRole,
          totals,
          cashCountId: count.id,
          cashCountVersion: countVersion,
          observations: input.note
            ? input.note.slice(0, POS_TEXT_LIMITS.REASON_MAX)
            : null,
          endedAt: now,
          submittedAt: now,
          approverUid: actor.uid,
          approvedAt: now,
          reviewerUid: actor.uid,
        },
        cut.version,
      );

      this.appendVersionInTransaction(transaction, {
        cutId: cut.id,
        version: cut.version + 1,
        status: cutTarget,
        classification: classification.classification,
        totals,
        cashCountId: count.id,
        cashCountVersion: countVersion,
        reason: input.note ?? null,
        actorUid: actor.uid,
      });

      posShiftRepository.updateInTransaction(
        transaction,
        current.id,
        { status: shiftTarget, endedAt: now },
        current.version,
      );

      if (
        session.status === PosSessionStatus.COUNTING &&
        session.currentShiftId === current.id
      ) {
        const sessionTarget = assertTransition(
          "session",
          "submit-count",
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
        eventType: PosAuditEventType.CASH_COUNT_SUBMITTED,
        entity: PosAuditEntity.CASH_COUNT,
        entityId: count.id,
        actor,
        context,
        operationalDate: current.operationalDate,
        registerId: current.registerId,
        sessionId: current.sessionId,
        shiftId: current.id,
        after: {
          cutId: cut.id,
          countVersion,
          countedCashMinor: computed.countedCashMinor,
          expectedCashMinor: totals.expectedCashMinor,
          differenceMinor: totals.differenceMinor,
          classification: classification.classification,
          cutStatus: cutTarget,
        },
        reason: input.note ?? null,
      });

      posAuditService.recordInTransaction(transaction, {
        eventType: PosAuditEventType.CUT_APPROVED,
        entity: PosAuditEntity.CUT,
        entityId: cut.id,
        actor,
        context,
        operationalDate: current.operationalDate,
        registerId: current.registerId,
        sessionId: current.sessionId,
        shiftId: current.id,
        after: {
          status: cutTarget,
          autonomousClose: true,
          countedCashMinor: computed.countedCashMinor,
          differenceMinor: totals.differenceMinor,
        },
        reason: input.note ?? null,
      });

      return {
        count,
        cut: {
          ...cut,
          status: cutTarget,
          classification: classification.classification,
          toleranceMinor: settings.cutToleranceMinor,
          requiredApproverRole: classification.requiredApproverRole,
          totals,
          cashCountId: count.id,
          cashCountVersion: countVersion,
          observations: input.note
            ? input.note.slice(0, POS_TEXT_LIMITS.REASON_MAX)
            : null,
          endedAt: now,
          submittedAt: now,
          approverUid: actor.uid,
          approvedAt: now,
          reviewerUid: actor.uid,
          version: cut.version + 1,
        } as PosCut,
        requiresIncident: classification.requiresIncident,
        differenceMinor: totals.differenceMinor,
      };
    });

    if (result.differenceMinor !== 0) {
      posMetric(POS_METRICS.CUT_DIFFERENCE, {
        cutId: result.cut.id,
        shiftId: shift.id,
        registerId: shift.registerId,
        operationalDate: shift.operationalDate,
        amountMinor: result.differenceMinor,
      });
    }

    if (result.requiresIncident) {
      const incident = await posIncidentService.createSystem(
        actor.uid,
        {
          type: PosIncidentType.CASH_DIFFERENCE,
          severity: severityFor(
            Math.abs(result.differenceMinor) > settings.adminDifferenceLimitMinor
              ? "CRITICAL"
              : "HIGH",
          ),
          operationalDate: shift.operationalDate,
          description: `Diferencia de ${result.differenceMinor} centavos en el corte ${result.cut.folio} del turno ${shift.id}.`,
          registerId: shift.registerId,
          sessionId: shift.sessionId,
          shiftId: shift.id,
          cutId: result.cut.id,
        },
        actor,
        context,
      );
      await posCutRepository.update(
        result.cut.id,
        { incidentIds: [...result.cut.incidentIds, incident.id] },
        result.cut.version,
      );
      result.cut.incidentIds = [...result.cut.incidentIds, incident.id];
      result.cut.version += 1;
    }

    return {
      count: this.toCountView(actor, result.count, result.cut),
      cut: this.toCutView(actor, result.cut),
    };
  }

  /**
   * Cancela el conteo en curso antes de confirmar el cierre. Devuelve turno y sesión a
   * operables y deja el corte en `DRAFT` para poder reiniciar.
   */
  async cancelCount(
    actor: PosActor,
    shiftId: string,
    context: PosRequestContext | null,
  ): Promise<CutView> {
    posAuthorizationService.requireCapability(actor, PosCapability.CUT_CREATE_OWN);

    const cut = await runPosTransaction(async (transaction) => {
      const shift = await posShiftRepository.requireByIdInTransaction(
        transaction,
        shiftId,
      );
      if (shift.cashierUid !== actor.uid) {
        throw new PosProblemError("SHIFT_NOT_OWNED");
      }
      const shiftTarget = assertTransition(
        "shift",
        "cancel-count",
        shift.status,
      ) as PosShiftStatus;

      const existing = await posCutRepository.findByShiftInTransaction(
        transaction,
        shift.id,
      );
      if (!existing) {
        throw new PosProblemError(
          "INVALID_STATE_TRANSITION",
          "No hay un arqueo iniciado para cancelar.",
        );
      }
      const cutTarget = assertTransition(
        "cut",
        "cancel-count",
        existing.status,
      ) as PosCutStatus;

      const session = await posSessionRepository.requireByIdInTransaction(
        transaction,
        shift.sessionId,
      );

      posCutRepository.updateInTransaction(
        transaction,
        existing.id,
        { status: cutTarget },
        existing.version,
      );
      posShiftRepository.updateInTransaction(
        transaction,
        shift.id,
        { status: shiftTarget },
        shift.version,
      );

      if (
        session.status === PosSessionStatus.COUNTING &&
        session.currentShiftId === shift.id
      ) {
        const sessionTarget = assertTransition(
          "session",
          "cancel-count",
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
        eventType: PosAuditEventType.CASH_COUNT_CANCELLED,
        entity: PosAuditEntity.CUT,
        entityId: existing.id,
        actor,
        context,
        operationalDate: shift.operationalDate,
        registerId: shift.registerId,
        sessionId: shift.sessionId,
        shiftId: shift.id,
        before: { shiftStatus: shift.status, cutStatus: existing.status },
        after: { shiftStatus: shiftTarget, cutStatus: cutTarget },
      });

      return {
        ...existing,
        status: cutTarget,
        version: existing.version + 1,
      };
    });

    return this.toCutView(actor, cut);
  }

  /**
   * Vista previa del corte del turno: totales calculados en backend y bloqueos operativos.
   */
  async previewCut(actor: PosActor, shiftId: string): Promise<CutPreview> {
    const shift = await posShiftRepository.requireById(shiftId);
    posAuthorizationService.assertCanReadOwned(
      actor,
      shift.cashierUid,
      PosCapability.CUT_READ_ALL,
    );

    const [pendingSales, unresolvedMovements, sales, payments, returns, movements, cut] =
      await Promise.all([
        posSaleRepository.countPendingByShift(shift.id),
        posCashMovementRepository.countUnresolvedByShift(shift.id),
        posSaleRepository.listByShift(shift.id),
        posPaymentRepository.listByShift(shift.id),
        posReturnRepository.listByShift(shift.id),
        posCashMovementRepository.listByShift(shift.id),
        posCutRepository.findByShift(shift.id),
      ]);

    const messages: string[] = [];
    if (pendingSales > 0) {
      messages.push(
        `Hay ${pendingSales} venta(s) en proceso o suspendida(s). Resuélvelas antes del corte.`,
      );
    }
    if (unresolvedMovements > 0) {
      messages.push(
        `Hay ${unresolvedMovements} movimiento(s) de efectivo pendiente(s) o en tránsito.`,
      );
    }
    if (
      shift.status !== PosShiftStatus.ACTIVE &&
      shift.status !== PosShiftStatus.COUNTING &&
      shift.status !== PosShiftStatus.SECOND_COUNT_REQUIRED
    ) {
      messages.push(
        `El turno está en estado ${shift.status} y no admite un nuevo conteo.`,
      );
    }

    const closedStatuses: readonly PosCutStatus[] = [
      PosCutStatus.APPROVED,
      PosCutStatus.CLOSED,
      PosCutStatus.SUBMITTED,
      PosCutStatus.UNDER_REVIEW,
      PosCutStatus.REJECTED,
      PosCutStatus.ESCALATED,
    ];
    const alreadyClosed =
      cut != null && closedStatuses.includes(cut.status);

    const computed = computeCutTotals({
      openingFloatMinor: shift.receivedFloatMinor,
      countedCashMinor: alreadyClosed ? cut!.totals.countedCashMinor : 0,
      sales,
      payments,
      returns,
      movements,
    });

    const totals: PosCutTotals = alreadyClosed
      ? cut!.totals
      : {
          ...computed,
          countedCashMinor: 0,
          differenceMinor: 0,
        };

    return {
      cut: cut ? this.toCutView(actor, cut) : null,
      shiftId: shift.id,
      registerId: shift.registerId,
      registerCode: shift.registerCode,
      sessionId: shift.sessionId,
      cashierUid: shift.cashierUid,
      operationalDate: shift.operationalDate,
      shiftStatus: shift.status,
      startedAt: shift.startedAt,
      receivedFloatMinor: shift.receivedFloatMinor,
      blocking: {
        pendingSales,
        unresolvedMovements,
        canStartOrContinue:
          messages.length === 0 &&
          (shift.status === PosShiftStatus.ACTIVE ||
            shift.status === PosShiftStatus.COUNTING ||
            shift.status === PosShiftStatus.SECOND_COUNT_REQUIRED),
        messages,
      },
      totals,
    };
  }

  async getCount(actor: PosActor, countId: string): Promise<CashCountView> {
    const count = await posCashCountRepository.requireById(countId);
    posAuthorizationService.assertCanReadOwned(
      actor,
      count.countedBy,
      PosCapability.CUT_READ_ALL,
    );
    const cut = await posCutRepository.findByShift(count.shiftId);
    return this.toCountView(actor, count, cut);
  }

  async listCounts(actor: PosActor, shiftId: string): Promise<CashCountView[]> {
    const shift = await posShiftRepository.requireById(shiftId);
    posAuthorizationService.assertCanReadOwned(
      actor,
      shift.cashierUid,
      PosCapability.CUT_READ_ALL,
    );
    const [counts, cut] = await Promise.all([
      posCashCountRepository.listByShift(shiftId),
      posCutRepository.findByShift(shiftId),
    ]);
    return counts.map((count) => this.toCountView(actor, count, cut));
  }

  // ---------------------------------------------------------- revisión y cierre

  async get(actor: PosActor, cutId: string): Promise<CutView> {
    const cut = await posCutRepository.requireById(cutId);
    posAuthorizationService.assertCanReadOwned(
      actor,
      cut.cashierUid,
      PosCapability.CUT_READ_ALL,
    );
    return this.toCutView(actor, cut);
  }

  async list(
    actor: PosActor,
    filters: {
      registerId?: string;
      sessionId?: string;
      shiftId?: string;
      cashierUid?: string;
      status?: PosCutStatus;
      classification?: PosCutClassification;
      scope?: PosCutScope;
      operationalDate?: OperationalDate;
      limit?: number;
      cursor?: string;
    },
  ): Promise<PosPageResult<CutView>> {
    const settings = await posSettingsService.get();
    const limit = Math.min(
      filters.limit ?? settings.defaultPageSize,
      settings.maxPageSize,
    );
    const cashierUid = posAuthorizationService.scopeCashierFilter(
      actor,
      PosCapability.CUT_READ_ALL,
      filters.cashierUid,
    );

    const equals: Array<{ field: string; value: unknown }> = [];
    if (filters.registerId) {
      equals.push({ field: "registerId", value: filters.registerId });
    }
    if (filters.sessionId) {
      equals.push({ field: "sessionId", value: filters.sessionId });
    }
    if (filters.shiftId) equals.push({ field: "shiftId", value: filters.shiftId });
    if (filters.status) equals.push({ field: "status", value: filters.status });
    if (filters.classification) {
      equals.push({ field: "classification", value: filters.classification });
    }
    if (filters.scope) equals.push({ field: "scope", value: filters.scope });
    if (filters.operationalDate) {
      equals.push({ field: "operationalDate", value: filters.operationalDate });
    }
    if (cashierUid) equals.push({ field: "cashierUid", value: cashierUid });

    // Listado por fecha operativa sin índice compuesto.
    if (filters.operationalDate && !filters.shiftId && !filters.sessionId) {
      let items = await posCutRepository.listByOperationalDate(
        filters.operationalDate,
      );
      if (filters.registerId) {
        items = items.filter((cut) => cut.registerId === filters.registerId);
      }
      if (filters.status) {
        items = items.filter((cut) => cut.status === filters.status);
      }
      if (filters.classification) {
        items = items.filter(
          (cut) => cut.classification === filters.classification,
        );
      }
      if (filters.scope) {
        items = items.filter((cut) => cut.scope === filters.scope);
      }
      if (cashierUid) {
        items = items.filter((cut) => cut.cashierUid === cashierUid);
      }
      items.sort((a, b) => b.createdAt.toMillis() - a.createdAt.toMillis());
      const limited = items.slice(0, limit);
      return {
        items: limited.map((cut) => this.toCutView(actor, cut)),
        hasMore: items.length > limit,
        nextCursor: null,
      };
    }

    const page = await posCutRepository.list({
      limit,
      cursor: filters.cursor,
      orderByField: "createdAt",
      direction: "desc",
      equals,
    });

    return {
      ...page,
      items: page.items.map((cut) => this.toCutView(actor, cut)),
    };
  }

  /** Toma la revisión del corte. Impide que el cajero revise el suyo. */
  async review(
    actor: PosActor,
    cutId: string,
    context: PosRequestContext | null,
  ): Promise<CutView> {
    return this.applyCutTransition({
      actor,
      cutId,
      action: "review",
      capability: PosCapability.CUT_REVIEW,
      eventType: PosAuditEventType.CUT_CLARIFICATION_REQUESTED,
      reason: null,
      context,
      patch: () => ({ reviewerUid: actor.uid, reviewedAt: nowTimestamp() }),
      shiftAction: "review",
    });
  }

  async requestClarification(
    actor: PosActor,
    cutId: string,
    reason: string,
    context: PosRequestContext | null,
  ): Promise<CutView> {
    const validReason = assertReason(reason);
    return this.applyCutTransition({
      actor,
      cutId,
      action: "request-clarification",
      capability: PosCapability.CUT_REVIEW,
      eventType: PosAuditEventType.CUT_CLARIFICATION_REQUESTED,
      reason: validReason,
      context,
      patch: () => ({
        reviewerUid: actor.uid,
        reviewedAt: nowTimestamp(),
        clarificationRequest: validReason,
      }),
    });
  }

  /** Solicita un segundo conteo: el turno vuelve a poder contar y se crea otra versión. */
  async requestSecondCount(
    actor: PosActor,
    cutId: string,
    reason: string,
    context: PosRequestContext | null,
  ): Promise<CutView> {
    const validReason = assertReason(reason);
    return this.applyCutTransition({
      actor,
      cutId,
      action: "request-second-count",
      capability: PosCapability.CUT_REQUEST_SECOND_COUNT,
      eventType: PosAuditEventType.SECOND_COUNT_REQUESTED,
      reason: validReason,
      context,
      patch: () => ({ reviewerUid: actor.uid, reviewedAt: nowTimestamp() }),
      shiftAction: "request-second-count",
    });
  }

  /**
   * Aprueba el corte. Requiere el nivel de autorización que corresponde a la magnitud de la
   * diferencia y prohíbe que el cajero apruebe su propio corte.
   */
  async approve(
    actor: PosActor,
    cutId: string,
    observations: string | undefined,
    context: PosRequestContext | null,
  ): Promise<CutView> {
    return this.applyCutTransition({
      actor,
      cutId,
      action: "approve",
      capability: PosCapability.CUT_APPROVE,
      eventType: PosAuditEventType.CUT_APPROVED,
      reason: observations ?? null,
      context,
      assertLevel: true,
      patch: (cut) => ({
        approverUid: actor.uid,
        approvedAt: nowTimestamp(),
        reviewerUid: cut.reviewerUid ?? actor.uid,
        clarificationResponse: observations
          ? observations.slice(0, POS_TEXT_LIMITS.REASON_MAX)
          : (cut.clarificationResponse ?? null),
      }),
      shiftAction: "approve",
    });
  }

  async reject(
    actor: PosActor,
    cutId: string,
    reason: string,
    context: PosRequestContext | null,
  ): Promise<CutView> {
    const validReason = assertReason(reason);
    return this.applyCutTransition({
      actor,
      cutId,
      action: "reject",
      capability: PosCapability.CUT_REJECT,
      eventType: PosAuditEventType.CUT_REJECTED,
      reason: validReason,
      context,
      patch: () => ({
        reviewerUid: actor.uid,
        reviewedAt: nowTimestamp(),
        rejectionReason: validReason,
      }),
      shiftAction: "reject",
    });
  }

  async escalate(
    actor: PosActor,
    cutId: string,
    reason: string,
    context: PosRequestContext | null,
  ): Promise<CutView> {
    const validReason = assertReason(reason);
    const view = await this.applyCutTransition({
      actor,
      cutId,
      action: "escalate",
      capability: PosCapability.CUT_REVIEW,
      eventType: PosAuditEventType.CUT_ESCALATED,
      reason: validReason,
      context,
      patch: () => ({
        reviewerUid: actor.uid,
        reviewedAt: nowTimestamp(),
        escalationReason: validReason,
      }),
      shiftAction: "escalate",
    });

    const incident = await posIncidentService.createSystem(
      actor.uid,
      {
        type: PosIncidentType.CASH_DIFFERENCE,
        severity: PosIncidentSeverity.HIGH,
        operationalDate: view.operationalDate,
        description: `Corte ${view.folio} escalado a administración. Motivo: ${validReason}`,
        registerId: view.registerId,
        sessionId: view.sessionId,
        shiftId: view.shiftId,
        cutId: view.id,
      },
      actor,
      context,
    );
    await posCutRepository.update(
      view.id,
      { incidentIds: [...view.incidentIds, incident.id] },
      view.version,
    );

    return { ...view, incidentIds: [...view.incidentIds, incident.id], version: view.version + 1 };
  }

  /**
   * Reapertura controlada. No elimina la aprobación anterior: crea una versión nueva y
   * conserva el historial. Se bloquea si el día ya está cerrado.
   */
  async reopen(
    actor: PosActor,
    cutId: string,
    reason: string,
    context: PosRequestContext | null,
  ): Promise<CutView> {
    posAuthorizationService.requireCapability(actor, PosCapability.CUT_REOPEN);
    const validReason = assertReason(reason);

    const cut = await runPosTransaction(async (transaction) => {
      const current = await posCutRepository.requireByIdInTransaction(
        transaction,
        cutId,
      );
      const dailyClose = await posDailyCloseRepository.getByOperationalDateInTransaction(
        transaction,
        current.operationalDate,
      );
      if (
        dailyClose &&
        (dailyClose.status === PosDailyCloseStatus.CLOSED ||
          dailyClose.status === PosDailyCloseStatus.FORCED_CLOSED)
      ) {
        throw new PosProblemError(
          "DAILY_CLOSE_BLOCKED",
          "El día ya está cerrado: la corrección debe registrarse como ajuste autorizado.",
        );
      }

      const target = assertTransition(
        "cut",
        "reopen",
        current.status,
      ) as PosCutStatus;

      posCutRepository.updateInTransaction(
        transaction,
        current.id,
        {
          status: target,
          reopenReason: validReason,
          approverUid: null,
          approvedAt: null,
        },
        current.version,
      );

      this.appendVersionInTransaction(transaction, {
        cutId: current.id,
        version: current.version + 1,
        status: target,
        classification: current.classification,
        totals: current.totals,
        cashCountId: current.cashCountId,
        cashCountVersion: current.cashCountVersion,
        reason: validReason,
        actorUid: actor.uid,
      });

      posAuditService.recordInTransaction(transaction, {
        eventType: PosAuditEventType.CUT_REOPENED,
        entity: PosAuditEntity.CUT,
        entityId: current.id,
        actor,
        context,
        operationalDate: current.operationalDate,
        registerId: current.registerId,
        sessionId: current.sessionId,
        shiftId: current.shiftId,
        before: { status: current.status, approverUid: current.approverUid },
        after: { status: target },
        reason: validReason,
      });

      return { ...current, status: target, version: current.version + 1 };
    });

    return this.toCutView(actor, cut);
  }

  // ------------------------------------------------------- corte de sesión

  /**
   * Corte de la sesión de caja: consolida los cortes de sus turnos. Se genera al cerrar la
   * caja y no admite conteo propio, porque el efectivo ya fue contado por turno.
   */
  async buildSessionCut(
    actor: PosActor,
    sessionId: string,
    context: PosRequestContext | null,
  ): Promise<PosCut> {
    const session = await posSessionRepository.requireById(sessionId);
    const shiftCuts = (
      await Promise.all(
        session.shiftIds.map((id) => posCutRepository.findByShift(id)),
      )
    ).filter((entry): entry is PosCut => entry !== null);

    const totals = mergeCutTotals(shiftCuts.map((entry) => entry.totals));
    const settings = await posSettingsService.get();
    const classification = classifyCutDifference(
      totals.differenceMinor,
      thresholdsFrom(settings),
    );

    const existing = await posCutRepository.findBySession(sessionId);
    if (existing) {
      return posCutRepository.update(
        existing.id,
        {
          totals,
          classification: classification.classification,
          requiredApproverRole: classification.requiredApproverRole,
        },
        existing.version,
      );
    }

    const folio = await posFolioService.next(
      "CUT",
      session.operationalDate,
      session.registerCode,
    );
    const cut = await posCutRepository.create({
      storeId: POS_STORE_ID,
      folio,
      scope: PosCutScope.SESSION,
      operationalDate: session.operationalDate,
      registerId: session.registerId,
      registerCode: session.registerCode,
      sessionId: session.id,
      shiftId: null,
      cashierUid: null,
      status: PosCutStatus.SUBMITTED,
      classification: classification.classification,
      toleranceMinor: settings.cutToleranceMinor,
      requiredApproverRole: classification.requiredApproverRole,
      totals,
      cashCountId: null,
      cashCountVersion: 0,
      observations: null,
      clarificationRequest: null,
      clarificationResponse: null,
      rejectionReason: null,
      escalationReason: null,
      reopenReason: null,
      incidentIds: [],
      reviewerUid: null,
      approverUid: null,
      startedAt: session.openedAt,
      endedAt: nowTimestamp(),
      submittedAt: nowTimestamp(),
      reviewedAt: null,
      approvedAt: null,
      dailyCloseId: null,
    });

    await posAuditService.record({
      eventType: PosAuditEventType.CASH_COUNT_SUBMITTED,
      entity: PosAuditEntity.CUT,
      entityId: cut.id,
      actor,
      context,
      operationalDate: session.operationalDate,
      registerId: session.registerId,
      sessionId: session.id,
      after: {
        scope: PosCutScope.SESSION,
        shiftCutCount: shiftCuts.length,
        differenceMinor: totals.differenceMinor,
      },
    });

    return cut;
  }

  /** Efectivo esperado de un turno. Solo para actores con revisión de cortes. */
  async expectedCash(actor: PosActor, shiftId: string): Promise<number> {
    posAuthorizationService.requireCapability(actor, PosCapability.CUT_REVIEW);
    const shift = await posShiftRepository.requireById(shiftId);
    const movements = await posCashMovementRepository.listByShift(shiftId);
    return computeExpectedCash({
      openingFloatMinor: shift.receivedFloatMinor,
      movements,
    }).expectedCashMinor;
  }

  async listVersions(actor: PosActor, cutId: string): Promise<PosCutVersion[]> {
    const cut = await posCutRepository.requireById(cutId);
    posAuthorizationService.assertCanReadOwned(
      actor,
      cut.cashierUid,
      PosCapability.CUT_READ_ALL,
    );
    if (!canRevealCutResult(actor, cut)) {
      throw new PosProblemError("CASH_COUNT_BLIND_RESULT_HIDDEN");
    }
    return posCutVersionRepository.listByCut(cutId);
  }

  // ------------------------------------------------------------------ internos

  private appendVersionInTransaction(
    transaction: FirebaseFirestore.Transaction,
    input: {
      cutId: string;
      version: number;
      status: PosCutStatus;
      classification: PosCutClassification;
      totals: PosCutTotals;
      cashCountId: string | null;
      cashCountVersion: number;
      reason: string | null;
      actorUid: string;
    },
  ): void {
    posCutVersionRepository.createInTransaction(transaction, {
      storeId: POS_STORE_ID,
      cutId: input.cutId,
      version: input.version,
      status: input.status,
      classification: input.classification,
      totals: input.totals,
      cashCountId: input.cashCountId,
      cashCountVersion: input.cashCountVersion,
      reason: input.reason,
      actorUid: input.actorUid,
    });
  }

  /**
   * Transición genérica del corte con su efecto espejo en el turno.
   * Centraliza capacidad, autoaprobación, nivel requerido, versión del corte y auditoría.
   */
  private async applyCutTransition(input: {
    actor: PosActor;
    cutId: string;
    action: string;
    capability: PosCapability;
    eventType: PosAuditEventType;
    reason: string | null;
    context: PosRequestContext | null;
    patch: (cut: PosCut) => Record<string, unknown>;
    shiftAction?: string;
    assertLevel?: boolean;
  }): Promise<CutView> {
    posAuthorizationService.requireCapability(input.actor, input.capability);

    const cut = await runPosTransaction(async (transaction) => {
      const current = await posCutRepository.requireByIdInTransaction(
        transaction,
        input.cutId,
      );
      if (current.cashierUid) {
        posAuthorizationService.assertNotSelfApproval(
          input.actor,
          current.cashierUid,
        );
      }
      const target = assertTransition(
        "cut",
        input.action,
        current.status,
      ) as PosCutStatus;

      if (input.assertLevel) {
        if (!roleAtLeast(input.actor.posRole, current.requiredApproverRole)) {
          throw new PosProblemError(
            "CUT_APPROVAL_LEVEL_REQUIRED",
            `La diferencia requiere aprobación de ${current.requiredApproverRole}.`,
          );
        }
      }

      const patch = { ...input.patch(current), status: target };
      posCutRepository.updateInTransaction(
        transaction,
        current.id,
        patch,
        current.version,
      );

      this.appendVersionInTransaction(transaction, {
        cutId: current.id,
        version: current.version + 1,
        status: target,
        classification: current.classification,
        totals: current.totals,
        cashCountId: current.cashCountId,
        cashCountVersion: current.cashCountVersion,
        reason: input.reason,
        actorUid: input.actor.uid,
      });

      if (input.shiftAction && current.shiftId) {
        const shift = await posShiftRepository.requireByIdInTransaction(
          transaction,
          current.shiftId,
        );
        const shiftTarget = assertTransition(
          "shift",
          input.shiftAction,
          shift.status,
        ) as PosShiftStatus;
        posShiftRepository.updateInTransaction(
          transaction,
          shift.id,
          {
            status: shiftTarget,
            supervisorUid: input.actor.uid,
          },
          shift.version,
        );
      }

      posAuditService.recordInTransaction(transaction, {
        eventType: input.eventType,
        entity: PosAuditEntity.CUT,
        entityId: current.id,
        actor: input.actor,
        context: input.context,
        operationalDate: current.operationalDate,
        registerId: current.registerId,
        sessionId: current.sessionId,
        shiftId: current.shiftId,
        before: { status: current.status },
        after: {
          status: target,
          differenceMinor: current.totals.differenceMinor,
          classification: current.classification,
        },
        reason: input.reason,
      });

      return { ...current, ...patch, version: current.version + 1 } as PosCut;
    });

    return this.toCutView(input.actor, cut);
  }

  private toCutView(actor: PosActor, cut: PosCut): CutView {
    const visible = canRevealCutResult(actor, cut);
    return {
      ...cut,
      totals: visible ? cut.totals : null,
      blindForActor: !visible,
    };
  }

  private toCountView(
    actor: PosActor,
    count: PosCashCount,
    cut: PosCut | null,
  ): CashCountView {
    const visible = canRevealCutResult(actor, cut);
    return {
      ...count,
      // Las denominaciones capturadas por el propio cajero no son un secreto: el total
      // calculado por el sistema sí, porque revelaría la diferencia al compararlo.
      countedCashMinor: visible ? count.countedCashMinor : null,
      blindForActor: !visible,
    };
  }
}

export const posCutService = new PosCutService();
export default posCutService;
