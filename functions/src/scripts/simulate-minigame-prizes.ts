/**
 * Simulación estadística del selector real.
 * No abre Firestore, no usa el emulador y no escribe datos.
 */
import { buildLadder, formatProbabilityTable, isWithinFourSigma, simulatePrizeCounts } from "./minigame-prize-sim";

const draws = Number(process.env.SIM_N ?? 100_000);

if (!Number.isInteger(draws) || draws < 1000) {
  console.error("SIM_N debe ser un entero mayor o igual a 1000.");
  process.exit(1);
}

const prizes = buildLadder("simulacion", { specialStock: null });
const total = prizes.reduce((sum, prize) => sum + prize.weight, 0);
const counts = simulatePrizeCounts(prizes, draws);

console.log("====================================");
console.log("MINIGAME PROBABILITY SIMULATION");
console.log("====================================");
console.log(formatProbabilityTable(prizes, counts, draws));

let failed = false;
for (const prize of prizes) {
  const observed = counts.get(prize.id) ?? 0;
  const probability = prize.weight / total;
  if (!isWithinFourSigma(observed, draws, probability)) {
    failed = true;
    console.error(
      `Fuera de 4 sigma: ${prize.nombre} observado ${observed} de ${draws}`,
    );
  }
}

console.log(failed ? "Resultado: FUERA DE TOLERANCIA" : "Resultado: DENTRO DE 4 SIGMA");
console.log("====================================");

if (failed) process.exit(1);
