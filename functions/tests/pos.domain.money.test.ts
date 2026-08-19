import { describe, expect, it } from "@jest/globals";
import {
  allocateMinor,
  assertNonNegativeMinor,
  formatMinorAsMxn,
  majorToMinor,
  minorToMajor,
  multiplyMinor,
  percentOfMinor,
  sumMinor,
} from "../src/modules/pos/domain/money";
import PosProblemError from "../src/modules/pos/errors/pos-problem.error";

describe("POS money", () => {
  it("convierte pesos a centavos sin arrastrar error de flotante", () => {
    expect(majorToMinor(100)).toBe(10_000);
    expect(majorToMinor(1_250.5)).toBe(125_050);
    expect(majorToMinor(0.145)).toBe(15);
    expect(majorToMinor(19.99)).toBe(1_999);
    expect(majorToMinor(0)).toBe(0);
  });

  it("regresa a pesos solo para presentación", () => {
    expect(minorToMajor(125_050)).toBe(1_250.5);
    expect(minorToMajor(0)).toBe(0);
  });

  it("rechaza importes que no son enteros de centavos", () => {
    expect(() => assertNonNegativeMinor(10.5, "amountMinor")).toThrow(
      PosProblemError,
    );
    expect(() => assertNonNegativeMinor(Number.NaN, "amountMinor")).toThrow(
      PosProblemError,
    );
    expect(() => assertNonNegativeMinor(Number.POSITIVE_INFINITY, "a")).toThrow(
      PosProblemError,
    );
    expect(() => assertNonNegativeMinor(-1, "amountMinor")).toThrow(
      PosProblemError,
    );
    expect(() => assertNonNegativeMinor("1000", "amountMinor")).toThrow(
      PosProblemError,
    );
  });

  it("suma y multiplica en enteros", () => {
    expect(sumMinor([1, 2, 3])).toBe(6);
    expect(multiplyMinor(1_999, 3)).toBe(5_997);
    expect(multiplyMinor(1_999, 0)).toBe(0);
    expect(() => multiplyMinor(1_999, 1.5)).toThrow(PosProblemError);
    expect(() => multiplyMinor(1_999, -1)).toThrow(PosProblemError);
  });

  it("aplica porcentajes redondeando al centavo", () => {
    expect(percentOfMinor(10_000, 10)).toBe(1_000);
    expect(percentOfMinor(333, 50)).toBe(167);
    expect(() => percentOfMinor(10_000, 101)).toThrow(PosProblemError);
    expect(() => percentOfMinor(10_000, -1)).toThrow(PosProblemError);
  });

  describe("allocateMinor", () => {
    it("reparte sin perder ni inventar centavos", () => {
      const parts = allocateMinor(100, [1, 1, 1]);
      expect(parts).toEqual([34, 33, 33]);
      expect(parts.reduce((a, b) => a + b, 0)).toBe(100);
    });

    it("respeta el peso relativo de cada destino", () => {
      const parts = allocateMinor(1_000, [700, 300]);
      expect(parts).toEqual([700, 300]);
    });

    it("reparte en partes iguales cuando todos los pesos son cero", () => {
      const parts = allocateMinor(10, [0, 0, 0]);
      expect(parts.reduce((a, b) => a + b, 0)).toBe(10);
      expect(parts).toEqual([4, 3, 3]);
    });

    it("conserva el total con residuos difíciles", () => {
      const parts = allocateMinor(9_999, [1, 1, 1, 1, 1, 1, 1]);
      expect(parts.reduce((a, b) => a + b, 0)).toBe(9_999);
    });

    it("falla si no hay destinos para un importe distinto de cero", () => {
      expect(() => allocateMinor(100, [])).toThrow(PosProblemError);
      expect(allocateMinor(0, [])).toEqual([]);
    });
  });

  it("formatea importes en MXN", () => {
    expect(formatMinorAsMxn(125_050)).toBe("$1,250.50");
    expect(formatMinorAsMxn(-500)).toBe("-$5.00");
    expect(formatMinorAsMxn(0)).toBe("$0.00");
  });
});
