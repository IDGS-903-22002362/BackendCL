/**
 * Arnés local alrededor de pickWeightedPrize.
 * No abre Firestore, no usa el emulador y no escribe datos.
 */
import { randomInt } from "crypto";
import type { MinijuegoPremio, PrizeType } from "../models/minijuego.model";
import { pickWeightedPrize, prizeDrawWeights } from "../services/minijuego.logic";
import { percentToUnits } from "../services/minijuego.probability";

export const POINT_LADDER: Array<{ valor: number; weight: number }> = [
  { valor: 10, weight: 30 },
  { valor: 20, weight: 25 },
  { valor: 30, weight: 20 },
  { valor: 40, weight: 15 },
  { valor: 50, weight: 12 },
  { valor: 60, weight: 10 },
  { valor: 70, weight: 8 },
  { valor: 80, weight: 6 },
  { valor: 90, weight: 4 },
  { valor: 100, weight: 3 },
];

/** Configuración porcentual de referencia: con el especial de 0.3 % suma 100 %. */
export const PERCENT_LADDER: Array<{ valor: number; probabilidad: number }> = [
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
];
export const SPECIAL_PROBABILITY = 0.3;

export const SPECIAL_PRIZE_NAME = "2 boletos León vs América";
export const SPECIAL_WEIGHT = 1;

export function ladderWeightTotal(includeSpecial = true): number {
  const points = POINT_LADDER.reduce((sum, item) => sum + item.weight, 0);
  return includeSpecial ? points + SPECIAL_WEIGHT : points;
}

export function buildLadder(
  minijuegoId: string,
  options?: {
    specialStock?: number | null;
    specialWeight?: number;
    specialNombre?: string;
    specialTipo?: PrizeType;
  },
): MinijuegoPremio[] {
  const points: MinijuegoPremio[] = POINT_LADDER.map((item, index) => ({
    id: `p${item.valor}`,
    minijuegoId,
    nombre: `${item.valor} pts`,
    tipo: "points",
    valor: item.valor,
    stock: null,
    weight: item.weight,
    orden: index,
  }));

  const specialStock = options?.specialStock === undefined ? null : options.specialStock;
  const special: MinijuegoPremio = {
    id: "especial",
    minijuegoId,
    nombre: options?.specialNombre ?? SPECIAL_PRIZE_NAME,
    tipo: options?.specialTipo ?? "physical",
    stock: specialStock,
    weight: options?.specialWeight ?? SPECIAL_WEIGHT,
    orden: points.length,
    especial: true,
    ...(typeof specialStock === "number" ? { maxGanadores: specialStock } : {}),
  };

  return [...points, special];
}

/** Ruleta con probabilidades porcentuales, como la guarda el panel nuevo. */
export function buildPercentLadder(
  minijuegoId: string,
  options?: { specialStock?: number | null; specialProbability?: number },
): MinijuegoPremio[] {
  const specialProbability = options?.specialProbability ?? SPECIAL_PROBABILITY;
  const points: MinijuegoPremio[] = PERCENT_LADDER.map((item, index) => ({
    id: `p${item.valor}`,
    minijuegoId,
    nombre: `${item.valor} pts`,
    tipo: "points",
    valor: item.valor,
    stock: null,
    weight: percentToUnits(item.probabilidad) ?? 0,
    probabilidad: item.probabilidad,
    orden: index,
  }));
  const specialStock = options?.specialStock === undefined ? null : options.specialStock;
  return [
    ...points,
    {
      id: "especial",
      minijuegoId,
      nombre: SPECIAL_PRIZE_NAME,
      tipo: "physical",
      stock: specialStock,
      weight: percentToUnits(specialProbability) ?? 0,
      probabilidad: specialProbability,
      orden: points.length,
      especial: true,
      ...(typeof specialStock === "number" ? { maxGanadores: specialStock } : {}),
    },
  ];
}

/**
 * Probabilidad efectiva de cada premio en el sorteo actual: su peso entre la
 * suma de los premios con stock. Con porcentajes y sin agotados, coincide con
 * el porcentaje configurado; con agotados, refleja la redistribución.
 */
export function effectiveProbabilities(prizes: MinijuegoPremio[]): Map<string, number> {
  const weights = prizeDrawWeights(prizes);
  const available = prizes.map(
    (prize, index) => (prize.stock == null || prize.stock > 0 ? weights[index] : 0),
  );
  const total = available.reduce((sum, weight) => sum + weight, 0);
  return new Map(
    prizes.map((prize, index) => [prize.id, total > 0 ? available[index] / total : 0]),
  );
}

export function simulatePrizeCounts(
  prizes: MinijuegoPremio[],
  draws: number,
  randomIntFn: (maxExclusive: number) => number = (maxExclusive) =>
    randomInt(0, maxExclusive),
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const prize of prizes) counts.set(prize.id, 0);

  for (let index = 0; index < draws; index += 1) {
    const selected = pickWeightedPrize(prizes, randomIntFn);
    counts.set(selected.id, (counts.get(selected.id) ?? 0) + 1);
  }

  return counts;
}

export function fourSigmaBand(
  draws: number,
  probability: number,
): { expected: number; sd: number; low: number; high: number } {
  const expected = draws * probability;
  const sd = Math.sqrt(draws * probability * (1 - probability));
  return {
    expected,
    sd,
    low: expected - 4 * sd,
    high: expected + 4 * sd,
  };
}

export function isWithinFourSigma(
  observed: number,
  draws: number,
  probability: number,
): boolean {
  if (probability <= 0) return observed === 0;
  if (probability >= 1) return observed === draws;
  const band = fourSigmaBand(draws, probability);
  return observed >= band.low && observed <= band.high;
}

export function formatProbabilityTable(
  prizes: MinijuegoPremio[],
  counts: Map<string, number>,
  draws: number,
): string {
  const effective = effectiveProbabilities(prizes);
  const header = `${"Premio".padEnd(32)}${"Config.".padEnd(10)}${"Esperado".padEnd(12)}${"Observado".padEnd(12)}Desv. (sigma)`;
  const lines = prizes.map((prize) => {
    const observed = counts.get(prize.id) ?? 0;
    const expected = effective.get(prize.id) ?? 0;
    const label = prize.especial ? `Especial (${prize.nombre})`.slice(0, 31) : prize.nombre;
    const configured =
      prize.probabilidad != null ? `${prize.probabilidad}%` : `peso ${prize.weight}`;
    const sd = Math.sqrt(draws * expected * (1 - expected));
    const sigma = sd > 0 ? ((observed - draws * expected) / sd).toFixed(2) : "0.00";
    const expectedText = `${(expected * 100).toFixed(3)}%`;
    const observedText = `${((observed / draws) * 100).toFixed(3)}%`;
    return `${label.padEnd(32)}${configured.padEnd(10)}${expectedText.padEnd(12)}${observedText.padEnd(12)}${sigma}`;
  });

  return [
    `Simulaciones: ${draws}`,
    "Tolerancia: 4 sigma = 4 * sqrt(n * p * (1 - p)), con p = probabilidad efectiva",
    header,
    ...lines,
  ].join("\n");
}
