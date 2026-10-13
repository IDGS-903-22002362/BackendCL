/**
 * Arnés local alrededor de pickWeightedPrize.
 * No abre Firestore, no usa el emulador y no escribe datos.
 */
import { randomInt } from "crypto";
import type { MinijuegoPremio, PrizeType } from "../models/minijuego.model";
import { pickWeightedPrize } from "../services/minijuego.logic";

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
  const total = prizes.reduce((sum, prize) => sum + prize.weight, 0);
  const header = `${"Premio".padEnd(32)}${"Peso".padEnd(8)}${"Esperado".padEnd(12)}Observado`;
  const lines = prizes.map((prize) => {
    const observed = counts.get(prize.id) ?? 0;
    const expected = prize.weight / total;
    const label = prize.especial ? "Especial" : prize.nombre;
    const expectedText = `${(expected * 100).toFixed(2)}%`;
    const observedText = `${((observed / draws) * 100).toFixed(2)}%`;
    return `${label.padEnd(32)}${String(prize.weight).padEnd(8)}${expectedText.padEnd(12)}${observedText}`;
  });

  return [
    `Simulaciones: ${draws}`,
    "Tolerancia: 4 sigma = 4 * sqrt(n * p * (1 - p)), con p = peso / pesoTotal",
    `Peso total: ${total}`,
    header,
    ...lines,
  ].join("\n");
}
