import { describe, expect, it } from "@jest/globals";
import {
  addDaysToOperationalDate,
  assertOperationalDate,
  compareOperationalDates,
  isValidOperationalDate,
  operationalDateBounds,
  operationalDateDiffInDays,
  operationalDateOf,
} from "../src/modules/pos/domain/operational-date";
import PosProblemError from "../src/modules/pos/errors/pos-problem.error";

describe("POS operational date", () => {
  it("usa la fecha civil de Ciudad de México, no UTC", () => {
    // 2026-03-15T04:00:00Z son las 22:00 del 14 de marzo en Ciudad de México.
    expect(operationalDateOf(new Date("2026-03-15T04:00:00.000Z"))).toBe(
      "2026-03-14",
    );
    expect(operationalDateOf(new Date("2026-03-15T18:00:00.000Z"))).toBe(
      "2026-03-15",
    );
  });

  it("mueve las ventas de después de medianoche al día anterior según el corte", () => {
    // 02:00 locales del 16 de marzo con corte a las 4:00 pertenecen al 15.
    const madrugada = new Date("2026-03-16T08:00:00.000Z");
    expect(operationalDateOf(madrugada, 0)).toBe("2026-03-16");
    expect(operationalDateOf(madrugada, 4)).toBe("2026-03-15");
  });

  it("rechaza fechas mal formadas o inexistentes", () => {
    expect(isValidOperationalDate("2026-02-30")).toBe(false);
    expect(isValidOperationalDate("2026-13-01")).toBe(false);
    expect(isValidOperationalDate("15/03/2026")).toBe(false);
    expect(isValidOperationalDate(20260315)).toBe(false);
    expect(() => assertOperationalDate("2026-02-30")).toThrow(PosProblemError);
    expect(assertOperationalDate("2026-02-28")).toBe("2026-02-28");
  });

  it("suma días cruzando fin de mes y de año", () => {
    expect(addDaysToOperationalDate("2026-01-31", 1)).toBe("2026-02-01");
    expect(addDaysToOperationalDate("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDaysToOperationalDate("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("calcula diferencias y orden entre fechas operativas", () => {
    expect(operationalDateDiffInDays("2026-03-01", "2026-03-31")).toBe(30);
    expect(operationalDateDiffInDays("2026-03-31", "2026-03-01")).toBe(-30);
    expect(compareOperationalDates("2026-03-01", "2026-03-02")).toBe(-1);
    expect(compareOperationalDates("2026-03-02", "2026-03-02")).toBe(0);
  });

  it("acota la fecha operativa a un rango de instantes UTC", () => {
    const { start, end } = operationalDateBounds("2026-03-15", 0);
    expect(operationalDateOf(start, 0)).toBe("2026-03-15");
    expect(operationalDateOf(new Date(end.getTime() - 1), 0)).toBe("2026-03-15");
    expect(operationalDateOf(end, 0)).toBe("2026-03-16");
  });
});
