import { describe, expect, it } from "@jest/globals";
import {
  canReadOtherCashiers,
  capabilitiesForRole,
  hasCapability,
  isSelfApproval,
  manualDiscountLimitMinor,
  POS_CAPABILITY_MATRIX,
  resolvePosRole,
  roleAtLeast,
} from "../src/modules/pos/domain/capabilities";
import {
  assertTransition,
  availableActions,
  canTransition,
  getTransition,
} from "../src/modules/pos/domain/state-machines";
import PosProblemError from "../src/modules/pos/errors/pos-problem.error";
import { RolUsuario } from "../src/models/usuario.model";
import {
  PosCapability,
  PosCashMovementStatus,
  PosCutStatus,
  PosDailyCloseStatus,
  PosRegisterStatus,
  PosRole,
  PosSaleStatus,
  PosShiftStatus,
} from "../src/modules/pos/models/pos.enums";

describe("POS matriz de capacidades", () => {
  it("un cajero no puede aprobar cortes ni leer datos de otros", () => {
    const cashier = { capabilities: capabilitiesForRole(PosRole.CASHIER) };
    expect(hasCapability(cashier, PosCapability.CUT_CREATE_OWN)).toBe(true);
    expect(hasCapability(cashier, PosCapability.CUT_APPROVE)).toBe(false);
    expect(hasCapability(cashier, PosCapability.CUT_READ_ALL)).toBe(false);
    expect(hasCapability(cashier, PosCapability.SHIFT_READ_ALL)).toBe(false);
    expect(hasCapability(cashier, PosCapability.SALE_DISCOUNT_MANUAL)).toBe(false);
    expect(hasCapability(cashier, PosCapability.SALE_REFUND)).toBe(false);
    expect(hasCapability(cashier, PosCapability.AUDIT_READ)).toBe(false);
    expect(hasCapability(cashier, PosCapability.CONFIG_MANAGE)).toBe(false);
    expect(canReadOtherCashiers(cashier)).toBe(false);
  });

  it("solo supervisor y superiores revisan cortes", () => {
    const senior = { capabilities: capabilitiesForRole(PosRole.SENIOR_CASHIER) };
    const supervisor = { capabilities: capabilitiesForRole(PosRole.SUPERVISOR) };
    expect(hasCapability(senior, PosCapability.CUT_REVIEW)).toBe(false);
    expect(hasCapability(supervisor, PosCapability.CUT_REVIEW)).toBe(true);
    expect(canReadOtherCashiers(supervisor)).toBe(true);
  });

  it("el cierre forzado y la reapertura quedan reservados a administración", () => {
    const supervisor = { capabilities: capabilitiesForRole(PosRole.SUPERVISOR) };
    const admin = { capabilities: capabilitiesForRole(PosRole.ADMIN) };
    const superAdmin = { capabilities: capabilitiesForRole(PosRole.SUPER_ADMIN) };

    expect(hasCapability(supervisor, PosCapability.CUT_REOPEN)).toBe(false);
    expect(hasCapability(supervisor, PosCapability.DAILY_CLOSE_EXECUTE)).toBe(false);
    expect(hasCapability(admin, PosCapability.DAILY_CLOSE_EXECUTE)).toBe(true);
    expect(hasCapability(admin, PosCapability.DAILY_CLOSE_FORCE)).toBe(false);
    expect(hasCapability(superAdmin, PosCapability.DAILY_CLOSE_FORCE)).toBe(true);
  });

  it("las capacidades son acumulativas y sin duplicados", () => {
    for (const role of Object.values(PosRole)) {
      const capabilities = POS_CAPABILITY_MATRIX[role];
      expect(new Set(capabilities).size).toBe(capabilities.length);
      expect(capabilities).toContain(PosCapability.ACCESS);
    }
    expect(capabilitiesForRole(PosRole.SUPER_ADMIN).length).toBeGreaterThan(
      capabilitiesForRole(PosRole.ADMIN).length,
    );
  });

  it("deriva el rol POS del rol base por mínimo privilegio", () => {
    expect(resolvePosRole(RolUsuario.SUPER_ADMIN)).toBe(PosRole.SUPER_ADMIN);
    expect(resolvePosRole(RolUsuario.ADMIN)).toBe(PosRole.ADMIN);
    expect(resolvePosRole(RolUsuario.EMPLEADO)).toBe(PosRole.CASHIER);
    expect(resolvePosRole(RolUsuario.EMPLEADO, PosRole.SUPERVISOR)).toBe(
      PosRole.SUPERVISOR,
    );
    expect(resolvePosRole(RolUsuario.CLIENTE)).toBeNull();
    expect(resolvePosRole(undefined)).toBeNull();
    expect(resolvePosRole("rol-inventado")).toBeNull();
  });

  it("ordena roles y limita el descuento manual por rol", () => {
    expect(roleAtLeast(PosRole.SUPERVISOR, PosRole.SENIOR_CASHIER)).toBe(true);
    expect(roleAtLeast(PosRole.CASHIER, PosRole.SUPERVISOR)).toBe(false);

    const limits = {
      cashierManualDiscountLimitMinor: 0,
      seniorCashierManualDiscountLimitMinor: 5_000,
      supervisorManualDiscountLimitMinor: 20_000,
      adminManualDiscountLimitMinor: 100_000,
    };
    expect(manualDiscountLimitMinor(PosRole.CASHIER, limits)).toBe(0);
    expect(manualDiscountLimitMinor(PosRole.SENIOR_CASHIER, limits)).toBe(5_000);
    expect(manualDiscountLimitMinor(PosRole.SUPER_ADMIN, limits)).toBe(100_000);
  });

  it("nadie autoriza su propia solicitud", () => {
    expect(isSelfApproval("uid-1", "uid-1")).toBe(true);
    expect(isSelfApproval("uid-1", "uid-2")).toBe(false);
  });
});

describe("POS máquinas de estado", () => {
  it("rechaza acciones inexistentes", () => {
    expect(() => getTransition("sale", "teletransportar")).toThrow(PosProblemError);
    expect(() => assertTransition("sale", "teletransportar", PosSaleStatus.DRAFT)).toThrow(
      /no está definida/i,
    );
  });

  it("una venta pagada no puede cancelarse: debe pasar por devolución", () => {
    expect(canTransition("sale", "cancel", PosSaleStatus.PAID)).toBe(false);
    expect(() => assertTransition("sale", "cancel", PosSaleStatus.PAID)).toThrow(
      PosProblemError,
    );
    expect(assertTransition("sale", "void", PosSaleStatus.PAID)).toBe(
      PosSaleStatus.VOIDED,
    );
    expect(assertTransition("sale", "refund", PosSaleStatus.PAID)).toBe(
      PosSaleStatus.REFUNDED,
    );
  });

  it("una venta solo se paga desde pago pendiente", () => {
    expect(assertTransition("sale", "checkout", PosSaleStatus.DRAFT)).toBe(
      PosSaleStatus.PAYMENT_PENDING,
    );
    expect(assertTransition("sale", "pay", PosSaleStatus.PAYMENT_PENDING)).toBe(
      PosSaleStatus.PAID,
    );
    expect(() => assertTransition("sale", "pay", PosSaleStatus.DRAFT)).toThrow(
      PosProblemError,
    );
    expect(() => assertTransition("sale", "pay", PosSaleStatus.PAID)).toThrow(
      PosProblemError,
    );
  });

  it("no se abre dos veces la misma caja", () => {
    expect(assertTransition("register", "open", PosRegisterStatus.AVAILABLE)).toBe(
      PosRegisterStatus.OPEN,
    );
    expect(() => assertTransition("register", "open", PosRegisterStatus.OPEN)).toThrow(
      PosProblemError,
    );
    expect(() =>
      assertTransition("register", "open", PosRegisterStatus.BLOCKED),
    ).toThrow(PosProblemError);
    expect(() =>
      assertTransition("register", "archive", PosRegisterStatus.OPEN),
    ).toThrow(PosProblemError);
  });

  it("el corte declara separación de responsabilidades y motivo obligatorio", () => {
    const approve = getTransition("cut", "approve");
    expect(approve.forbidsSelfApproval).toBe(true);
    expect(approve.capability).toBe(PosCapability.CUT_APPROVE);

    const reject = getTransition("cut", "reject");
    expect(reject.requiresReason).toBe(true);
    expect(reject.forbidsSelfApproval).toBe(true);

    const reopen = getTransition("cut", "reopen");
    expect(reopen.requiresReason).toBe(true);
    expect(reopen.capability).toBe(PosCapability.CUT_REOPEN);
  });

  it("un corte aprobado ya no se aprueba ni se reenvía", () => {
    expect(() => assertTransition("cut", "approve", PosCutStatus.APPROVED)).toThrow(
      PosProblemError,
    );
    expect(() => assertTransition("cut", "submit", PosCutStatus.APPROVED)).toThrow(
      PosProblemError,
    );
    expect(assertTransition("cut", "reopen", PosCutStatus.APPROVED)).toBe(
      PosCutStatus.REOPENED,
    );
    expect(assertTransition("cut", "start-count", PosCutStatus.REOPENED)).toBe(
      PosCutStatus.COUNTING,
    );
  });

  it("el turno solo entrega después de enviar su arqueo", () => {
    expect(() =>
      assertTransition("shift", "request-handoff", PosShiftStatus.ACTIVE),
    ).toThrow(PosProblemError);
    expect(
      assertTransition("shift", "request-handoff", PosShiftStatus.SUBMITTED),
    ).toBe(PosShiftStatus.HANDOFF_PENDING);
    expect(assertTransition("shift", "force-close", PosShiftStatus.ACTIVE)).toBe(
      PosShiftStatus.FORCED_CLOSED,
    );
  });

  it("una transferencia solo se recibe después de estar en tránsito", () => {
    expect(() =>
      assertTransition(
        "cashMovement",
        "confirm-receipt",
        PosCashMovementStatus.APPROVED,
      ),
    ).toThrow(PosProblemError);
    expect(
      assertTransition(
        "cashMovement",
        "confirm-receipt",
        PosCashMovementStatus.IN_TRANSIT,
      ),
    ).toBe(PosCashMovementStatus.RECEIVED);
    expect(() =>
      assertTransition(
        "cashMovement",
        "confirm-receipt",
        PosCashMovementStatus.RECEIVED,
      ),
    ).toThrow(PosProblemError);
    expect(getTransition("cashMovement", "approve").forbidsSelfApproval).toBe(true);
  });

  it("un día cerrado no vuelve a cerrarse", () => {
    expect(assertTransition("dailyClose", "close", PosDailyCloseStatus.READY)).toBe(
      PosDailyCloseStatus.CLOSED,
    );
    expect(() =>
      assertTransition("dailyClose", "close", PosDailyCloseStatus.CLOSED),
    ).toThrow(PosProblemError);
    expect(() =>
      assertTransition("dailyClose", "force-close", PosDailyCloseStatus.CLOSED),
    ).toThrow(PosProblemError);
    expect(getTransition("dailyClose", "force-close").requiresReason).toBe(true);
  });

  it("expone las acciones disponibles desde un estado", () => {
    expect(availableActions("sale", PosSaleStatus.DRAFT).sort()).toEqual([
      "cancel",
      "checkout",
      "suspend",
    ]);
    expect(availableActions("sale", PosSaleStatus.CANCELLED)).toEqual([]);
  });
});
