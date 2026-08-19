/**
 * Cierre consolidado por fecha operativa.
 *
 * Unicidad (DEC-08): el ID del documento `posDailyClosures/{operationalDate}` es la propia
 * fecha operativa, así que dos administradores no pueden crear dos cierres del mismo día:
 * el segundo `create` falla dentro de la transacción.
 *
 * Reconstrucción: los totales se calculan por turno con `computeCutTotals` sobre las fuentes
 * canónicas del día (ventas, pagos, devoluciones y ledger) y se suman con `mergeCutTotals`.
 * El documento de cierre guarda un snapshot y las referencias a sus fuentes, de modo que el
 * cálculo puede repetirse y conciliarse después.
 *
 * Reglas de conteo aplicadas:
 *
 * - Una venta con pago mixto se cuenta una sola vez; el desglose por método vive en
 *   `paymentBreakdown`, no en el neto.
 * - Los pagos rechazados o cancelados y las ventas canceladas antes del pago no suman importe.
 * - Los reembolsos se restan en su propio renglón, nunca borrando la venta original.
 */

import { POS_STORE_ID, POS_TEXT_LIMITS } from "../constants/pos.constants";
import { mergeCutTotals, computeCutTotals } from "../domain/cut-totals";
import {
  assertOperationalDate,
  compareOperationalDates,
  operationalDateOf,
} from "../domain/operational-date";
import { assertTransition } from "../domain/state-machines";
import PosProblemError from "../errors/pos-problem.error";
import {
  PosAuditEntity,
  PosAuditEventType,
  PosCapability,
  PosCashMovementStatus,
  PosCutScope,
  PosCutStatus,
  PosDailyCloseStatus,
  PosIncidentSeverity,
  PosIncidentStatus,
  PosIncidentType,
  PosPaymentMethod,
  PosPaymentStatus,
  PosReturnStatus,
  PosSaleStatus,
  PosSessionStatus,
  PosShiftStatus,
} from "../models/pos.enums";
import type {
  OperationalDate,
  PosActor,
  PosCashMovement,
  PosCut,
  PosCutTotals,
  PosDailyClose,
  PosDailyCloseBlocker,
  PosDailyCloseCashierSummary,
  PosDailyCloseRegisterSummary,
  PosDailyCloseTotals,
  PosPageResult,
  PosPayment,
  PosRequestContext,
  PosReturn,
  PosSale,
  PosShift,
} from "../models/pos.types";
import { POS_METRICS, posMetric } from "../observability/pos-logger";
import { nowTimestamp, runPosTransaction } from "../repositories/pos-firestore";
import {
  posCashMovementRepository,
  posCutRepository,
  posDailyCloseRepository,
  posIncidentRepository,
  posPaymentRepository,
  posReturnRepository,
  posSaleRepository,
  posSessionRepository,
  posShiftRepository,
} from "../repositories/pos-operational.repository";
import { posAuditService } from "./pos-audit.service";
import { posAuthorizationService } from "./pos-authorization.service";
import { posIncidentService } from "./pos-incident.service";
import posSettingsService from "./pos-settings.service";

/** Estados terminales del cierre: ya no admite recálculo ordinario. */
const FINAL_DAILY_CLOSE_STATUSES: readonly PosDailyCloseStatus[] = [
  PosDailyCloseStatus.CLOSED,
  PosDailyCloseStatus.FORCED_CLOSED,
];

const OPEN_SESSION_STATUSES: readonly PosSessionStatus[] = [
  PosSessionStatus.OPEN,
  PosSessionStatus.HANDOFF_PENDING,
  PosSessionStatus.COUNTING,
  PosSessionStatus.REVIEW_PENDING,
];

const OPEN_SHIFT_STATUSES: readonly PosShiftStatus[] = [
  PosShiftStatus.ACTIVE,
  PosShiftStatus.HANDOFF_PENDING,
  PosShiftStatus.COUNTING,
  PosShiftStatus.SUBMITTED,
  PosShiftStatus.SECOND_COUNT_REQUIRED,
  PosShiftStatus.UNDER_REVIEW,
  PosShiftStatus.REJECTED,
  PosShiftStatus.ESCALATED,
  PosShiftStatus.APPROVED,
];

const PENDING_SALE_STATUSES: readonly PosSaleStatus[] = [
  PosSaleStatus.DRAFT,
  PosSaleStatus.SUSPENDED,
  PosSaleStatus.PAYMENT_PENDING,
];

const UNRESOLVED_RETURN_STATUSES: readonly PosReturnStatus[] = [
  PosReturnStatus.DRAFT,
  PosReturnStatus.PENDING_APPROVAL,
  PosReturnStatus.APPROVED,
];

const OPEN_INCIDENT_STATUSES: readonly PosIncidentStatus[] = [
  PosIncidentStatus.OPEN,
  PosIncidentStatus.UNDER_REVIEW,
  PosIncidentStatus.ESCALATED,
];

/** Los cortes que ya pasaron revisión y por tanto no bloquean el cierre. */
const SETTLED_CUT_STATUSES: readonly PosCutStatus[] = [
  PosCutStatus.APPROVED,
  PosCutStatus.CLOSED,
];

/** Tope de bloqueos persistidos: el documento no debe crecer sin límite. */
const MAX_PERSISTED_BLOCKERS = 100;

/** Tope de cortes cerrados en la transacción de cierre (límite de escrituras de Firestore). */
const MAX_CUTS_PER_CLOSE = 200;

const EMPTY_DAILY_TOTALS: PosDailyCloseTotals = Object.freeze({
  registerCount: 0,
  sessionCount: 0,
  shiftCount: 0,
  salesCount: 0,
  grossSalesMinor: 0,
  discountMinor: 0,
  netSalesMinor: 0,
  refundsMinor: 0,
  voidedMinor: 0,
  paymentBreakdown: [],
  cashInMinor: 0,
  cashOutMinor: 0,
  securityDropsMinor: 0,
  transfersInMinor: 0,
  transfersOutMinor: 0,
  expectedCashMinor: 0,
  countedCashMinor: 0,
  differenceMinor: 0,
  shortageMinor: 0,
  overageMinor: 0,
});

export interface DailyCloseReadiness {
  operationalDate: OperationalDate;
  ready: boolean;
  status: PosDailyCloseStatus;
  blockers: PosDailyCloseBlocker[];
  blockerCount: number;
  closedAt: string | null;
}

export interface DailyClosePreview {
  operationalDate: OperationalDate;
  status: PosDailyCloseStatus;
  totals: PosDailyCloseTotals;
  registers: PosDailyCloseRegisterSummary[];
  cashiers: PosDailyCloseCashierSummary[];
  cutIds: string[];
  blockers: PosDailyCloseBlocker[];
  incidentIds: string[];
}

interface DailyConsolidation extends Omit<DailyClosePreview, "status"> {
  shiftCuts: PosCut[];
}

function blocker(
  code: string,
  message: string,
  entity: PosDailyCloseBlocker["entity"],
  entityId: string,
): PosDailyCloseBlocker {
  return { code, message, entity, entityId };
}

function groupBy<T>(items: readonly T[], key: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const group = map.get(key(item));
    if (group) {
      group.push(item);
    } else {
      map.set(key(item), [item]);
    }
  }
  return map;
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

class PosDailyCloseService {
  // ------------------------------------------------------------------ lectura

  /** Checklist de bloqueos. No escribe nada: es seguro consultarlo en cualquier momento. */
  async readiness(
    actor: PosActor,
    operationalDate: string,
  ): Promise<DailyCloseReadiness> {
    posAuthorizationService.requireCapability(
      actor,
      PosCapability.DAILY_CLOSE_PREVIEW,
    );
    const date = await this.assertClosableDate(operationalDate);

    const existing = await posDailyCloseRepository.getByOperationalDate(date);
    if (existing && FINAL_DAILY_CLOSE_STATUSES.includes(existing.status)) {
      return {
        operationalDate: date,
        ready: false,
        status: existing.status,
        blockers: [],
        blockerCount: 0,
        closedAt: existing.closedAt?.toDate().toISOString() ?? null,
      };
    }

    const consolidation = await this.consolidate(date);
    return {
      operationalDate: date,
      ready: consolidation.blockers.length === 0,
      status:
        consolidation.blockers.length === 0
          ? PosDailyCloseStatus.READY
          : PosDailyCloseStatus.BLOCKED,
      blockers: consolidation.blockers.slice(0, MAX_PERSISTED_BLOCKERS),
      blockerCount: consolidation.blockers.length,
      closedAt: null,
    };
  }

  /**
   * Vista previa consolidada. Persiste el borrador del cierre con su estado real
   * (`READY` o `BLOCKED`) para que la operación sepa qué falta sin recalcular en cada consulta.
   */
  async preview(
    actor: PosActor,
    operationalDate: string,
    context: PosRequestContext | null,
  ): Promise<DailyClosePreview> {
    posAuthorizationService.requireCapability(
      actor,
      PosCapability.DAILY_CLOSE_PREVIEW,
    );
    const date = await this.assertClosableDate(operationalDate);

    const existing = await posDailyCloseRepository.getByOperationalDate(date);
    if (existing && FINAL_DAILY_CLOSE_STATUSES.includes(existing.status)) {
      return this.toPreview(existing);
    }

    const consolidation = await this.consolidate(date);
    const status =
      consolidation.blockers.length === 0
        ? PosDailyCloseStatus.READY
        : PosDailyCloseStatus.BLOCKED;

    const stored = await this.upsertDraft(date, consolidation, status);

    await posAuditService.record({
      eventType: PosAuditEventType.DAILY_CLOSE_PREVIEWED,
      entity: PosAuditEntity.DAILY_CLOSE,
      entityId: date,
      actor,
      context,
      operationalDate: date,
      after: {
        status,
        blockerCount: consolidation.blockers.length,
        netSalesMinor: consolidation.totals.netSalesMinor,
        differenceMinor: consolidation.totals.differenceMinor,
      },
    });

    return this.toPreview(stored);
  }

  async get(actor: PosActor, dailyCloseId: string): Promise<PosDailyClose> {
    posAuthorizationService.requireAnyCapability(actor, [
      PosCapability.DAILY_CLOSE_PREVIEW,
      PosCapability.REPORT_READ_ALL,
    ]);
    const entity = await posDailyCloseRepository.getById(dailyCloseId);
    if (!entity) {
      throw new PosProblemError("DAILY_CLOSE_NOT_FOUND");
    }
    return entity;
  }

  async list(
    actor: PosActor,
    filters: {
      status?: PosDailyCloseStatus;
      from?: string;
      to?: string;
      limit?: number;
      cursor?: string;
    },
  ): Promise<PosPageResult<PosDailyClose>> {
    posAuthorizationService.requireAnyCapability(actor, [
      PosCapability.DAILY_CLOSE_PREVIEW,
      PosCapability.REPORT_READ_ALL,
    ]);
    const settings = await posSettingsService.get();
    const limit = Math.min(
      filters.limit ?? settings.defaultPageSize,
      settings.maxPageSize,
    );

    const range: Array<{
      field: string;
      operator: ">=" | "<=";
      value: unknown;
    }> = [];
    if (filters.from) {
      range.push({
        field: "operationalDate",
        operator: ">=",
        value: assertOperationalDate(filters.from),
      });
    }
    if (filters.to) {
      range.push({
        field: "operationalDate",
        operator: "<=",
        value: assertOperationalDate(filters.to),
      });
    }

    return posDailyCloseRepository.list({
      limit,
      cursor: filters.cursor,
      orderByField: "operationalDate",
      direction: "desc",
      equals: filters.status
        ? [{ field: "status", value: filters.status }]
        : undefined,
      range,
    });
  }

  // ------------------------------------------------------------------- cierre

  /**
   * Cierre normal. Falla si existen bloqueos y si ya hay un cierre para la fecha.
   * Cierra además los cortes aprobados del día y los vincula al cierre.
   */
  async close(
    actor: PosActor,
    operationalDate: string,
    context: PosRequestContext | null,
  ): Promise<PosDailyClose> {
    posAuthorizationService.requireCapability(
      actor,
      PosCapability.DAILY_CLOSE_EXECUTE,
    );
    const date = await this.assertClosableDate(operationalDate);
    const consolidation = await this.consolidate(date);

    if (consolidation.blockers.length > 0) {
      throw new PosProblemError(
        "DAILY_CLOSE_BLOCKED",
        `El día ${date} tiene ${consolidation.blockers.length} bloqueo(s) sin resolver.`,
        consolidation.blockers.slice(0, MAX_PERSISTED_BLOCKERS),
      );
    }

    return this.persistClose({
      actor,
      date,
      consolidation,
      context,
      forced: false,
      reason: null,
    });
  }

  /**
   * Cierre forzado. Requiere capacidad especial y motivo, registra la lista de bloqueos
   * ignorados y genera una incidencia de seguimiento.
   */
  async forceClose(
    actor: PosActor,
    operationalDate: string,
    reason: string,
    context: PosRequestContext | null,
  ): Promise<PosDailyClose> {
    posAuthorizationService.requireCapability(
      actor,
      PosCapability.DAILY_CLOSE_FORCE,
    );
    const validReason = assertReason(reason);
    const date = await this.assertClosableDate(operationalDate);
    const consolidation = await this.consolidate(date);

    const closed = await this.persistClose({
      actor,
      date,
      consolidation,
      context,
      forced: true,
      reason: validReason,
    });

    posMetric(POS_METRICS.FORCED_CLOSE, {
      operationalDate: date,
      userId: actor.uid,
      count: consolidation.blockers.length,
    });

    const incident = await posIncidentService.createSystem(
      actor.uid,
      {
        type: PosIncidentType.FORCED_CLOSE,
        severity:
          consolidation.blockers.length > 0
            ? PosIncidentSeverity.HIGH
            : PosIncidentSeverity.MEDIUM,
        operationalDate: date,
        description: `Cierre forzado del día ${date} con ${consolidation.blockers.length} bloqueo(s) ignorado(s). Motivo: ${validReason}`,
        dailyCloseId: date,
      },
      actor,
      context,
    );

    const withIncident = await posDailyCloseRepository.update(
      date,
      { incidentIds: [...closed.incidentIds, incident.id] },
      closed.version,
    );
    return withIncident;
  }

  // ---------------------------------------------------------------- internos

  private async persistClose(input: {
    actor: PosActor;
    date: OperationalDate;
    consolidation: DailyConsolidation;
    context: PosRequestContext | null;
    forced: boolean;
    reason: string | null;
  }): Promise<PosDailyClose> {
    const { actor, date, consolidation, forced, reason } = input;

    if (consolidation.shiftCuts.length > MAX_CUTS_PER_CLOSE) {
      throw new PosProblemError(
        "DAILY_CLOSE_BLOCKED",
        "El día tiene demasiados cortes para cerrarse en una sola operación. Contacta a soporte técnico.",
      );
    }

    const closed = await runPosTransaction(async (transaction) => {
      const existing = await posDailyCloseRepository.getByOperationalDateInTransaction(
        transaction,
        date,
      );
      if (existing && FINAL_DAILY_CLOSE_STATUSES.includes(existing.status)) {
        throw new PosProblemError("DAILY_CLOSE_ALREADY_EXISTS");
      }

      const target = assertTransition(
        "dailyClose",
        forced ? "force-close" : "close",
        existing?.status ?? PosDailyCloseStatus.DRAFT,
      ) as PosDailyCloseStatus;

      // Los cortes se releen dentro de la transacción: un supervisor pudo cambiar el estado
      // de uno entre la consolidación y el cierre.
      const cuts = await Promise.all(
        consolidation.shiftCuts.map((cut) =>
          posCutRepository.getByIdInTransaction(transaction, cut.id),
        ),
      );

      const payload = {
        storeId: POS_STORE_ID,
        operationalDate: date,
        status: target,
        totals: consolidation.totals,
        registers: consolidation.registers,
        cashiers: consolidation.cashiers,
        cutIds: consolidation.cutIds,
        blockers: [] as PosDailyCloseBlocker[],
        ignoredBlockers: forced
          ? consolidation.blockers.slice(0, MAX_PERSISTED_BLOCKERS)
          : [],
        incidentIds: consolidation.incidentIds,
        forced,
        reason,
        closedBy: actor.uid,
        closedAt: nowTimestamp(),
      };

      let result: PosDailyClose;
      if (existing) {
        posDailyCloseRepository.updateInTransaction(
          transaction,
          date,
          payload,
          existing.version,
        );
        result = {
          ...existing,
          ...payload,
          version: existing.version + 1,
        } as PosDailyClose;
      } else {
        result = posDailyCloseRepository.createInTransaction(
          transaction,
          payload as unknown as Omit<
            PosDailyClose,
            "id" | "createdAt" | "updatedAt" | "version"
          >,
          date,
        );
      }

      for (const cut of cuts) {
        if (!cut || cut.status !== PosCutStatus.APPROVED) {
          continue;
        }
        posCutRepository.updateInTransaction(
          transaction,
          cut.id,
          { status: PosCutStatus.CLOSED, dailyCloseId: date },
          cut.version,
        );
      }

      posAuditService.recordInTransaction(transaction, {
        eventType: forced
          ? PosAuditEventType.DAILY_CLOSE_FORCED
          : PosAuditEventType.DAILY_CLOSE_CREATED,
        entity: PosAuditEntity.DAILY_CLOSE,
        entityId: date,
        actor,
        context: input.context,
        operationalDate: date,
        before: existing ? { status: existing.status } : null,
        after: {
          status: target,
          netSalesMinor: consolidation.totals.netSalesMinor,
          expectedCashMinor: consolidation.totals.expectedCashMinor,
          countedCashMinor: consolidation.totals.countedCashMinor,
          differenceMinor: consolidation.totals.differenceMinor,
          cutCount: consolidation.cutIds.length,
          ignoredBlockerCount: forced ? consolidation.blockers.length : 0,
        },
        reason,
      });

      return result;
    });

    return closed;
  }

  private async upsertDraft(
    date: OperationalDate,
    consolidation: DailyConsolidation,
    status: PosDailyCloseStatus,
  ): Promise<PosDailyClose> {
    return runPosTransaction(async (transaction) => {
      const existing = await posDailyCloseRepository.getByOperationalDateInTransaction(
        transaction,
        date,
      );
      const payload = {
        storeId: POS_STORE_ID,
        operationalDate: date,
        status,
        totals: consolidation.totals,
        registers: consolidation.registers,
        cashiers: consolidation.cashiers,
        cutIds: consolidation.cutIds,
        blockers: consolidation.blockers.slice(0, MAX_PERSISTED_BLOCKERS),
        ignoredBlockers: [] as PosDailyCloseBlocker[],
        incidentIds: consolidation.incidentIds,
        forced: false,
        reason: null,
        closedBy: null,
        closedAt: null,
      };

      if (!existing) {
        return posDailyCloseRepository.createInTransaction(
          transaction,
          payload as unknown as Omit<
            PosDailyClose,
            "id" | "createdAt" | "updatedAt" | "version"
          >,
          date,
        );
      }

      posDailyCloseRepository.updateInTransaction(
        transaction,
        date,
        payload,
        existing.version,
      );
      return {
        ...existing,
        ...payload,
        version: existing.version + 1,
      } as PosDailyClose;
    });
  }

  /**
   * Consolida el día desde sus fuentes canónicas. Cada turno se calcula por separado con la
   * misma función que usa el corte, de modo que el cierre y los cortes nunca difieren.
   */
  private async consolidate(date: OperationalDate): Promise<DailyConsolidation> {
    const [sessions, shifts, sales, payments, returns, movements, cuts, incidents] =
      await Promise.all([
        posSessionRepository.listByOperationalDate(date),
        posShiftRepository.listByOperationalDate(date),
        posSaleRepository.listByOperationalDate(date),
        posPaymentRepository.listByOperationalDate(date),
        posReturnRepository.listByOperationalDate(date),
        posCashMovementRepository.listByOperationalDate(date),
        posCutRepository.listByOperationalDate(date),
        posIncidentRepository.listByOperationalDate(date),
      ]);

    const salesByShift = groupBy(sales, (sale) => sale.shiftId);
    const paymentsByShift = groupBy(payments, (payment) => payment.shiftId);
    const returnsByShift = groupBy(returns, (entry) => entry.shiftId);
    const movementsByShift = groupBy(movements, (movement) => movement.shiftId);

    const shiftCuts = cuts.filter((cut) => cut.scope === PosCutScope.SHIFT);
    const cutByShift = new Map(
      shiftCuts
        .filter((cut): cut is PosCut & { shiftId: string } => cut.shiftId !== null)
        .map((cut) => [cut.shiftId, cut]),
    );

    const perShift = shifts.map((shift) => {
      const cut = cutByShift.get(shift.id) ?? null;
      const totals = computeCutTotals({
        openingFloatMinor: shift.receivedFloatMinor,
        countedCashMinor: cut?.totals.countedCashMinor ?? 0,
        sales: salesByShift.get(shift.id) ?? [],
        payments: paymentsByShift.get(shift.id) ?? [],
        returns: returnsByShift.get(shift.id) ?? [],
        movements: movementsByShift.get(shift.id) ?? [],
      });
      return { shift, cut, totals };
    });

    const merged = mergeCutTotals(perShift.map((entry) => entry.totals));
    const registerIds = new Set(shifts.map((shift) => shift.registerId));
    const shortageMinor = perShift.reduce(
      (total, entry) =>
        entry.totals.differenceMinor < 0
          ? total + Math.abs(entry.totals.differenceMinor)
          : total,
      0,
    );
    const overageMinor = perShift.reduce(
      (total, entry) =>
        entry.totals.differenceMinor > 0 ? total + entry.totals.differenceMinor : total,
      0,
    );

    const totals: PosDailyCloseTotals = {
      ...EMPTY_DAILY_TOTALS,
      registerCount: registerIds.size,
      sessionCount: sessions.length,
      shiftCount: shifts.length,
      salesCount: merged.salesCount,
      grossSalesMinor: merged.grossSalesMinor,
      discountMinor: merged.discountMinor,
      netSalesMinor: merged.netSalesMinor,
      refundsMinor: merged.refundsMinor,
      voidedMinor: merged.voidedMinor,
      paymentBreakdown: merged.paymentBreakdown,
      cashInMinor: merged.cashInMinor,
      cashOutMinor: merged.cashOutMinor,
      securityDropsMinor: merged.securityDropsMinor,
      transfersInMinor: merged.transfersInMinor,
      transfersOutMinor: merged.transfersOutMinor,
      expectedCashMinor: merged.expectedCashMinor,
      countedCashMinor: merged.countedCashMinor,
      differenceMinor: merged.differenceMinor,
      shortageMinor,
      overageMinor,
    };

    const registers: PosDailyCloseRegisterSummary[] = Array.from(
      groupBy(perShift, (entry) => entry.shift.registerId).entries(),
    ).map(([registerId, entries]) => {
      const registerTotals = mergeCutTotals(entries.map((entry) => entry.totals));
      return {
        registerId,
        registerCode: entries[0].shift.registerCode,
        sessionIds: Array.from(
          new Set(entries.map((entry) => entry.shift.sessionId)),
        ),
        shiftCount: entries.length,
        openingFloatMinor: registerTotals.openingFloatMinor,
        netSalesMinor: registerTotals.netSalesMinor,
        expectedCashMinor: registerTotals.expectedCashMinor,
        countedCashMinor: registerTotals.countedCashMinor,
        differenceMinor: registerTotals.differenceMinor,
      };
    });

    const cashiers: PosDailyCloseCashierSummary[] = Array.from(
      groupBy(perShift, (entry) => entry.shift.cashierUid).entries(),
    ).map(([cashierUid, entries]) => {
      const cashierTotals = mergeCutTotals(entries.map((entry) => entry.totals));
      return {
        cashierUid,
        shiftIds: entries.map((entry) => entry.shift.id),
        netSalesMinor: cashierTotals.netSalesMinor,
        differenceMinor: cashierTotals.differenceMinor,
      };
    });

    const blockers = this.collectBlockers({
      sessions,
      shifts,
      sales,
      payments,
      returns,
      movements,
      cutByShift,
      incidents,
    });

    return {
      operationalDate: date,
      totals,
      registers,
      cashiers,
      cutIds: cuts.map((cut) => cut.id),
      blockers,
      incidentIds: incidents
        .filter((incident) => OPEN_INCIDENT_STATUSES.includes(incident.status))
        .map((incident) => incident.id),
      shiftCuts,
    };
  }

  /** Checklist explícito. Cada bloqueo apunta a la entidad concreta que debe resolverse. */
  private collectBlockers(input: {
    sessions: readonly { id: string; status: PosSessionStatus; registerCode: string }[];
    shifts: readonly PosShift[];
    sales: readonly PosSale[];
    payments: readonly PosPayment[];
    returns: readonly PosReturn[];
    movements: readonly PosCashMovement[];
    cutByShift: Map<string, PosCut>;
    incidents: readonly {
      id: string;
      status: PosIncidentStatus;
      severity: PosIncidentSeverity;
      folio: string;
    }[];
  }): PosDailyCloseBlocker[] {
    const blockers: PosDailyCloseBlocker[] = [];

    for (const session of input.sessions) {
      if (OPEN_SESSION_STATUSES.includes(session.status)) {
        blockers.push(
          blocker(
            "SESSION_NOT_CLOSED",
            `La sesión de la caja ${session.registerCode} sigue en estado ${session.status}.`,
            PosAuditEntity.SESSION,
            session.id,
          ),
        );
      }
    }

    for (const shift of input.shifts) {
      if (OPEN_SHIFT_STATUSES.includes(shift.status)) {
        blockers.push(
          blocker(
            "SHIFT_NOT_CLOSED",
            `El turno de la caja ${shift.registerCode} sigue en estado ${shift.status}.`,
            PosAuditEntity.SHIFT,
            shift.id,
          ),
        );
      }
      const cut = input.cutByShift.get(shift.id);
      if (!cut) {
        blockers.push(
          blocker(
            "CUT_MISSING",
            `El turno de la caja ${shift.registerCode} no tiene arqueo registrado.`,
            PosAuditEntity.SHIFT,
            shift.id,
          ),
        );
        continue;
      }
      if (!SETTLED_CUT_STATUSES.includes(cut.status)) {
        blockers.push(
          blocker(
            "CUT_NOT_APPROVED",
            `El corte ${cut.folio} está en estado ${cut.status} y requiere resolución.`,
            PosAuditEntity.CUT,
            cut.id,
          ),
        );
      }
    }

    for (const sale of input.sales) {
      if (PENDING_SALE_STATUSES.includes(sale.status)) {
        blockers.push(
          blocker(
            "SALE_PENDING",
            `La venta ${sale.folio} está en estado ${sale.status}.`,
            PosAuditEntity.SALE,
            sale.id,
          ),
        );
      }
    }

    for (const payment of input.payments) {
      if (payment.status === PosPaymentStatus.PENDING) {
        blockers.push(
          blocker(
            "PAYMENT_PENDING",
            "Existe un pago sin resolver.",
            PosAuditEntity.PAYMENT,
            payment.id,
          ),
        );
        continue;
      }
      // Conciliación de terminal: un cobro con tarjeta sin referencia no es conciliable.
      if (
        payment.method === PosPaymentMethod.CARD_EXTERNAL &&
        payment.status !== PosPaymentStatus.DECLINED &&
        payment.status !== PosPaymentStatus.CANCELLED &&
        !payment.card?.reference
      ) {
        blockers.push(
          blocker(
            "CARD_PAYMENT_WITHOUT_REFERENCE",
            "Un cobro con terminal externa no tiene referencia para conciliar.",
            PosAuditEntity.PAYMENT,
            payment.id,
          ),
        );
      }
    }

    for (const movement of input.movements) {
      if (movement.status === PosCashMovementStatus.PENDING_AUTHORIZATION) {
        blockers.push(
          blocker(
            "CASH_MOVEMENT_PENDING",
            `Un movimiento de efectivo ${movement.type} sigue pendiente de autorización.`,
            PosAuditEntity.CASH_MOVEMENT,
            movement.id,
          ),
        );
      }
      if (movement.status === PosCashMovementStatus.IN_TRANSIT) {
        blockers.push(
          blocker(
            "TRANSFER_NOT_RECEIVED",
            `Un movimiento ${movement.type} fue despachado y nadie confirmó su recepción.`,
            PosAuditEntity.CASH_MOVEMENT,
            movement.id,
          ),
        );
      }
    }

    for (const entry of input.returns) {
      if (UNRESOLVED_RETURN_STATUSES.includes(entry.status)) {
        blockers.push(
          blocker(
            "RETURN_PENDING",
            `La devolución ${entry.folio} está en estado ${entry.status}.`,
            PosAuditEntity.RETURN,
            entry.id,
          ),
        );
      }
    }

    for (const incident of input.incidents) {
      if (
        incident.severity === PosIncidentSeverity.CRITICAL &&
        OPEN_INCIDENT_STATUSES.includes(incident.status)
      ) {
        blockers.push(
          blocker(
            "CRITICAL_INCIDENT_OPEN",
            `La incidencia crítica ${incident.folio} sigue abierta.`,
            PosAuditEntity.INCIDENT,
            incident.id,
          ),
        );
      }
    }

    return blockers;
  }

  /** No se puede cerrar una fecha futura: el día todavía puede recibir operaciones. */
  private async assertClosableDate(value: string): Promise<OperationalDate> {
    const date = assertOperationalDate(value);
    const settings = await posSettingsService.get();
    const today = operationalDateOf(
      new Date(),
      settings.operationalDayCutoffHour,
    );
    if (compareOperationalDates(date, today) > 0) {
      throw new PosProblemError(
        "POS_VALIDATION_ERROR",
        "No se puede consolidar una fecha operativa futura.",
      );
    }
    return date;
  }

  private toPreview(entity: PosDailyClose): DailyClosePreview {
    return {
      operationalDate: entity.operationalDate,
      status: entity.status,
      totals: entity.totals,
      registers: entity.registers,
      cashiers: entity.cashiers,
      cutIds: entity.cutIds,
      blockers: entity.blockers,
      incidentIds: entity.incidentIds,
    };
  }

  /** Totales de un turno recalculados desde las fuentes. Base de los reportes por turno. */
  async shiftTotals(shiftId: string): Promise<PosCutTotals> {
    const shift = await posShiftRepository.requireById(shiftId);
    const [sales, payments, returns, movements, cut] = await Promise.all([
      posSaleRepository.listByShift(shiftId),
      posPaymentRepository.listByShift(shiftId),
      posReturnRepository.listByShift(shiftId),
      posCashMovementRepository.listByShift(shiftId),
      posCutRepository.findByShift(shiftId),
    ]);
    return computeCutTotals({
      openingFloatMinor: shift.receivedFloatMinor,
      countedCashMinor: cut?.totals.countedCashMinor ?? 0,
      sales,
      payments,
      returns,
      movements,
    });
  }
}

export const posDailyCloseService = new PosDailyCloseService();
export default posDailyCloseService;
