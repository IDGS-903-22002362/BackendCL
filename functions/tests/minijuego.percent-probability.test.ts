import { randomInt } from "crypto";
import { describe, expect, it } from "@jest/globals";
import { guardarMinijuegoSchema } from "../src/middleware/validators/minijuego.validator";
import type {
  GuardarMinijuegoInput,
  MinijuegoPremio,
  PremioInput,
} from "../src/models/minijuego.model";
import {
  adminPrizeProbabilities,
  drawAvailablePrize,
  pickWeightedPrize,
  prepareMinijuegoWrite,
  prizeDrawWeights,
} from "../src/services/minijuego.logic";
import {
  PROBABILITY_TOTAL_UNITS,
  percentToUnits,
  planWeightMigration,
  weightsToUnits,
} from "../src/services/minijuego.probability";
import { isWithinFourSigma } from "../src/scripts/minigame-prize-sim";

/** Tabla del requerimiento: suma 100 % con especial de 0.3 %. */
const EJEMPLO: Array<{ valor?: number; probabilidad: number; especial?: boolean }> = [
  { valor: 10, probabilidad: 30 },
  { valor: 20, probabilidad: 25 },
  { valor: 30, probabilidad: 15 },
  { valor: 40, probabilidad: 10 },
  { valor: 50, probabilidad: 7 },
  { valor: 60, probabilidad: 5 },
  { valor: 70, probabilidad: 3 },
  { valor: 80, probabilidad: 2 },
  { valor: 90, probabilidad: 1.5 },
  { valor: 100, probabilidad: 1.2 },
  { probabilidad: 0.3, especial: true },
];

function input(premios: PremioInput[]): GuardarMinijuegoInput {
  return {
    beneficio: { titulo: "Ruleta", descripcion: "Prueba", estatus: true },
    minijuego: {
      tipo: "ruleta",
      intentosPorUsuario: 1,
      audiencia: { visibilidad: "publico", usuariosPermitidos: [] },
    },
    premios,
  };
}

function pointsInput(probabilidades: number[]): PremioInput[] {
  return probabilidades.map((probabilidad, index) => ({
    nombre: `${(index + 1) * 10} puntos`,
    tipo: "points",
    valor: (index + 1) * 10,
    probabilidad,
  }));
}

function ejemploInput(): PremioInput[] {
  return EJEMPLO.map((item) =>
    item.especial
      ? {
          nombre: "2 boletos León vs América",
          tipo: "physical",
          stock: 2,
          especial: true,
          probabilidad: item.probabilidad,
        }
      : {
          nombre: `${item.valor} puntos`,
          tipo: "points",
          valor: item.valor,
          probabilidad: item.probabilidad,
        },
  );
}

function percentPrizes(
  rows: Array<{ id: string; probabilidad: number; stock?: number | null; especial?: boolean }>,
): MinijuegoPremio[] {
  return rows.map((row, index) => ({
    id: row.id,
    minijuegoId: "game",
    nombre: row.id,
    tipo: row.especial ? "physical" : "points",
    ...(row.especial ? {} : { valor: 10 }),
    stock: row.stock ?? null,
    weight: percentToUnits(row.probabilidad) ?? 0,
    probabilidad: row.probabilidad,
    orden: index,
    ...(row.especial ? { especial: true } : {}),
  }));
}

function legacyPrizes(weights: number[]): MinijuegoPremio[] {
  return weights.map((weight, index) => ({
    id: `w${index}`,
    minijuegoId: "legacy",
    nombre: `peso ${weight}`,
    tipo: "points",
    valor: 10,
    stock: null,
    weight,
    orden: index,
  }));
}

/**
 * Recorre todos los valores posibles del generador (0..total-1) y cuenta qué
 * premio sale en cada uno. Es la distribución exacta del selector, sin azar.
 */
function exactDistribution(premios: MinijuegoPremio[]): { total: number; counts: Map<string, number> } {
  const weights = prizeDrawWeights(premios);
  const total = premios.reduce((sum, premio, index) => {
    const available = premio.stock == null || premio.stock > 0;
    return available ? sum + weights[index] : sum;
  }, 0);
  const counts = new Map<string, number>(premios.map((premio) => [premio.id, 0]));
  for (let cursor = 0; cursor < total; cursor += 1) {
    const premio = pickWeightedPrize(premios, () => cursor);
    counts.set(premio.id, (counts.get(premio.id) ?? 0) + 1);
  }
  return { total, counts };
}

function expectError(fn: () => unknown, code: string, message?: string) {
  try {
    fn();
  } catch (error) {
    expect(error).toMatchObject({ code, ...(message ? { message } : {}) });
    return;
  }
  throw new Error(`Se esperaba el error ${code}`);
}

describe("probabilidades porcentuales: conversión", () => {
  it("convierte porcentajes decimales a unidades de 0.001 % sin error de punto flotante", () => {
    expect(percentToUnits(30)).toBe(30_000);
    expect(percentToUnits(1.5)).toBe(1_500);
    expect(percentToUnits(0.3)).toBe(300);
    expect(percentToUnits(0.05)).toBe(50);
    expect(percentToUnits(0.001)).toBe(1);
    expect(percentToUnits(0.1 + 0.2)).toBe(300);
    expect(percentToUnits(100)).toBe(PROBABILITY_TOTAL_UNITS);
  });

  it("rechaza más de 3 decimales, negativos, más de 100 % y no numéricos", () => {
    for (const value of [0.0001, -1, 100.001, Number.NaN, Infinity, "30", null, undefined]) {
      expect(percentToUnits(value)).toBeNull();
    }
  });
});

describe("probabilidades porcentuales: validación al guardar", () => {
  it("1. acepta una configuración que suma exactamente 100 %", () => {
    const prepared = prepareMinijuegoWrite(input(ejemploInput()));
    expect(prepared.premios.map((premio) => premio.probabilidad)).toEqual(
      EJEMPLO.map((item) => item.probabilidad),
    );
    expect(prepared.premios.reduce((sum, premio) => sum + premio.weight, 0)).toBe(100_000);
  });

  it("2. rechaza una suma menor a 100 % indicando lo que falta", () => {
    expectError(
      () => prepareMinijuegoWrite(input(pointsInput([50, 45]))),
      "MINIGAME_INVALID_PROBABILITY_TOTAL",
      "Probabilidad total: 95%. Falta asignar 5%.",
    );
  });

  it("3. rechaza una suma mayor a 100 % indicando el exceso", () => {
    expectError(
      () => prepareMinijuegoWrite(input(pointsInput([60, 43]))),
      "MINIGAME_INVALID_PROBABILITY_TOTAL",
      "Probabilidad total: 103%. Excedes el límite por 3%.",
    );
    expectError(
      () => prepareMinijuegoWrite(input(pointsInput([99.7, 0.301]))),
      "MINIGAME_INVALID_PROBABILITY_TOTAL",
      "Probabilidad total: 100.001%. Excedes el límite por 0.001%.",
    );
  });

  it("4. acepta decimales que suman 100 % y rechaza precisión mayor a 0.001 %", () => {
    const prepared = prepareMinijuegoWrite(input(pointsInput([33.333, 33.333, 33.334])));
    expect(prepared.premios.map((premio) => premio.weight)).toEqual([33_333, 33_333, 33_334]);

    expectError(
      () => prepareMinijuegoWrite(input(pointsInput([49.9995, 50.0005]))),
      "MINIGAME_INVALID_PROBABILITY",
    );
  });

  it("rechaza 0 %, negativos, más de 100 % y premios sin probabilidad", () => {
    expectError(() => prepareMinijuegoWrite(input(pointsInput([100, 0]))), "MINIGAME_INVALID_PROBABILITY");
    expectError(() => prepareMinijuegoWrite(input(pointsInput([101, -1]))), "MINIGAME_INVALID_PROBABILITY");
    expectError(
      () =>
        prepareMinijuegoWrite(
          input([{ nombre: "10 puntos", tipo: "points", valor: 10, weight: 1 }]),
        ),
      "MINIGAME_PROBABILITY_REQUIRED",
    );
  });

  it("5. guarda el premio especial de 0.3 % como 300 unidades", () => {
    const prepared = prepareMinijuegoWrite(input(ejemploInput()));
    const especial = prepared.premios.find((premio) => premio.especial);
    expect(especial).toMatchObject({ probabilidad: 0.3, weight: 300, stock: 2, maxGanadores: 2 });
  });

  it("6. guarda una probabilidad de 0.05 % como 50 unidades", () => {
    const prepared = prepareMinijuegoWrite(input(pointsInput([99.95, 0.05])));
    expect(prepared.premios[1]).toMatchObject({ probabilidad: 0.05, weight: 50 });
  });

  it("el esquema del API acepta decimales y rechaza negativos o más de 100", () => {
    const body = input(pointsInput([99.95, 0.05]));
    const parsed = guardarMinijuegoSchema.parse(body);
    expect(parsed.premios[1].probabilidad).toBe(0.05);

    expect(guardarMinijuegoSchema.safeParse(input(pointsInput([-1, 101]))).success).toBe(false);
    expect(guardarMinijuegoSchema.safeParse(input(pointsInput([100.5]))).success).toBe(false);
  });
});

describe("probabilidades porcentuales: sorteo", () => {
  it("la distribución exacta del selector coincide con los porcentajes (sin sesgo)", () => {
    const prizes = percentPrizes([
      ...EJEMPLO.filter((item) => !item.especial).map((item) => ({
        id: `p${item.valor}`,
        probabilidad: item.probabilidad,
      })),
      { id: "especial", probabilidad: 0.3, stock: 5, especial: true },
    ]);
    const { total, counts } = exactDistribution(prizes);
    expect(total).toBe(100_000);
    for (const prize of prizes) {
      expect(counts.get(prize.id)).toBe(percentToUnits(prize.probabilidad));
    }
    expect(counts.get("especial")).toBe(300);
  });

  it("6. una probabilidad de 0.05 % ocupa exactamente 50 de 100000 resultados", () => {
    const prizes = percentPrizes([
      { id: "comun", probabilidad: 99.95 },
      { id: "raro", probabilidad: 0.05 },
    ]);
    const { counts } = exactDistribution(prizes);
    expect(counts.get("raro")).toBe(50);
    expect(counts.get("comun")).toBe(99_950);
  });

  it("7. 200,000 tiradas con crypto.randomInt quedan dentro de 4 sigma", () => {
    const prizes = percentPrizes([
      { id: "p10", probabilidad: 30 },
      { id: "p20", probabilidad: 25 },
      { id: "p30", probabilidad: 15 },
      { id: "p40", probabilidad: 10 },
      { id: "p50", probabilidad: 7 },
      { id: "p60", probabilidad: 5 },
      { id: "p70", probabilidad: 3 },
      { id: "p80", probabilidad: 2 },
      { id: "p90", probabilidad: 1.5 },
      { id: "p100", probabilidad: 1.15 },
      { id: "raro", probabilidad: 0.05 },
      { id: "especial", probabilidad: 0.3, especial: true },
    ]);
    const draws = 200_000;
    const counts = new Map<string, number>();
    for (let index = 0; index < draws; index += 1) {
      const prize = pickWeightedPrize(prizes, (max) => randomInt(0, max));
      counts.set(prize.id, (counts.get(prize.id) ?? 0) + 1);
    }
    for (const prize of prizes) {
      const p = (prize.probabilidad ?? 0) / 100;
      expect(isWithinFourSigma(counts.get(prize.id) ?? 0, draws, p)).toBe(true);
    }
  });

  it("8. al agotarse un premio, su probabilidad se redistribuye proporcionalmente", () => {
    const prizes = percentPrizes([
      { id: "A", probabilidad: 60 },
      { id: "B", probabilidad: 30 },
      { id: "especial", probabilidad: 10, stock: 0, especial: true },
    ]);
    const { total, counts } = exactDistribution(prizes);
    expect(total).toBe(90_000);
    expect((counts.get("A") ?? 0) / total).toBeCloseTo(2 / 3, 12);
    expect((counts.get("B") ?? 0) / total).toBeCloseTo(1 / 3, 12);
    expect(counts.get("especial")).toBe(0);
    // Los porcentajes configurados no cambian.
    expect(prizes.map((prize) => prize.probabilidad)).toEqual([60, 30, 10]);
  });

  it("9. los premios ilimitados siguen disponibles indefinidamente", () => {
    let premios = percentPrizes([
      { id: "ilimitado", probabilidad: 50 },
      { id: "limitado", probabilidad: 50, stock: 3 },
    ]);
    const seen = new Map<string, number>();
    for (let index = 0; index < 1_000; index += 1) {
      const result = drawAvailablePrize(premios, (max) => randomInt(0, max));
      premios = result.premios;
      seen.set(result.prize.id, (seen.get(result.prize.id) ?? 0) + 1);
    }
    expect(seen.get("limitado")).toBe(3);
    expect(seen.get("ilimitado")).toBe(997);
    expect(premios.find((premio) => premio.id === "ilimitado")?.stock).toBeNull();
    expect(premios.find((premio) => premio.id === "limitado")?.stock).toBe(0);
  });

  it("10. nunca entrega un premio especial agotado", () => {
    const prizes = percentPrizes([
      { id: "puntos", probabilidad: 0.3 },
      { id: "especial", probabilidad: 99.7, stock: 0, especial: true },
    ]);
    for (let index = 0; index < 5_000; index += 1) {
      expect(pickWeightedPrize(prizes, (max) => randomInt(0, max)).id).toBe("puntos");
    }
  });

  it("sin premios disponibles responde un error controlado", () => {
    const prizes = percentPrizes([
      { id: "A", probabilidad: 50, stock: 0 },
      { id: "B", probabilidad: 50, stock: 0 },
    ]);
    expect(() => pickWeightedPrize(prizes, () => 0)).toThrow(
      expect.objectContaining({ code: "MINIGAME_NO_PRIZES" }),
    );
  });
});

describe("11. compatibilidad con minijuegos basados en pesos", () => {
  it("sigue sorteando con los pesos originales exactos", () => {
    const { total, counts } = exactDistribution(legacyPrizes([1, 9]));
    expect(total).toBe(10);
    expect(counts.get("w0")).toBe(1);
    expect(counts.get("w1")).toBe(9);
  });

  it("si solo algunos premios tienen porcentaje, usa los pesos de todos", () => {
    const prizes = legacyPrizes([1, 3]);
    prizes[0].probabilidad = 99;
    expect(prizeDrawWeights(prizes)).toEqual([1, 3]);
  });

  it("el panel ve los pesos convertidos a porcentajes que suman 100 %", () => {
    const view = adminPrizeProbabilities(legacyPrizes([30, 25, 20, 15, 12, 10, 8, 6, 4, 3, 1]));
    expect(view.modo).toBe("convertida");
    const units = view.porcentajes.map((value) => percentToUnits(value) ?? -1);
    expect(units.reduce((sum, value) => sum + value, 0)).toBe(100_000);
    // 1 / 134 = 0.746268...% -> 0.746 %
    expect(view.porcentajes[10]).toBe(0.746);
  });

  it("el panel ve los porcentajes guardados tal cual en minijuegos nuevos", () => {
    const view = adminPrizeProbabilities(
      percentPrizes([
        { id: "A", probabilidad: 99.7 },
        { id: "B", probabilidad: 0.3 },
      ]),
    );
    expect(view).toEqual({ modo: "porcentaje", porcentajes: [99.7, 0.3] });
  });

  it("reparte el residuo de redondeo con el método del mayor residuo", () => {
    expect(weightsToUnits([1, 1, 1])).toEqual([33_334, 33_333, 33_333]);
    expect(weightsToUnits([2, 1])).toEqual([66_667, 33_333]);
  });

  it("ningún premio que podía salir queda en 0 % por redondeo", () => {
    const units = weightsToUnits([1, 10_000_000]);
    expect(units[0]).toBe(1);
    expect(units.reduce((sum, value) => sum + value, 0)).toBe(100_000);
  });

  it("la migración conserva cada proporción con desviación menor a 0.001 pp", () => {
    const plan = planWeightMigration(
      [30, 25, 20, 15, 12, 10, 8, 6, 4, 3, 1].map((weight, index) => ({ id: `w${index}`, weight })),
    );
    expect(plan.totalUnits).toBe(100_000);
    expect(plan.maxDesviacion).toBeLessThan(0.001);
  });
});
