/**
 * Simulación estadística del selector real.
 * No abre Firestore, no usa el emulador y no escribe datos.
 *
 * Escenarios:
 *   1. Porcentajes configurados (suma 100 %, especial de 0.3 %).
 *   2. Mismo minijuego con el especial agotado (redistribución proporcional).
 *   3. Minijuego antiguo basado en pesos relativos.
 *
 * SIM_N controla las tiradas por escenario (por defecto 100000).
 */
import type { MinijuegoPremio } from "../models/minijuego.model";
import {
  buildLadder,
  buildPercentLadder,
  effectiveProbabilities,
  formatProbabilityTable,
  isWithinFourSigma,
  simulatePrizeCounts,
} from "./minigame-prize-sim";

const draws = Number(process.env.SIM_N ?? 100_000);

if (!Number.isInteger(draws) || draws < 1000) {
  console.error("SIM_N debe ser un entero mayor o igual a 1000.");
  process.exit(1);
}

const scenarios: Array<{ title: string; prizes: MinijuegoPremio[] }> = [
  {
    title: "Porcentajes configurados (especial 0.3 %)",
    prizes: buildPercentLadder("simulacion", { specialStock: null }),
  },
  {
    title: "Especial agotado: su 0.3 % se redistribuye",
    prizes: buildPercentLadder("simulacion-agotado", { specialStock: 0 }),
  },
  {
    title: "Minijuego antiguo con pesos relativos",
    prizes: buildLadder("simulacion-pesos", { specialStock: null }),
  },
];

let failed = false;
console.log("====================================");
console.log("MINIGAME PROBABILITY SIMULATION");
console.log("====================================");

for (const scenario of scenarios) {
  const counts = simulatePrizeCounts(scenario.prizes, draws);
  const effective = effectiveProbabilities(scenario.prizes);
  console.log(`\n--- ${scenario.title} ---`);
  console.log(formatProbabilityTable(scenario.prizes, counts, draws));

  for (const prize of scenario.prizes) {
    const observed = counts.get(prize.id) ?? 0;
    if (!isWithinFourSigma(observed, draws, effective.get(prize.id) ?? 0)) {
      failed = true;
      console.error(`Fuera de 4 sigma: ${prize.nombre} observado ${observed} de ${draws}`);
    }
  }
}

console.log(`\n${failed ? "Resultado: FUERA DE TOLERANCIA" : "Resultado: DENTRO DE 4 SIGMA"}`);
console.log("====================================");

if (failed) process.exit(1);
