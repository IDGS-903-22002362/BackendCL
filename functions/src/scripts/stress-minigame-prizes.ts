/**
 * Estrés local del motor real decidePlay.
 * Cada usuario y cada jugada son ficticios.
 * No abre Firestore, no usa el emulador y no escribe datos.
 */
import { randomInt } from "crypto";
import type { Minijuego, MinijuegoEstado, MinijuegoPremio } from "../models/minijuego.model";
import { decidePlay } from "../services/minijuego.logic";
import { POINT_LADDER, SPECIAL_PRIZE_NAME, buildLadder } from "./minigame-prize-sim";

const targetPlays = Number(process.env.STRESS_PLAYS ?? 1000);
const maxPlays = Number(process.env.STRESS_MAX_PLAYS ?? 20_000);
const specialMax = 2;

if (!Number.isInteger(targetPlays) || targetPlays < 1) {
  console.error("STRESS_PLAYS debe ser un entero mayor a cero.");
  process.exit(1);
}

const minijuego: Minijuego = {
  id: "stress",
  beneficioId: "stress",
  tipo: "ruleta",
  estatus: true,
  intentosPorUsuario: 1,
  audiencia: { visibilidad: "publico", usuariosPermitidos: [] },
  createdAt: new Date(),
  updatedAt: new Date(),
};

let premios: MinijuegoPremio[] = buildLadder("stress", {
  specialStock: specialMax,
  specialNombre: SPECIAL_PRIZE_NAME,
});
const initialStocks = new Map(premios.map((prize) => [prize.id, prize.stock]));
const estados = new Map<string, MinijuegoEstado>();
const playIds = new Set<string>();
const winnerPlayIds = new Set<string>();
const counts = new Map<string, number>(premios.map((prize) => [prize.id, 0]));
const keys: Array<{ uid: string; key: string }> = [];

let plays = 0;
let negativeStock = false;
let duplicateWinners = false;
let stockViolation = false;
let idempotencyViolations = 0;

function specialStock(): number {
  const special = premios.find((prize) => prize.especial);
  return typeof special?.stock === "number" ? special.stock : 0;
}

function applyAward(prize: MinijuegoPremio): void {
  premios = premios.map((item) => {
    if (item.id !== prize.id || item.stock == null) return item;
    return { ...item, stock: item.stock - 1 };
  });
  if (premios.some((item) => typeof item.stock === "number" && item.stock < 0)) {
    negativeStock = true;
  }
}

function playOnce(uid: string, key: string): string {
  const estado = estados.get(uid) ?? null;
  const decision = decidePlay({
    uid,
    beneficioActivo: true,
    minijuego,
    premios,
    estado,
    idempotencyKey: key,
    now: new Date(),
    randomInt: (maxExclusive) => randomInt(0, maxExclusive),
  });

  if (decision.type === "replay") return decision.playId;

  const prize = decision.prize;
  const playId = `play-${plays + 1}-${uid}`;
  if (playIds.has(playId)) duplicateWinners = true;
  playIds.add(playId);
  applyAward(prize);
  counts.set(prize.id, (counts.get(prize.id) ?? 0) + 1);

  if (prize.especial) {
    if (winnerPlayIds.has(playId)) duplicateWinners = true;
    winnerPlayIds.add(playId);
  }

  estados.set(uid, {
    intentosUsados: (estado?.intentosUsados ?? 0) + 1,
    ultimaPlayId: playId,
    claves: { ...(estado?.claves ?? {}), [key]: playId },
  });
  plays += 1;
  return playId;
}

while (plays < targetPlays || specialStock() > 0) {
  if (plays >= maxPlays) break;
  const uid = `user-${plays + 1}`;
  const key = `stress-${String(plays + 1).padStart(8, "0")}`;
  playOnce(uid, key);
  keys.push({ uid, key });
}

const winnersBeforeReplay = winnerPlayIds.size;
const countsBeforeReplay = new Map(counts);
const stockBeforeReplay = specialStock();

for (const sample of keys.slice(0, 50)) {
  const before = counts.get("especial") ?? 0;
  const replayId = playOnce(sample.uid, sample.key);
  if (!playIds.has(replayId)) idempotencyViolations += 1;
  if ((counts.get("especial") ?? 0) !== before) idempotencyViolations += 1;
  if (winnerPlayIds.size !== winnersBeforeReplay) idempotencyViolations += 1;
  if (specialStock() !== stockBeforeReplay) idempotencyViolations += 1;
}

for (const [prizeId, initial] of initialStocks) {
  const prize = premios.find((item) => item.id === prizeId);
  const awarded = countsBeforeReplay.get(prizeId) ?? 0;
  if (initial == null) {
    if (prize?.stock != null) stockViolation = true;
    continue;
  }
  if (awarded > initial) stockViolation = true;
  if (prize?.stock !== initial - awarded) stockViolation = true;
  if (typeof prize?.stock === "number" && prize.stock < 0) negativeStock = true;
}

if (winnerPlayIds.size > specialMax) stockViolation = true;

const pointLines = POINT_LADDER.map((item) => {
  const count = countsBeforeReplay.get(`p${item.valor}`) ?? 0;
  return `${item.valor} pts:  ${count}`;
});

console.log("====================================");
console.log("MINIGAME STRESS TEST");
console.log("====================================");
console.log("");
console.log("Plays:");
console.log(plays);
console.log("");
console.log("Premios:");
console.log("");
for (const line of pointLines) console.log(line);
console.log("");
console.log("Especial:");
console.log(`config max winners: ${specialMax}`);
console.log(`winners observed: ${winnerPlayIds.size}`);
console.log(`remaining stock: ${specialStock()}`);
console.log("");
console.log("Stock violation:");
console.log(stockViolation ? "YES" : "NO");
console.log("");
console.log("Duplicate winners:");
console.log(duplicateWinners ? "YES" : "NO");
console.log("");
console.log("Negative stock:");
console.log(negativeStock ? "YES" : "NO");
console.log("");
console.log("Idempotency violations:");
console.log(idempotencyViolations > 0 ? "YES" : "NO");
console.log("");
console.log("====================================");

if (
  stockViolation ||
  duplicateWinners ||
  negativeStock ||
  idempotencyViolations > 0 ||
  winnerPlayIds.size !== specialMax ||
  specialStock() !== 0
) {
  process.exit(1);
}
