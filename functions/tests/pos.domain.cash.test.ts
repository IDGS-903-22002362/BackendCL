import { describe, expect, it } from "@jest/globals";
import {
  cashDifferenceMinor,
  computeCashCount,
  resolveCountedCash,
} from "../src/modules/pos/domain/cash-count";
import {
  canRevealCutResult,
  classifyCutDifference,
  differenceSeverityRank,
} from "../src/modules/pos/domain/cut-classification";
import { computeExpectedCash } from "../src/modules/pos/domain/expected-cash";
import PosProblemError from "../src/modules/pos/errors/pos-problem.error";
import {
  PosCapability,
  PosCashMovementStatus,
  PosCashMovementType,
  PosCutClassification,
  PosCutStatus,
  PosRole,
} from "../src/modules/pos/models/pos.enums";
import { POS_DEFAULT_DENOMINATIONS_MINOR } from "../src/modules/pos/constants/pos.constants";

const thresholds = {
  cutToleranceMinor: 1_000,
  supervisorDifferenceLimitMinor: 20_000,
  adminDifferenceLimitMinor: 100_000,
};

type Movement = {
  type: PosCashMovementType;
  status: PosCashMovementStatus;
  amountMinor: number;
  direction: "IN" | "OUT";
};

const movement = (
  type: PosCashMovementType,
  status: PosCashMovementStatus,
  amountMinor: number,
  direction: "IN" | "OUT" = "IN",
): Movement => ({ type, status, amountMinor, direction });

describe("POS conteo por denominaciones", () => {
  it("recalcula el total desde las piezas declaradas", () => {
    const result = computeCashCount(
      [
        { denominationMinor: 50_000, pieces: 2 },
        { denominationMinor: 10_000, pieces: 3 },
        { denominationMinor: 50, pieces: 4 },
      ],
      POS_DEFAULT_DENOMINATIONS_MINOR,
    );

    expect(result.countedCashMinor).toBe(130_200);
    expect(result.denominations[0].denominationMinor).toBe(50_000);
    expect(result.denominations[0].subtotalMinor).toBe(100_000);
  });

  it("acepta un conteo de cero expresado con piezas en cero", () => {
    const result = computeCashCount(
      [{ denominationMinor: 100, pieces: 0 }],
      POS_DEFAULT_DENOMINATIONS_MINOR,
    );
    expect(result.countedCashMinor).toBe(0);
  });

  it("rechaza denominaciones no configuradas, duplicadas o piezas inválidas", () => {
    expect(() =>
      computeCashCount(
        [{ denominationMinor: 3_333, pieces: 1 }],
        POS_DEFAULT_DENOMINATIONS_MINOR,
      ),
    ).toThrow(PosProblemError);

    expect(() =>
      computeCashCount(
        [
          { denominationMinor: 10_000, pieces: 1 },
          { denominationMinor: 10_000, pieces: 2 },
        ],
        POS_DEFAULT_DENOMINATIONS_MINOR,
      ),
    ).toThrow(PosProblemError);

    expect(() =>
      computeCashCount(
        [{ denominationMinor: 10_000, pieces: -1 }],
        POS_DEFAULT_DENOMINATIONS_MINOR,
      ),
    ).toThrow(PosProblemError);

    expect(() => computeCashCount([], POS_DEFAULT_DENOMINATIONS_MINOR)).toThrow(
      PosProblemError,
    );
  });

  it("acepta countedCashMinor sin denominaciones vía resolveCountedCash", () => {
    const result = resolveCountedCash({
      countedCashMinor: 12_500,
      allowedDenominationsMinor: POS_DEFAULT_DENOMINATIONS_MINOR,
    });
    expect(result.countedCashMinor).toBe(12_500);
    expect(result.denominations).toEqual([]);
  });

  it("prefiere denominaciones sobre countedCashMinor cuando ambas llegan", () => {
    const result = resolveCountedCash({
      denominations: [{ denominationMinor: 10_000, pieces: 2 }],
      countedCashMinor: 999_999,
      allowedDenominationsMinor: POS_DEFAULT_DENOMINATIONS_MINOR,
    });
    expect(result.countedCashMinor).toBe(20_000);
  });

  it("interpreta la diferencia como contado menos esperado", () => {
    expect(cashDifferenceMinor(100_000, 100_000)).toBe(0);
    expect(cashDifferenceMinor(100_500, 100_000)).toBe(500);
    expect(cashDifferenceMinor(99_500, 100_000)).toBe(-500);
  });
});

describe("POS efectivo esperado", () => {
  it("suma entradas efectivas y resta salidas efectivas", () => {
    const breakdown = computeExpectedCash({
      openingFloatMinor: 100_000,
      movements: [
        movement(PosCashMovementType.CASH_SALE, PosCashMovementStatus.APPROVED, 50_000),
        movement(PosCashMovementType.CASH_IN, PosCashMovementStatus.APPROVED, 10_000),
        movement(
          PosCashMovementType.CASH_REPLENISHMENT,
          PosCashMovementStatus.APPROVED,
          5_000,
        ),
        movement(PosCashMovementType.TRANSFER_IN, PosCashMovementStatus.RECEIVED, 20_000),
        movement(
          PosCashMovementType.CASH_REFUND,
          PosCashMovementStatus.APPROVED,
          7_000,
          "OUT",
        ),
        movement(PosCashMovementType.CASH_OUT, PosCashMovementStatus.APPROVED, 3_000, "OUT"),
        movement(
          PosCashMovementType.SECURITY_DROP,
          PosCashMovementStatus.RECEIVED,
          40_000,
          "OUT",
        ),
      ],
    });

    expect(breakdown.expectedCashMinor).toBe(135_000);
    expect(breakdown.cashSalesMinor).toBe(50_000);
    expect(breakdown.securityDropsMinor).toBe(40_000);
  });

  it("ignora tarjeta, pendientes, rechazados y el fondo duplicado del ledger", () => {
    const breakdown = computeExpectedCash({
      openingFloatMinor: 100_000,
      movements: [
        movement(
          PosCashMovementType.OPENING_FLOAT,
          PosCashMovementStatus.APPROVED,
          100_000,
        ),
        movement(
          PosCashMovementType.CASH_IN,
          PosCashMovementStatus.PENDING_AUTHORIZATION,
          50_000,
        ),
        movement(PosCashMovementType.CASH_OUT, PosCashMovementStatus.REJECTED, 50_000, "OUT"),
        movement(PosCashMovementType.CASH_IN, PosCashMovementStatus.CANCELLED, 50_000),
      ],
    });

    expect(breakdown.expectedCashMinor).toBe(100_000);
  });

  it("no descuenta una transferencia despachada hasta que se confirma la recepción", () => {
    const inTransit = computeExpectedCash({
      openingFloatMinor: 100_000,
      movements: [
        movement(
          PosCashMovementType.TRANSFER_OUT,
          PosCashMovementStatus.IN_TRANSIT,
          30_000,
          "OUT",
        ),
      ],
    });
    expect(inTransit.expectedCashMinor).toBe(100_000);
    expect(inTransit.transfersInTransitMinor).toBe(30_000);

    const received = computeExpectedCash({
      openingFloatMinor: 100_000,
      movements: [
        movement(
          PosCashMovementType.TRANSFER_OUT,
          PosCashMovementStatus.RECEIVED,
          30_000,
          "OUT",
        ),
      ],
    });
    expect(received.expectedCashMinor).toBe(70_000);
  });

  it("distingue la dirección de un ajuste autorizado", () => {
    const entrada = computeExpectedCash({
      openingFloatMinor: 0,
      movements: [
        movement(
          PosCashMovementType.AUTHORIZED_ADJUSTMENT,
          PosCashMovementStatus.APPROVED,
          1_500,
          "IN",
        ),
      ],
    });
    const salida = computeExpectedCash({
      openingFloatMinor: 0,
      movements: [
        movement(
          PosCashMovementType.AUTHORIZED_ADJUSTMENT,
          PosCashMovementStatus.APPROVED,
          1_500,
          "OUT",
        ),
      ],
    });

    expect(entrada.expectedCashMinor).toBe(1_500);
    expect(salida.expectedCashMinor).toBe(-1_500);
  });
});

describe("POS clasificación de diferencias", () => {
  it("clasifica sin diferencia y dentro de tolerancia", () => {
    expect(classifyCutDifference(0, thresholds).classification).toBe(
      PosCutClassification.BALANCED,
    );
    const tolerada = classifyCutDifference(-1_000, thresholds);
    expect(tolerada.classification).toBe(PosCutClassification.WITHIN_TOLERANCE);
    expect(tolerada.requiresObservation).toBe(false);
  });

  it("distingue faltante de sobrante y exige observación", () => {
    const faltante = classifyCutDifference(-5_000, thresholds);
    expect(faltante.classification).toBe(PosCutClassification.SHORTAGE);
    expect(faltante.requiresObservation).toBe(true);
    expect(faltante.requiredApproverRole).toBe(PosRole.SUPERVISOR);

    const sobrante = classifyCutDifference(5_000, thresholds);
    expect(sobrante.classification).toBe(PosCutClassification.OVERAGE);
  });

  it("escala a administrador y a diferencia crítica según el umbral", () => {
    const admin = classifyCutDifference(-50_000, thresholds);
    expect(admin.requiredApproverRole).toBe(PosRole.ADMIN);
    expect(admin.requiresIncident).toBe(true);

    const critica = classifyCutDifference(-150_000, thresholds);
    expect(critica.classification).toBe(PosCutClassification.CRITICAL_DIFFERENCE);
    expect(critica.requiredApproverRole).toBe(PosRole.SUPER_ADMIN);
    expect(critica.requiresIncident).toBe(true);
  });

  it("gradúa la severidad de la incidencia", () => {
    expect(differenceSeverityRank(500, thresholds)).toBe("LOW");
    expect(differenceSeverityRank(-5_000, thresholds)).toBe("MEDIUM");
    expect(differenceSeverityRank(-50_000, thresholds)).toBe("HIGH");
    expect(differenceSeverityRank(-500_000, thresholds)).toBe("CRITICAL");
  });
});

describe("POS visibilidad de totales del corte", () => {
  const cashier = { uid: "cajero-1", capabilities: [PosCapability.CUT_CREATE_OWN] };
  const supervisor = { uid: "supervisor-1", capabilities: [PosCapability.CUT_REVIEW] };
  const adminReader = {
    uid: "admin-1",
    capabilities: [PosCapability.CUT_READ_ALL],
  };

  it("revela totales al cajero dueño durante COUNTING y al resolver", () => {
    expect(
      canRevealCutResult(cashier, {
        cashierUid: "cajero-1",
        status: PosCutStatus.COUNTING,
      }),
    ).toBe(true);
    expect(
      canRevealCutResult(cashier, {
        cashierUid: "cajero-1",
        status: PosCutStatus.APPROVED,
      }),
    ).toBe(true);
  });

  it("revela a quien tiene cut.read_all o cut.review", () => {
    const cut = { cashierUid: "cajero-1", status: PosCutStatus.SUBMITTED };
    expect(canRevealCutResult(supervisor, cut)).toBe(true);
    expect(canRevealCutResult(adminReader, cut)).toBe(true);
  });

  it("nunca revela el corte de otro cajero sin cut.read_all", () => {
    expect(
      canRevealCutResult(cashier, {
        cashierUid: "cajero-2",
        status: PosCutStatus.APPROVED,
      }),
    ).toBe(false);
  });
});
