import fs from "fs";
import path from "path";
import { Timestamp } from "firebase-admin/firestore";
import { memoryFirestore } from "./helpers/memory-firestore";
import { prizeRoll } from "./helpers/prize-roll";

jest.mock("crypto", () => {
  const actual = jest.requireActual<typeof import("crypto")>("crypto");
  const { prizeRoll: roll } = require("./helpers/prize-roll") as typeof import("./helpers/prize-roll");
  return {
    ...actual,
    randomInt(min: number, max?: number) {
      if (max === undefined) return roll.take(min);
      return min + roll.take(max - min);
    },
  };
});

jest.mock("../src/config/app.firebase", () => {
  const { memoryFirestore: store } =
    require("./helpers/memory-firestore") as typeof import("./helpers/memory-firestore");
  return {
    firestoreApp: store.api,
    appOficial: {},
  };
});

jest.mock("../src/config/firebase.admin", () => {
  const { Timestamp, FieldValue } = require("firebase-admin/firestore");
  return {
    admin: {
      firestore: {
        Timestamp,
        FieldValue,
      },
    },
  };
});

import { firestoreApp } from "../src/config/app.firebase";
import { MINIJUEGO_TIPOS, MinijuegoPremio, PrizeType } from "../src/models/minijuego.model";
import loyaltyFeatureFlagsService from "../src/modules/loyalty/services/loyalty-feature-flags.service";
import { buildLadder, ladderWeightTotal } from "../src/scripts/minigame-prize-sim";
import minijuegoService from "../src/services/minijuego.service";

jest.setTimeout(120_000);

type PlayResponse = {
  id: string;
  prizeId: string;
  prizeType: string;
  prizeValue?: number;
  alreadyPlayed: boolean;
  intentosRestantes: number;
  resultPresentationKey: string;
  status: string;
};

let keySequence = 0;

function nextKey(prefix = "play"): string {
  keySequence += 1;
  return `${prefix}${String(keySequence).padStart(8, "0")}`.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 80);
}

function actor(uid: string) {
  return { uid, email: "request-body@no-usar.test" };
}

function seedUser(uid: string, email = `${uid}@socio.test`, telefono = "4771000000") {
  memoryFirestore.put(`usuariosApp/${uid}`, {
    email,
    telefono,
    puntosActuales: 0,
    createdAt: Timestamp.now(),
  });
}

function seedGame(
  id: string,
  prizes: MinijuegoPremio[],
  options?: { tipo?: string; intentos?: number },
) {
  memoryFirestore.put(`minijuegos/${id}`, {
    beneficioId: id,
    tipo: options?.tipo ?? "ruleta",
    estatus: true,
    intentosPorUsuario: options?.intentos ?? 1,
    audiencia: { visibilidad: "publico", usuariosPermitidos: [] },
  });
  memoryFirestore.put(`beneficios/${id}`, {
    estatus: true,
    titulo: "Minijuego de prueba",
  });
  for (const premio of prizes) {
    memoryFirestore.put(`minijuegos/${id}/premios/${premio.id}`, {
      ...premio,
      minijuegoId: id,
    });
  }
}

function participate(gameId: string, uid: string, key = nextKey(gameId)): Promise<PlayResponse> {
  return minijuegoService.play(gameId, actor(uid), key) as Promise<PlayResponse>;
}

async function playUsers(gameId: string, count: number, prefix: string): Promise<string[]> {
  const uids: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const uid = `${prefix}-${index}`;
    seedUser(uid);
    uids.push(uid);
    await participate(gameId, uid, nextKey(prefix));
  }
  return uids;
}

function winnersOf(gameId: string) {
  return memoryFirestore
    .list("ganadoresPremioEspecial")
    .filter((winner) => winner.minijuegoId === gameId);
}

function playsOf(gameId: string, uids: string[]) {
  return uids.flatMap((uid) =>
    memoryFirestore
      .list(`usuariosApp/${uid}/minijuego_jugadas`)
      .filter((play) => play.minijuegoId === gameId),
  );
}

function stockOf(gameId: string, prizeId: string): unknown {
  return memoryFirestore.read(`minijuegos/${gameId}/premios/${prizeId}`)?.stock ?? null;
}

function ledgerOf(uid: string) {
  return memoryFirestore
    .list("loyalty_transactions")
    .filter((entry) => entry.memberId === uid && entry.reasonCode === "MINIJUEGO_PRIZE");
}

function movementsOf(uid: string) {
  return memoryFirestore.list(`usuariosApp/${uid}/movimientos_puntos`);
}

function assertInvariants(
  gameId: string,
  uids: string[],
  prizes: MinijuegoPremio[],
) {
  const plays = playsOf(gameId, uids);
  for (const prize of prizes) {
    const current = memoryFirestore.read(`minijuegos/${gameId}/premios/${prize.id}`);
    const awarded = plays.filter((play) => play.prizeId === prize.id).length;
    expect(current).not.toBeNull();
    if (prize.stock == null) {
      expect(current?.stock ?? null).toBeNull();
    } else {
      expect(current?.stock).toBeGreaterThanOrEqual(0);
      expect(awarded).toBeLessThanOrEqual(prize.stock);
      expect(current?.stock).toBe(prize.stock - awarded);
    }
  }

  const winners = winnersOf(gameId);
  expect(new Set(winners.map((winner) => winner.playId)).size).toBe(winners.length);
  const specialIds = new Set(prizes.filter((prize) => prize.especial).map((prize) => prize.id));
  const specialPlays = plays.filter((play) => specialIds.has(String(play.prizeId)));
  expect(winners).toHaveLength(specialPlays.length);
}

function onlySpecial(id: string, stock: number, tipo: PrizeType = "physical"): MinijuegoPremio[] {
  return [
    {
      id: "especial",
      minijuegoId: id,
      nombre: "2 boletos León vs América",
      tipo,
      stock,
      weight: 1,
      orden: 0,
      especial: true,
      maxGanadores: stock,
    },
  ];
}

function onlyPoints(id: string, valor: number): MinijuegoPremio[] {
  return [
    {
      id: "puntos",
      minijuegoId: id,
      nombre: `${valor} puntos`,
      tipo: "points",
      valor,
      stock: null,
      weight: 1,
      orden: 0,
    },
  ];
}

function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

describe("motor real de premios", () => {
  beforeAll(() => {
    if (!(firestoreApp as { __memory?: boolean }).__memory) {
      throw new Error(
        "Las pruebas del motor se negaron a arrancar: el mock de Firestore no está activo.",
      );
    }
  });

  beforeEach(() => {
    keySequence = 0;
    memoryFirestore.reset();
    prizeRoll.reset();
    loyaltyFeatureFlagsService.clearCache();
  });

  it("mantiene el especial en 2 ganadores y stock 0", async () => {
    prizeRoll.mode = "last";
    const id = "max-2";
    const prizes = buildLadder(id, { specialStock: 2 });
    seedGame(id, prizes);
    const first = await playUsers(id, 12, "max2");

    expect(winnersOf(id)).toHaveLength(2);
    expect(stockOf(id, "especial")).toBe(0);

    const extra = await playUsers(id, 8, "max2extra");
    expect(winnersOf(id)).toHaveLength(2);
    expect(stockOf(id, "especial")).toBe(0);
    expect(prizeRoll.lastSpan).toBe(ladderWeightTotal(false));
    assertInvariants(id, [...first, ...extra], prizes);
  });

  it("entrega un solo especial cuando el stock es 1", async () => {
    prizeRoll.mode = "last";
    const id = "max-1";
    const prizes = buildLadder(id, { specialStock: 1 });
    seedGame(id, prizes);
    const uids = await playUsers(id, 15, "max1");
    const plays = playsOf(id, uids);

    expect(winnersOf(id)).toHaveLength(1);
    expect(stockOf(id, "especial")).toBe(0);
    expect(plays.filter((play) => play.prizeId === "especial")).toHaveLength(1);
    assertInvariants(id, uids, prizes);
  });

  it("deja un solo ganador entre 20 jugadas concurrentes con stock 1", async () => {
    prizeRoll.mode = "last";
    const id = "race-1";
    const prizes = buildLadder(id, { specialStock: 1 });
    seedGame(id, prizes);
    const uids = Array.from({ length: 20 }, (_, index) => `race1-${index}`);
    for (const uid of uids) seedUser(uid);

    const results = await Promise.all(
      uids.map((uid) => participate(id, uid, nextKey("race1"))),
    );

    const specialWinnerCount = results.filter((result) => result.prizeId === "especial").length;
    const stock = stockOf(id, "especial");
    expect(specialWinnerCount).toBe(1);
    expect(stock).toBe(0);
    expect(Number(stock)).toBeGreaterThanOrEqual(0);
    expect(winnersOf(id)).toHaveLength(1);
    assertInvariants(id, uids, prizes);
  });

  it("deja dos ganadores entre jugadas concurrentes con stock 2", async () => {
    prizeRoll.mode = "last";
    const id = "race-2";
    const prizes = buildLadder(id, { specialStock: 2 });
    seedGame(id, prizes);
    const uids = Array.from({ length: 20 }, (_, index) => `race2-${index}`);
    for (const uid of uids) seedUser(uid);

    const results = await Promise.all(
      uids.map((uid) => participate(id, uid, nextKey("race2"))),
    );

    expect(results.filter((result) => result.prizeId === "especial")).toHaveLength(2);
    expect(stockOf(id, "especial")).toBe(0);
    expect(winnersOf(id)).toHaveLength(2);
    assertInvariants(id, uids, prizes);
  });

  it("no sortea el especial agotado y sigue entregando puntos", async () => {
    const id = "agotado";
    const prizes = buildLadder(id, { specialStock: 0 });
    seedGame(id, prizes, { intentos: 5 });
    const uid = "jugador-agotado";
    seedUser(uid);
    prizeRoll.mode = "exact";
    prizeRoll.exact = 0;
    const first = await participate(id, uid, nextKey("agotado"));
    prizeRoll.exact = 30;
    const second = await participate(id, uid, nextKey("agotado"));

    expect(first.prizeId).toBe("p10");
    expect(second.prizeId).toBe("p20");
    expect(winnersOf(id)).toHaveLength(0);
    expect(stockOf(id, "especial")).toBe(0);
    expect(prizeRoll.lastSpan).toBe(ladderWeightTotal(false));
    expect(stockOf(id, "p10")).toBeNull();
    expect(stockOf(id, "p20")).toBeNull();
  });

  it("trata stock null como ilimitado", async () => {
    const id = "ilimitado";
    const prizes = onlyPoints(id, 15);
    seedGame(id, prizes, { intentos: 30 });
    const uid = "jugador-ilimitado";
    seedUser(uid);

    for (let index = 0; index < 25; index += 1) {
      const result = await participate(id, uid, nextKey("ilimitado"));
      expect(result.prizeId).toBe("puntos");
    }

    expect(stockOf(id, "puntos")).toBeNull();
    expect(ledgerOf(uid)).toHaveLength(25);
    expect(ledgerOf(uid).reduce((sum, entry) => sum + Number(entry.points), 0)).toBe(375);
  });

  it("repite la misma clave sin duplicar jugada, stock, ganador ni intento", async () => {
    prizeRoll.mode = "zero";
    const id = "idem-especial";
    const prizes = onlySpecial(id, 1);
    seedGame(id, prizes);
    const uid = "idem-user";
    seedUser(uid, "socio.real@clubleon.mx", "4775550101");
    const key = nextKey("idemespecial");
    const first = await minijuegoService.play(id, actor(uid), key) as PlayResponse;

    for (let index = 0; index < 10; index += 1) {
      const replay = await minijuegoService.play(id, actor(uid), key) as PlayResponse;
      expect(replay.id).toBe(first.id);
      expect(replay.prizeId).toBe(first.prizeId);
      expect(replay.alreadyPlayed).toBe(true);
    }

    expect(stockOf(id, "especial")).toBe(0);
    expect(winnersOf(id)).toHaveLength(1);
    expect(playsOf(id, [uid])).toHaveLength(1);
    expect(memoryFirestore.read(`usuariosApp/${uid}/minijuego_estado/${id}`)?.intentosUsados).toBe(1);
    expect(ledgerOf(uid)).toHaveLength(0);
  });

  it("no duplica el especial cuando la misma clave llega 10 veces en paralelo", async () => {
    prizeRoll.mode = "zero";
    const id = "idem-paralelo";
    const prizes = onlySpecial(id, 1);
    seedGame(id, prizes);
    const uid = "idem-paralelo-user";
    seedUser(uid);
    const key = nextKey("idemparalelo");

    const results = await Promise.all(
      Array.from({ length: 10 }, () => minijuegoService.play(id, actor(uid), key) as Promise<PlayResponse>),
    );

    expect(new Set(results.map((result) => result.id)).size).toBe(1);
    expect(new Set(results.map((result) => result.prizeId)).size).toBe(1);
    expect(stockOf(id, "especial")).toBe(0);
    expect(winnersOf(id)).toHaveLength(1);
    expect(playsOf(id, [uid])).toHaveLength(1);
  });

  it("acredita 50 puntos una sola vez al repetir la clave", async () => {
    const id = "ledger-50";
    seedGame(id, onlyPoints(id, 50));
    const uid = "ledger-user";
    seedUser(uid);
    const key = nextKey("ledger50");
    const first = await minijuegoService.play(id, actor(uid), key) as PlayResponse;

    for (let index = 0; index < 10; index += 1) {
      const replay = await minijuegoService.play(id, actor(uid), key) as PlayResponse;
      expect(replay.id).toBe(first.id);
      expect(replay.prizeId).toBe(first.prizeId);
    }

    const entries = ledgerOf(uid);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.points).toBe(50);
    expect(memoryFirestore.read(`usuariosApp/${uid}`)?.puntosActuales).toBe(50);
    expect(movementsOf(uid)).toHaveLength(1);
    expect(movementsOf(uid)[0]?.puntos).toBe(50);
  });

  it("acredita en paralelo una sola vez el mismo premio de puntos", async () => {
    const id = "ledger-paralelo";
    seedGame(id, onlyPoints(id, 50));
    const uid = "ledger-paralelo-user";
    seedUser(uid);
    const key = nextKey("ledgerparalelo");

    const results = await Promise.all(
      Array.from({ length: 10 }, () => minijuegoService.play(id, actor(uid), key) as Promise<PlayResponse>),
    );

    expect(new Set(results.map((result) => result.id)).size).toBe(1);
    expect(ledgerOf(uid)).toHaveLength(1);
    expect(ledgerOf(uid)[0]?.points).toBe(50);
    expect(memoryFirestore.read(`usuariosApp/${uid}`)?.puntosActuales).toBe(50);
    expect(movementsOf(uid)).toHaveLength(1);
  });

  it("acredita exactamente el valor de cada premio de puntos", async () => {
    const values = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 4, 8, 12];

    for (const valor of values) {
      const id = `puntos-${valor}`;
      const uid = `socio-${valor}`;
      seedGame(id, onlyPoints(id, valor));
      seedUser(uid);
      const result = await participate(id, uid, nextKey("puntos"));

      expect(result.prizeValue).toBe(valor);
      expect(ledgerOf(uid)).toHaveLength(1);
      expect(ledgerOf(uid)[0]?.points).toBe(valor);
      expect(memoryFirestore.read(`usuariosApp/${uid}`)?.puntosActuales).toBe(valor);
      expect(movementsOf(uid)[0]?.puntos).toBe(valor);
    }
  });

  it.each(["physical", "digital", "coupon"] as const)(
    "el especial %s no acredita puntos",
    async (tipo) => {
      prizeRoll.mode = "zero";
      const id = `especial-${tipo}`;
      const prizes = onlySpecial(id, 1, tipo);
      seedGame(id, prizes);
      const uid = `socio-${tipo}`;
      seedUser(uid);
      const result = await participate(id, uid, nextKey(tipo));

      expect(result.prizeId).toBe("especial");
      expect(result.prizeType).toBe(tipo);
      expect(result.status).toBe("completed");
      expect(stockOf(id, "especial")).toBe(0);
      expect(winnersOf(id)).toHaveLength(1);
      expect(playsOf(id, [uid])).toHaveLength(1);
      expect(memoryFirestore.read(`usuariosApp/${uid}/minijuego_estado/${id}`)?.intentosUsados).toBe(1);
      expect(ledgerOf(uid)).toHaveLength(0);
      expect(movementsOf(uid)).toHaveLength(0);
      expect(memoryFirestore.read(`usuariosApp/${uid}`)?.puntosActuales).toBe(0);
    },
  );

  it("guarda uid, email y telefono del perfil, no del request", async () => {
    prizeRoll.mode = "zero";
    const id = "perfil";
    seedGame(id, onlySpecial(id, 1));
    const uid = "uid-autenticado";
    seedUser(uid, "socio.real@clubleon.mx", "4775550101");
    const result = await minijuegoService.play(
      id,
      { uid, email: "request-body@no-usar.test" },
      nextKey("perfil"),
    ) as PlayResponse;
    const winner = winnersOf(id)[0];

    expect(winner?.uid).toBe(uid);
    expect(winner?.email).toBe("socio.real@clubleon.mx");
    expect(winner?.telefono).toBe("4775550101");
    expect(winner?.email).not.toBe("request-body@no-usar.test");
    expect(winner?.playId).toBe(result.id);
    expect(winner?.premioId).toBe(result.prizeId);
    expect(winner?.minijuegoId).toBe(id);
    expect(typeof (winner?.createdAt as { toDate?: () => Date } | undefined)?.toDate).toBe(
      "function",
    );
    expect(winnersOf(id).filter((item) => item.playId === result.id)).toHaveLength(1);
  });

  it.each([
    ["puntos bajos", 10],
    ["puntos altos", 100],
  ] as const)("consume el intento al ganar %s", async (_label, valor) => {
    const id = `intento-${valor}`;
    seedGame(id, onlyPoints(id, valor));
    const uid = `intento-${valor}`;
    seedUser(uid);
    await participate(id, uid, nextKey("intento"));

    await expect(participate(id, uid, nextKey("intento"))).rejects.toMatchObject({
      code: "MINIGAME_NO_ATTEMPTS",
    });
    expect(memoryFirestore.read(`usuariosApp/${uid}/minijuego_estado/${id}`)?.intentosUsados).toBe(1);
    expect(ledgerOf(uid)).toHaveLength(1);
    expect(ledgerOf(uid)[0]?.points).toBe(valor);
    expect(playsOf(id, [uid])).toHaveLength(1);
  });

  it("consume el intento al ganar el especial", async () => {
    prizeRoll.mode = "zero";
    const id = "intento-especial";
    seedGame(id, onlySpecial(id, 1));
    const uid = "intento-especial";
    seedUser(uid);
    await participate(id, uid, nextKey("intentoesp"));

    await expect(participate(id, uid, nextKey("intentoesp"))).rejects.toMatchObject({
      code: "MINIGAME_NO_ATTEMPTS",
    });
    expect(winnersOf(id)).toHaveLength(1);
    expect(stockOf(id, "especial")).toBe(0);
    expect(playsOf(id, [uid])).toHaveLength(1);
    expect(ledgerOf(uid)).toHaveLength(0);
  });

  it("usa el mismo premio para ruleta, cofre, rasca, cartas y sobre", async () => {
    prizeRoll.mode = "last";
    const prizeIds: string[] = [];

    for (const tipo of MINIJUEGO_TIPOS) {
      const id = `tipo-${tipo}`;
      const prizes = buildLadder(id, { specialStock: 2 });
      seedGame(id, prizes, { tipo });
      const uid = `jugador-${tipo}`;
      seedUser(uid);
      const result = await participate(id, uid, nextKey(tipo));
      prizeIds.push(result.prizeId);
      expect(result.resultPresentationKey).toBe(result.prizeId);
      expect(playsOf(id, [uid])).toHaveLength(1);
    }

    expect(new Set(prizeIds)).toEqual(new Set(["especial"]));
    expect(MINIJUEGO_TIPOS).toEqual(["ruleta", "cofre", "rasca", "cartas", "sobre"]);
  });

  it("revelar tres cartas repite el mismo premio y no vuelve a sortear", async () => {
    prizeRoll.mode = "last";
    const id = "cartas";
    const prizes = buildLadder(id, { specialStock: 2 });
    seedGame(id, prizes, { tipo: "cartas" });
    const uid = "jugador-cartas";
    seedUser(uid);
    const key = nextKey("cartas");
    const first = await minijuegoService.play(id, actor(uid), key) as PlayResponse;
    const second = await minijuegoService.play(id, actor(uid), key) as PlayResponse;
    const third = await minijuegoService.play(id, actor(uid), key) as PlayResponse;

    expect(first.prizeId).toBe("especial");
    expect(second.prizeId).toBe(first.prizeId);
    expect(third.prizeId).toBe(first.prizeId);
    expect(second.id).toBe(first.id);
    expect(third.id).toBe(first.id);
    expect(playsOf(id, [uid])).toHaveLength(1);
    expect(winnersOf(id)).toHaveLength(1);
    expect(stockOf(id, "especial")).toBe(1);
    expect(prizeRoll.spans).toHaveLength(1);
  });

  it("Flutter no usa Random para decidir premios y las cartas revelan una sola jugada", () => {
    const root = path.resolve(
      __dirname,
      "../../../FrontClubLeon/lib/src/features/minigames",
    );
    const files = dartFiles(root);
    expect(files.length).toBeGreaterThan(5);

    for (const file of files) {
      const source = fs.readFileSync(file, "utf8");
      expect(source).not.toMatch(/\bRandom\s*\(/);
      expect(source).not.toMatch(/math\.Random/);
    }

    const cards = fs.readFileSync(
      path.join(root, "games", "cards", "cards_game_screen.dart"),
      "utf8",
    );
    const host = fs.readFileSync(path.join(root, "widgets", "minigame_play_host.dart"), "utf8");
    expect(cards.match(/participate\(/g)).toHaveLength(1);
    expect(cards).toContain("if (!alreadyDecided)");
    expect(host.match(/_session\.play\(/g)).toHaveLength(1);
    expect(host).toContain("if (existing != null) return existing;");
  });

  it("conserva las invariantes de stock en configuraciones aleatorias", async () => {
    const rand = lcg(20261013);

    for (let trial = 0; trial < 6; trial += 1) {
      const id = `fuzz-${trial}`;
      const limited = Math.floor(rand() * 3);
      const prizes: MinijuegoPremio[] = [
        {
          id: "libre",
          minijuegoId: id,
          nombre: `${4 + trial} puntos`,
          tipo: "points",
          valor: 4 + trial,
          stock: null,
          weight: 1 + Math.floor(rand() * 5),
          orden: 0,
        },
        {
          id: "caja",
          minijuegoId: id,
          nombre: "Caja",
          tipo: "physical",
          stock: limited,
          weight: 1 + Math.floor(rand() * 4),
          orden: 1,
        },
        {
          id: "especial",
          minijuegoId: id,
          nombre: "2 boletos León vs América",
          tipo: "coupon",
          stock: 1,
          weight: 1,
          orden: 2,
          especial: true,
          maxGanadores: 1,
        },
      ];
      seedGame(id, prizes);
      prizeRoll.mode = trial % 2 === 0 ? "last" : "zero";
      const uids = await playUsers(id, 6, `fuzz${trial}`);
      assertInvariants(id, uids, prizes);
      expect(winnersOf(id).length).toBeLessThanOrEqual(1);
      expect(Number(stockOf(id, "especial"))).toBeGreaterThanOrEqual(0);
      expect(Number(stockOf(id, "caja"))).toBeGreaterThanOrEqual(0);
      expect(stockOf(id, "libre")).toBeNull();
    }
  });

  it("no crea un tercer ganador de 2 boletos León vs América", async () => {
    prizeRoll.mode = "last";
    const id = "leon-america";
    const prizes = buildLadder(id, {
      specialStock: 2,
      specialNombre: "2 boletos León vs América",
    });
    seedGame(id, prizes);
    const winners = await playUsers(id, 2, "boleto");
    expect(winnersOf(id)).toHaveLength(2);
    expect(stockOf(id, "especial")).toBe(0);

    const extra = await playUsers(id, 100, "despues");
    const specialWinners = winnersOf(id).length;
    const specialStock = stockOf(id, "especial");

    expect(specialWinners).toBe(2);
    expect(specialStock).toBe(0);
    expect(playsOf(id, [...winners, ...extra]).filter((play) => play.prizeId === "especial")).toHaveLength(2);
    assertInvariants(id, [...winners, ...extra], prizes);
  });
});

function dartFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return dartFiles(full);
    return entry.name.endsWith(".dart") ? [full] : [];
  });
}
