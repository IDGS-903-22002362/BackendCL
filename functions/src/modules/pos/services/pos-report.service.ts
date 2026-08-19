/**
 * Reportes operativos del POS.
 *
 * Criterios de conteo, iguales a los del corte y del cierre diario:
 *
 * - Una venta con pago mixto se cuenta una sola vez; el desglose por método no infla el neto.
 * - Los pagos rechazados o cancelados y las ventas canceladas antes del pago no suman importe.
 * - Los reembolsos aparecen en su propio renglón, restados del neto, nunca borrando la venta.
 * - La fecha es siempre la fecha operativa (`America/Mexico_City`), no la fecha UTC del
 *   documento.
 *
 * Rendimiento: nunca se carga una colección completa. Todas las consultas están acotadas por
 * un rango cerrado de fechas operativas validado contra `maxReportRangeDays` y por un límite
 * duro de documentos. Los renglones por turno se construyen sobre las proyecciones
 * (`posShifts.totals`) y el snapshot del corte, que son reconstruibles desde el ledger.
 */

import { canRevealCutResult } from "../domain/cut-classification";
import {
  assertOperationalDate,
  operationalDateDiffInDays,
  operationalDateOf,
} from "../domain/operational-date";
import PosProblemError from "../errors/pos-problem.error";
import {
  PosCapability,
  PosCashMovementStatus,
  PosCashMovementType,
  PosCutClassification,
  PosCutScope,
  PosCutStatus,
  PosDailyCloseStatus,
  PosPaymentMethod,
} from "../models/pos.enums";
import type {
  OperationalDate,
  PosActor,
  PosCut,
  PosPaymentMethodBreakdown,
} from "../models/pos.types";
import { POS_CONSOLIDATION_HARD_LIMIT } from "../repositories/pos-operational.repository";
import {
  posCashMovementRepository,
  posCutRepository,
  posDailyCloseRepository,
  posShiftRepository,
} from "../repositories/pos-operational.repository";
import { posAuthorizationService } from "./pos-authorization.service";
import posSettingsService from "./pos-settings.service";

export interface ReportRange {
  from: OperationalDate;
  to: OperationalDate;
}

export interface ReportFilters {
  from?: string;
  to?: string;
  registerId?: string;
  cashierUid?: string;
}

export interface ShiftReportRow {
  shiftId: string;
  operationalDate: OperationalDate;
  registerId: string;
  registerCode: string;
  cashierUid: string;
  status: string;
  startedAt: string;
  endedAt: string | null;
  receivedFloatMinor: number;
  salesCount: number;
  grossSalesMinor: number;
  discountMinor: number;
  netSalesMinor: number;
  cashSalesMinor: number;
  cardSalesMinor: number;
  cashRefundsMinor: number;
  cardRefundsMinor: number;
  voidedSalesMinor: number;
  cashInMinor: number;
  cashOutMinor: number;
  securityDropsMinor: number;
  transfersInMinor: number;
  transfersOutMinor: number;
  cutId: string | null;
  cutFolio: string | null;
  cutStatus: PosCutStatus | null;
  classification: PosCutClassification | null;
  /** `null` cuando el arqueo ciego aún oculta el resultado a este actor. */
  expectedCashMinor: number | null;
  countedCashMinor: number | null;
  differenceMinor: number | null;
}

export interface ShiftReport {
  range: ReportRange;
  rows: ShiftReportRow[];
  totals: {
    shiftCount: number;
    salesCount: number;
    grossSalesMinor: number;
    discountMinor: number;
    netSalesMinor: number;
    cashSalesMinor: number;
    cardSalesMinor: number;
    refundsMinor: number;
    /** Solo para actores con revisión de cortes; el resto recibe `null`. */
    expectedCashMinor: number | null;
    countedCashMinor: number | null;
    differenceMinor: number | null;
  };
  truncated: boolean;
}

export interface RegisterReportRow {
  registerId: string;
  registerCode: string;
  shiftCount: number;
  sessionIds: string[];
  cashierUids: string[];
  salesCount: number;
  netSalesMinor: number;
  cashSalesMinor: number;
  cardSalesMinor: number;
  refundsMinor: number;
  expectedCashMinor: number;
  countedCashMinor: number;
  differenceMinor: number;
}

export interface CashMovementReportRow {
  movementId: string;
  operationalDate: OperationalDate;
  registerId: string;
  shiftId: string;
  type: PosCashMovementType;
  status: PosCashMovementStatus;
  direction: "IN" | "OUT";
  amountMinor: number;
  reason: string;
  requestedBy: string;
  authorizedBy: string | null;
  receivedBy: string | null;
  targetRegisterId: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

export interface CashMovementReport {
  range: ReportRange;
  rows: CashMovementReportRow[];
  byType: Array<{
    type: PosCashMovementType;
    count: number;
    inMinor: number;
    outMinor: number;
  }>;
  truncated: boolean;
}

export interface DifferenceReportRow {
  cutId: string;
  folio: string;
  operationalDate: OperationalDate;
  registerId: string;
  registerCode: string;
  shiftId: string | null;
  cashierUid: string | null;
  status: PosCutStatus;
  classification: PosCutClassification;
  toleranceMinor: number;
  expectedCashMinor: number;
  countedCashMinor: number;
  differenceMinor: number;
  incidentIds: string[];
  reviewerUid: string | null;
  approverUid: string | null;
  approvedAt: string | null;
}

export interface DifferenceReport {
  range: ReportRange;
  rows: DifferenceReportRow[];
  totals: {
    cutCount: number;
    shortageMinor: number;
    overageMinor: number;
    netDifferenceMinor: number;
    pendingCount: number;
  };
  truncated: boolean;
}

export interface DailySummaryRow {
  operationalDate: OperationalDate;
  status: PosDailyCloseStatus | "NOT_STARTED";
  registerCount: number;
  shiftCount: number;
  salesCount: number;
  netSalesMinor: number;
  refundsMinor: number;
  paymentBreakdown: PosPaymentMethodBreakdown[];
  expectedCashMinor: number;
  countedCashMinor: number;
  differenceMinor: number;
  shortageMinor: number;
  overageMinor: number;
  forced: boolean;
  closedAt: string | null;
}

export interface DailySummaryReport {
  range: ReportRange;
  rows: DailySummaryRow[];
  totals: {
    dayCount: number;
    closedDayCount: number;
    netSalesMinor: number;
    refundsMinor: number;
    differenceMinor: number;
  };
}

function isoOrNull(value: { toDate(): Date } | null | undefined): string | null {
  return value ? value.toDate().toISOString() : null;
}

class PosReportService {
  /** Reporte por turno. Un cajero sin lectura global solo ve sus propios turnos. */
  async shifts(actor: PosActor, filters: ReportFilters): Promise<ShiftReport> {
    posAuthorizationService.requireAnyCapability(actor, [
      PosCapability.REPORT_READ_OWN,
      PosCapability.REPORT_READ_ALL,
    ]);
    const range = await this.resolveRange(filters);
    const cashierUid = posAuthorizationService.scopeCashierFilter(
      actor,
      PosCapability.REPORT_READ_ALL,
      filters.cashierUid,
    );

    const equals: Array<{ field: string; value: unknown }> = [];
    if (filters.registerId) {
      equals.push({ field: "registerId", value: filters.registerId });
    }
    if (cashierUid) equals.push({ field: "cashierUid", value: cashierUid });

    const [shifts, cuts] = await Promise.all([
      posShiftRepository.collectByOperationalDateRange(
        range.from,
        range.to,
        equals,
        POS_CONSOLIDATION_HARD_LIMIT,
      ),
      posCutRepository.collectByOperationalDateRange(
        range.from,
        range.to,
        filters.registerId
          ? [{ field: "registerId", value: filters.registerId }]
          : [],
        POS_CONSOLIDATION_HARD_LIMIT,
      ),
    ]);

    const cutByShift = new Map<string, PosCut>(
      cuts
        .filter(
          (cut): cut is PosCut & { shiftId: string } =>
            cut.scope === PosCutScope.SHIFT && cut.shiftId !== null,
        )
        .map((cut) => [cut.shiftId, cut]),
    );

    const canSeeAllResults = actor.capabilities.includes(PosCapability.CUT_REVIEW);

    const rows: ShiftReportRow[] = shifts.map((shift) => {
      const cut = cutByShift.get(shift.id) ?? null;
      const reveal = canRevealCutResult(actor, cut);
      return {
        shiftId: shift.id,
        operationalDate: shift.operationalDate,
        registerId: shift.registerId,
        registerCode: shift.registerCode,
        cashierUid: shift.cashierUid,
        status: shift.status,
        startedAt: shift.startedAt.toDate().toISOString(),
        endedAt: isoOrNull(shift.endedAt),
        receivedFloatMinor: shift.receivedFloatMinor,
        salesCount: shift.totals.salesCount,
        grossSalesMinor: shift.totals.grossSalesMinor,
        discountMinor: shift.totals.discountMinor,
        netSalesMinor: shift.totals.netSalesMinor,
        cashSalesMinor: shift.totals.cashSalesMinor,
        cardSalesMinor: shift.totals.cardSalesMinor,
        cashRefundsMinor: shift.totals.cashRefundsMinor,
        cardRefundsMinor: shift.totals.cardRefundsMinor,
        voidedSalesMinor: shift.totals.voidedSalesMinor,
        cashInMinor: shift.totals.cashInMinor,
        cashOutMinor: shift.totals.cashOutMinor,
        securityDropsMinor: shift.totals.securityDropsMinor,
        transfersInMinor: shift.totals.transfersInMinor,
        transfersOutMinor: shift.totals.transfersOutMinor,
        cutId: cut?.id ?? null,
        cutFolio: cut?.folio ?? null,
        cutStatus: cut?.status ?? null,
        classification: cut?.classification ?? null,
        expectedCashMinor: reveal ? (cut?.totals.expectedCashMinor ?? null) : null,
        countedCashMinor: reveal ? (cut?.totals.countedCashMinor ?? null) : null,
        differenceMinor: reveal ? (cut?.totals.differenceMinor ?? null) : null,
      };
    });

    return {
      range,
      rows,
      totals: {
        shiftCount: rows.length,
        salesCount: rows.reduce((total, row) => total + row.salesCount, 0),
        grossSalesMinor: rows.reduce(
          (total, row) => total + row.grossSalesMinor,
          0,
        ),
        discountMinor: rows.reduce((total, row) => total + row.discountMinor, 0),
        netSalesMinor: rows.reduce((total, row) => total + row.netSalesMinor, 0),
        cashSalesMinor: rows.reduce((total, row) => total + row.cashSalesMinor, 0),
        cardSalesMinor: rows.reduce((total, row) => total + row.cardSalesMinor, 0),
        refundsMinor: rows.reduce(
          (total, row) => total + row.cashRefundsMinor + row.cardRefundsMinor,
          0,
        ),
        expectedCashMinor: canSeeAllResults
          ? rows.reduce((total, row) => total + (row.expectedCashMinor ?? 0), 0)
          : null,
        countedCashMinor: canSeeAllResults
          ? rows.reduce((total, row) => total + (row.countedCashMinor ?? 0), 0)
          : null,
        differenceMinor: canSeeAllResults
          ? rows.reduce((total, row) => total + (row.differenceMinor ?? 0), 0)
          : null,
      },
      truncated: shifts.length >= POS_CONSOLIDATION_HARD_LIMIT,
    };
  }

  /** Reporte por caja. Consolida cifras de varios cajeros: exige lectura global. */
  async registers(
    actor: PosActor,
    filters: ReportFilters,
  ): Promise<{ range: ReportRange; rows: RegisterReportRow[]; truncated: boolean }> {
    posAuthorizationService.requireCapability(
      actor,
      PosCapability.REPORT_READ_ALL,
    );
    const report = await this.shifts(actor, { ...filters, cashierUid: undefined });

    const byRegister = new Map<string, RegisterReportRow>();
    for (const row of report.rows) {
      const current = byRegister.get(row.registerId) ?? {
        registerId: row.registerId,
        registerCode: row.registerCode,
        shiftCount: 0,
        sessionIds: [],
        cashierUids: [],
        salesCount: 0,
        netSalesMinor: 0,
        cashSalesMinor: 0,
        cardSalesMinor: 0,
        refundsMinor: 0,
        expectedCashMinor: 0,
        countedCashMinor: 0,
        differenceMinor: 0,
      };
      current.shiftCount += 1;
      current.salesCount += row.salesCount;
      current.netSalesMinor += row.netSalesMinor;
      current.cashSalesMinor += row.cashSalesMinor;
      current.cardSalesMinor += row.cardSalesMinor;
      current.refundsMinor += row.cashRefundsMinor + row.cardRefundsMinor;
      current.expectedCashMinor += row.expectedCashMinor ?? 0;
      current.countedCashMinor += row.countedCashMinor ?? 0;
      current.differenceMinor += row.differenceMinor ?? 0;
      if (!current.cashierUids.includes(row.cashierUid)) {
        current.cashierUids.push(row.cashierUid);
      }
      byRegister.set(row.registerId, current);
    }

    return {
      range: report.range,
      rows: Array.from(byRegister.values()).sort((a, b) =>
        a.registerCode.localeCompare(b.registerCode),
      ),
      truncated: report.truncated,
    };
  }

  /** Ledger de efectivo del periodo con su agregado por tipo. */
  async cashMovements(
    actor: PosActor,
    filters: ReportFilters & {
      type?: PosCashMovementType;
      status?: PosCashMovementStatus;
    },
  ): Promise<CashMovementReport> {
    posAuthorizationService.requireAnyCapability(actor, [
      PosCapability.REPORT_READ_OWN,
      PosCapability.REPORT_READ_ALL,
    ]);
    const range = await this.resolveRange(filters);

    const equals: Array<{ field: string; value: unknown }> = [];
    if (filters.registerId) {
      equals.push({ field: "registerId", value: filters.registerId });
    }
    if (filters.type) equals.push({ field: "type", value: filters.type });
    if (filters.status) equals.push({ field: "status", value: filters.status });

    // Sin lectura global el reporte se limita a lo que el propio actor solicitó.
    if (!actor.capabilities.includes(PosCapability.REPORT_READ_ALL)) {
      equals.push({ field: "requestedBy", value: actor.uid });
    }

    const movements = await posCashMovementRepository.collectByOperationalDateRange(
      range.from,
      range.to,
      equals,
      POS_CONSOLIDATION_HARD_LIMIT,
    );

    const byType = new Map<
      PosCashMovementType,
      { type: PosCashMovementType; count: number; inMinor: number; outMinor: number }
    >();
    for (const movement of movements) {
      const current = byType.get(movement.type) ?? {
        type: movement.type,
        count: 0,
        inMinor: 0,
        outMinor: 0,
      };
      current.count += 1;
      if (movement.direction === "IN") {
        current.inMinor += movement.amountMinor;
      } else {
        current.outMinor += movement.amountMinor;
      }
      byType.set(movement.type, current);
    }

    return {
      range,
      rows: movements.map((movement) => ({
        movementId: movement.id,
        operationalDate: movement.operationalDate,
        registerId: movement.registerId,
        shiftId: movement.shiftId,
        type: movement.type,
        status: movement.status,
        direction: movement.direction,
        amountMinor: movement.amountMinor,
        reason: movement.reason,
        requestedBy: movement.requestedBy,
        authorizedBy: movement.authorizedBy ?? null,
        receivedBy: movement.receivedBy ?? null,
        targetRegisterId: movement.targetRegisterId ?? null,
        createdAt: movement.createdAt.toDate().toISOString(),
        resolvedAt: isoOrNull(movement.resolvedAt),
      })),
      byType: Array.from(byType.values()),
      truncated: movements.length >= POS_CONSOLIDATION_HARD_LIMIT,
    };
  }

  /** Sobrantes y faltantes. Expone cifras de arqueo, por lo que exige revisión de cortes. */
  async differences(
    actor: PosActor,
    filters: ReportFilters & { classification?: PosCutClassification },
  ): Promise<DifferenceReport> {
    posAuthorizationService.requireCapability(actor, PosCapability.CUT_REVIEW);
    const range = await this.resolveRange(filters);

    const equals: Array<{ field: string; value: unknown }> = [];
    if (filters.registerId) {
      equals.push({ field: "registerId", value: filters.registerId });
    }
    if (filters.cashierUid) {
      equals.push({ field: "cashierUid", value: filters.cashierUid });
    }
    if (filters.classification) {
      equals.push({ field: "classification", value: filters.classification });
    }

    const cuts = await posCutRepository.collectByOperationalDateRange(
      range.from,
      range.to,
      equals,
      POS_CONSOLIDATION_HARD_LIMIT,
    );

    const relevant = cuts.filter(
      (cut) =>
        cut.scope === PosCutScope.SHIFT && cut.totals.differenceMinor !== 0,
    );

    return {
      range,
      rows: relevant.map((cut) => ({
        cutId: cut.id,
        folio: cut.folio,
        operationalDate: cut.operationalDate,
        registerId: cut.registerId,
        registerCode: cut.registerCode,
        shiftId: cut.shiftId,
        cashierUid: cut.cashierUid,
        status: cut.status,
        classification: cut.classification,
        toleranceMinor: cut.toleranceMinor,
        expectedCashMinor: cut.totals.expectedCashMinor,
        countedCashMinor: cut.totals.countedCashMinor,
        differenceMinor: cut.totals.differenceMinor,
        incidentIds: cut.incidentIds,
        reviewerUid: cut.reviewerUid ?? null,
        approverUid: cut.approverUid ?? null,
        approvedAt: isoOrNull(cut.approvedAt),
      })),
      totals: {
        cutCount: relevant.length,
        shortageMinor: relevant.reduce(
          (total, cut) =>
            cut.totals.differenceMinor < 0
              ? total + Math.abs(cut.totals.differenceMinor)
              : total,
          0,
        ),
        overageMinor: relevant.reduce(
          (total, cut) =>
            cut.totals.differenceMinor > 0
              ? total + cut.totals.differenceMinor
              : total,
          0,
        ),
        netDifferenceMinor: relevant.reduce(
          (total, cut) => total + cut.totals.differenceMinor,
          0,
        ),
        pendingCount: relevant.filter(
          (cut) =>
            cut.status !== PosCutStatus.APPROVED &&
            cut.status !== PosCutStatus.CLOSED,
        ).length,
      },
      truncated: cuts.length >= POS_CONSOLIDATION_HARD_LIMIT,
    };
  }

  /**
   * Resumen por día a partir de los cierres consolidados. Los días sin cierre aparecen como
   * `NOT_STARTED` en lugar de recalcularse: el resumen diario es el snapshot del cierre.
   */
  async dailySummary(
    actor: PosActor,
    filters: ReportFilters,
  ): Promise<DailySummaryReport> {
    posAuthorizationService.requireCapability(
      actor,
      PosCapability.REPORT_READ_ALL,
    );
    const range = await this.resolveRange(filters);

    const closures = await posDailyCloseRepository.collectByOperationalDateRange(
      range.from,
      range.to,
      [],
      400,
    );
    const byDate = new Map(
      closures.map((closure) => [closure.operationalDate, closure]),
    );

    const rows: DailySummaryRow[] = [];
    for (const date of this.enumerateDates(range)) {
      const closure = byDate.get(date);
      if (!closure) {
        rows.push({
          operationalDate: date,
          status: "NOT_STARTED",
          registerCount: 0,
          shiftCount: 0,
          salesCount: 0,
          netSalesMinor: 0,
          refundsMinor: 0,
          paymentBreakdown: [],
          expectedCashMinor: 0,
          countedCashMinor: 0,
          differenceMinor: 0,
          shortageMinor: 0,
          overageMinor: 0,
          forced: false,
          closedAt: null,
        });
        continue;
      }
      rows.push({
        operationalDate: date,
        status: closure.status,
        registerCount: closure.totals.registerCount,
        shiftCount: closure.totals.shiftCount,
        salesCount: closure.totals.salesCount,
        netSalesMinor: closure.totals.netSalesMinor,
        refundsMinor: closure.totals.refundsMinor,
        paymentBreakdown: closure.totals.paymentBreakdown,
        expectedCashMinor: closure.totals.expectedCashMinor,
        countedCashMinor: closure.totals.countedCashMinor,
        differenceMinor: closure.totals.differenceMinor,
        shortageMinor: closure.totals.shortageMinor,
        overageMinor: closure.totals.overageMinor,
        forced: closure.forced,
        closedAt: isoOrNull(closure.closedAt),
      });
    }

    return {
      range,
      rows,
      totals: {
        dayCount: rows.length,
        closedDayCount: rows.filter(
          (row) =>
            row.status === PosDailyCloseStatus.CLOSED ||
            row.status === PosDailyCloseStatus.FORCED_CLOSED,
        ).length,
        netSalesMinor: rows.reduce((total, row) => total + row.netSalesMinor, 0),
        refundsMinor: rows.reduce((total, row) => total + row.refundsMinor, 0),
        differenceMinor: rows.reduce(
          (total, row) => total + row.differenceMinor,
          0,
        ),
      },
    };
  }

  /** Desglose de conciliación por método de pago del periodo. */
  async paymentReconciliation(
    actor: PosActor,
    filters: ReportFilters,
  ): Promise<{
    range: ReportRange;
    methods: PosPaymentMethodBreakdown[];
  }> {
    posAuthorizationService.requireCapability(
      actor,
      PosCapability.REPORT_READ_ALL,
    );
    const range = await this.resolveRange(filters);
    const cuts = await posCutRepository.collectByOperationalDateRange(
      range.from,
      range.to,
      filters.registerId
        ? [{ field: "registerId", value: filters.registerId }]
        : [],
      POS_CONSOLIDATION_HARD_LIMIT,
    );

    const methods = new Map<PosPaymentMethod, PosPaymentMethodBreakdown>();
    for (const cut of cuts) {
      if (cut.scope !== PosCutScope.SHIFT) {
        continue;
      }
      for (const entry of cut.totals.paymentBreakdown) {
        const current = methods.get(entry.method) ?? {
          method: entry.method,
          count: 0,
          amountMinor: 0,
          refundedMinor: 0,
          netMinor: 0,
        };
        current.count += entry.count;
        current.amountMinor += entry.amountMinor;
        current.refundedMinor += entry.refundedMinor;
        current.netMinor += entry.netMinor;
        methods.set(entry.method, current);
      }
    }

    return { range, methods: Array.from(methods.values()) };
  }

  /**
   * Rango por defecto: el día operativo en curso. El límite superior de días es configurable
   * (`maxReportRangeDays`) y se valida siempre en backend.
   */
  async resolveRange(filters: ReportFilters): Promise<ReportRange> {
    const settings = await posSettingsService.get();
    const today = operationalDateOf(
      new Date(),
      settings.operationalDayCutoffHour,
    );
    const from = filters.from ? assertOperationalDate(filters.from) : today;
    const to = filters.to ? assertOperationalDate(filters.to) : today;

    const span = operationalDateDiffInDays(from, to);
    if (span < 0) {
      throw new PosProblemError(
        "POS_VALIDATION_ERROR",
        "La fecha inicial no puede ser posterior a la final.",
      );
    }
    if (span + 1 > settings.maxReportRangeDays) {
      throw new PosProblemError(
        "EXPORT_RANGE_TOO_LARGE",
        `El rango máximo permitido es de ${settings.maxReportRangeDays} días.`,
      );
    }
    return { from, to };
  }

  private enumerateDates(range: ReportRange): OperationalDate[] {
    const dates: OperationalDate[] = [];
    const span = operationalDateDiffInDays(range.from, range.to);
    for (let offset = 0; offset <= span; offset += 1) {
      const [year, month, day] = range.from.split("-").map(Number);
      const utc = new Date(Date.UTC(year, month - 1, day + offset));
      dates.push(
        [
          utc.getUTCFullYear(),
          String(utc.getUTCMonth() + 1).padStart(2, "0"),
          String(utc.getUTCDate()).padStart(2, "0"),
        ].join("-"),
      );
    }
    return dates;
  }
}

export const posReportService = new PosReportService();
export default posReportService;
