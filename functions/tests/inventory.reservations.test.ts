/// <reference types="jest" />

import {
  computeDisponible,
  projectLegacyFromProductData,
} from "../src/utils/inventory-stock.util";

describe("inventory-stock.util", () => {
  it("calcula disponible como física - reservada - noDisponible", () => {
    expect(computeDisponible(10, 2, 1)).toBe(7);
    expect(computeDisponible(3, 5, 0)).toBe(0);
  });

  it("proyecta legacy desde producto sin tallas", () => {
    const projection = projectLegacyFromProductData({
      existencias: 12,
      tallaIds: [],
    });

    expect(projection.existencias).toBe(12);
    expect(projection.inventarioGlobal?.fisica).toBe(12);
    expect(projection.inventarioGlobal?.disponible).toBe(12);
  });

  it("proyecta legacy desde inventario por talla", () => {
    const projection = projectLegacyFromProductData({
      tallaIds: ["s", "m"],
      inventarioPorTalla: [
        { tallaId: "s", cantidad: 3, fisica: 4, reservada: 1 },
        { tallaId: "m", cantidad: 5, fisica: 5, reservada: 0 },
      ],
      existencias: 8,
    });

    expect(projection.existencias).toBe(8);
    expect(projection.inventarioPorTalla[0].cantidad).toBe(3);
    expect(projection.inventarioPorTalla[0].reservada).toBe(1);
  });
});
