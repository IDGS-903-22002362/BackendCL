import type { MinijuegoPremio } from "../src/models/minijuego.model";
import { drawAvailablePrize, pickWeightedPrize } from "../src/services/minijuego.logic";
import {
  buildLadder,
  formatProbabilityTable,
  isWithinFourSigma,
  ladderWeightTotal,
  simulatePrizeCounts,
} from "../src/scripts/minigame-prize-sim";

jest.setTimeout(60_000);

function prize(partial: Partial<MinijuegoPremio> & Pick<MinijuegoPremio, "id" | "weight">): MinijuegoPremio {
  return {
    minijuegoId: "pesos",
    nombre: partial.id,
    tipo: "points",
    valor: 10,
    stock: null,
    orden: 0,
    ...partial,
  };
}

function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

describe("selector ponderado real", () => {
  it("asigna A a [0,1) y B a [1,10)", () => {
    const premios = [
      prize({ id: "A", nombre: "A", weight: 1, orden: 0 }),
      prize({ id: "B", nombre: "B", valor: 20, weight: 9, orden: 1 }),
    ];
    const seen: number[] = [];
    const roll = (cursor: number) =>
      pickWeightedPrize(premios, (max) => {
        seen.push(max);
        return cursor;
      }).id;

    expect(roll(0)).toBe("A");
    expect(roll(1)).toBe("B");
    expect(roll(9)).toBe("B");
    expect(seen).toEqual([10, 10, 10]);
  });

  it("ocupa el rango exacto de cada peso de la escalera", () => {
    const premios = buildLadder("escalera", { specialStock: null });
    let cursor = 0;

    for (const premio of premios) {
      expect(pickWeightedPrize(premios, () => cursor).id).toBe(premio.id);
      expect(pickWeightedPrize(premios, () => cursor + premio.weight - 1).id).toBe(premio.id);
      cursor += premio.weight;
    }

    expect(cursor).toBe(ladderWeightTotal());
    expect(cursor).toBe(134);
  });

  it("elimina el premio agotado antes de calcular el total", () => {
    const premios = [
      prize({ id: "A", weight: 10, orden: 0 }),
      prize({ id: "B", weight: 20, orden: 1 }),
      prize({
        id: "especial",
        nombre: "Especial",
        tipo: "physical",
        valor: undefined,
        weight: 1,
        stock: 0,
        orden: 2,
        especial: true,
      }),
    ];
    let total = 0;
    const selected = pickWeightedPrize(premios, (max) => {
      total = max;
      return 0;
    });

    expect(total).toBe(30);
    expect(selected.id).toBe("A");
  });

  it("la probabilidad depende del peso y cae a cero cuando el stock se agota", () => {
    let premios = buildLadder("independiente", { specialStock: 2 });
    const totals: number[] = [];
    let specials = 0;

    for (let index = 0; index < 2; index += 1) {
      const drawn = drawAvailablePrize(premios, (max) => {
        totals.push(max);
        return max - 1;
      });
      expect(drawn.prize.id).toBe("especial");
      specials += 1;
      premios = drawn.premios;
    }

    expect(totals).toEqual([ladderWeightTotal(), ladderWeightTotal()]);
    expect(premios.find((item) => item.id === "especial")?.stock).toBe(0);

    for (let index = 0; index < 100_000; index += 1) {
      const drawn = drawAvailablePrize(premios, (max) => {
        if (index === 0) totals.push(max);
        return max - 1;
      });
      expect(drawn.prize.id).not.toBe("especial");
      premios = drawn.premios;
    }

    expect(specials).toBe(2);
    expect(premios.find((item) => item.id === "especial")?.stock).toBe(0);
    expect(totals[2]).toBe(ladderWeightTotal(false));
  });

  it("mantiene la frecuencia dentro de 4 sigma en 100000 sorteos", () => {
    const draws = 100_000;
    const premios = buildLadder("frecuencia", { specialStock: null });
    const total = ladderWeightTotal();
    const counts = simulatePrizeCounts(premios, draws);

    console.log(formatProbabilityTable(premios, counts, draws));

    for (const premio of premios) {
      const observed = counts.get(premio.id) ?? 0;
      expect(isWithinFourSigma(observed, draws, premio.weight / total)).toBe(true);
    }
  });

  it("conserva stock, tope y exclusión con configuraciones aleatorias", () => {
    const rand = lcg(20261013);

    for (let trial = 0; trial < 40; trial += 1) {
      const size = 2 + Math.floor(rand() * 4);
      const initial: MinijuegoPremio[] = [];

      for (let index = 0; index < size; index += 1) {
        const blockedWeight = index === size - 1 && rand() < 0.4;
        initial.push(
          prize({
            id: `p-${trial}-${index}`,
            weight: blockedWeight ? 0 : 1 + Math.floor(rand() * 12),
            stock: index === 0 ? null : Math.floor(rand() * 4),
            orden: index,
            valor: 4 + index,
          }),
        );
      }

      let current = initial.map((item) => ({ ...item }));
      const awarded = new Map<string, number>();

      for (let draw = 0; draw < 30; draw += 1) {
        const eligible = current.filter(
          (item) => item.weight >= 1 && (item.stock == null || item.stock > 0),
        );
        if (eligible.length === 0) break;
        const total = eligible.reduce((sum, item) => sum + item.weight, 0);
        const cursor = Math.floor(rand() * total);
        const result = drawAvailablePrize(current, (max) => {
          expect(max).toBe(total);
          return cursor;
        });

        expect(result.prize.weight).toBeGreaterThanOrEqual(1);
        expect(result.prize.stock == null || result.prize.stock > 0).toBe(true);
        awarded.set(result.prize.id, (awarded.get(result.prize.id) ?? 0) + 1);
        current = result.premios;
      }

      for (const item of initial) {
        const now = current.find((candidate) => candidate.id === item.id);
        const wins = awarded.get(item.id) ?? 0;
        expect(now).toBeDefined();
        if (item.weight <= 0 || item.stock === 0) expect(wins).toBe(0);
        if (item.stock == null) {
          expect(now?.stock).toBeNull();
        } else {
          expect(now?.stock).toBeGreaterThanOrEqual(0);
          expect(wins).toBeLessThanOrEqual(item.stock);
          expect(now?.stock).toBe(item.stock - wins);
        }
      }
    }
  });
});
