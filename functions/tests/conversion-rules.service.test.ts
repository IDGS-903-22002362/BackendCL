import { describe, expect, it } from "@jest/globals";
import { ConversionRulesService } from "../src/modules/loyalty/services/conversion-rules.service";

describe("ConversionRulesService.calculatePointsFromAmountCents", () => {
  const service = new ConversionRulesService();

  it.each([
    ["$0", 0, 0],
    ["$9.99", 999, 1],
    ["$10", 1000, 1],
    ["$95", 9500, 10],
    ["$100", 10000, 10],
    ["$350.75", 35075, 35],
  ])("convierte %s (%i centavos) a %i puntos", (_label, cents, expected) => {
    expect(service.calculatePointsFromAmountCents(cents)).toBe(expected);
  });

  it("maneja montos grandes sin perder precision finita", () => {
    const cents = 99_999_999;
    expect(service.calculatePointsFromAmountCents(cents)).toBe(100_000);
  });

  it("rechaza montos invalidos devolviendo 0 puntos", () => {
    expect(service.calculatePointsFromAmountCents(-1)).toBe(0);
    expect(service.calculatePointsFromAmountCents(-999)).toBe(0);
    expect(service.calculatePointsFromAmountCents(Number.NaN)).toBe(0);
    expect(service.calculatePointsFromAmountCents(Number.POSITIVE_INFINITY)).toBe(0);
  });
});
