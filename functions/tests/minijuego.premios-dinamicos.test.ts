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
import { guardarMinijuegoSchema } from "../src/middleware/validators/minijuego.validator";
import {
  GuardarMinijuegoInput,
  MAX_PREMIOS_MINIJUEGO,
  MinijuegoPremio,
  PremioInput,
} from "../src/models/minijuego.model";
import loyaltyFeatureFlagsService from "../src/modules/loyalty/services/loyalty-feature-flags.service";
import {
  adminPrizeProbabilities,
  eligiblePrizes,
  hasEligiblePrize,
  pickWeightedPrize,
  prepareMinijuegoWrite,
  prizeDrawWeights,
  rouletteSegments,
} from "../src/services/minijuego.logic";
import { percentToUnits } from "../src/services/minijuego.probability";
import minijuegoService from "../src/services/minijuego.service";

jest.setTimeout(120_000);

type AdminPremio = {
  id: string;
  nombre: string;
  tipo: string;
  valor?: number;
  probabilidad: number;
  stock: number | null;
  especial?: boolean;
  maxGanadores?: number;
};

type AdminView = {
  id: string;
  minijuegoId: string;
  minijuego: { premios: AdminPremio[] };
};

type Details = {
  segments: Array<{ id: string; label: string }>;
  premiosDisponibles: boolean;
  pendingPlay: { id: string; prizeId: string } | null;
};

type PlayResponse = { id: string; prizeId: string; alreadyPlayed: boolean };

function payload(premios: PremioInput[], intentos = 1): GuardarMinijuegoInput {
  return {
    beneficio: { titulo: "Ruleta dinámica", descripcion: "Gira y gana", estatus: true },
    minijuego: {
      tipo: "ruleta",
      intentosPorUsuario: intentos,
      audiencia: { visibilidad: "publico", usuariosPermitidos: [] },
    },
    premios,
  };
}

function puntos(valor: number, probabilidad: number, id?: string): PremioInput {
  return {
    ...(id ? { id } : {}),
    nombre: `${valor} puntos`,
    tipo: "points",
    valor,
    probabilidad,
  };
}

function especial(
  probabilidad: number,
  stock: number,
  extra: Partial<PremioInput> = {},
): PremioInput {
  return {
    nombre: "2 boletos León vs América",
    tipo: "physical",
    stock,
    maxGanadores: stock,
    especial: true,
    probabilidad,
    ...extra,
  };
}

/** n premios de puntos que suman exactamente 100 % (unidades enteras). */
function ladder(n: number): PremioInput[] {
  const base = Math.floor(100_000 / n);
  return Array.from({ length: n }, (_, index) => {
    const units = index === n - 1 ? 100_000 - base * (n - 1) : base;
    return puntos((index + 1) * 10, units / 1000);
  });
}

function seedUser(uid: string) {
  memoryFirestore.put(`usuariosApp/${uid}`, {
    email: `${uid}@socio.test`,
    telefono: "4771000000",
    puntosActuales: 0,
    createdAt: Timestamp.now(),
  });
}

let keySequence = 0;
function nextKey(prefix = "din"): string {
  keySequence += 1;
  return `${prefix}${String(keySequence).padStart(8, "0")}`;
}

function play(gameId: string, uid: string, key = nextKey()): Promise<PlayResponse> {
  return minijuegoService.play(gameId, { uid }, key) as Promise<PlayResponse>;
}

function details(gameId: string, uid: string): Promise<Details> {
  return minijuegoService.getDetails(gameId, { uid }) as Promise<Details>;
}

async function create(premios: PremioInput[], intentos = 1): Promise<AdminView> {
  return (await minijuegoService.createMinijuegoBeneficio(
    payload(premios, intentos),
  )) as unknown as AdminView;
}

function premiosGuardados(minijuegoId: string) {
  return memoryFirestore
    .list(`minijuegos/${minijuegoId}/premios`)
    .sort((a, b) => Number(a.orden) - Number(b.orden));
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
    // Igual que mapPremio en juegos antiguos: el peso nunca baja de 1.
    weight: Math.max(1, percentToUnits(row.probabilidad) ?? 1),
    probabilidad: row.probabilidad,
    orden: index,
    ...(row.especial ? { especial: true } : {}),
  }));
}

/** Recorre todos los cursores posibles: la distribución exacta del selector. */
function exactCounts(premios: MinijuegoPremio[]): Map<string, number> {
  const total = eligiblePrizes(premios).reduce((sum, item) => sum + item.weight, 0);
  const counts = new Map<string, number>(premios.map((premio) => [premio.id, 0]));
  for (let cursor = 0; cursor < total; cursor += 1) {
    const premio = pickWeightedPrize(premios, () => cursor);
    counts.set(premio.id, (counts.get(premio.id) ?? 0) + 1);
  }
  return counts;
}

describe("premios dinámicos: validación al guardar", () => {
  it.each([1, 4, 8, 10, 13, 25, MAX_PREMIOS_MINIJUEGO])(
    "acepta %i premios que suman 100 %%",
    (n) => {
      const prepared = prepareMinijuegoWrite(payload(ladder(n)));
      expect(prepared.premios).toHaveLength(n);
      expect(prepared.premios.reduce((sum, premio) => sum + premio.weight, 0)).toBe(100_000);
      expect(guardarMinijuegoSchema.safeParse(payload(ladder(n))).success).toBe(true);
    },
  );

  it("el tope compartido es 50 en zod y en la lógica", () => {
    expect(MAX_PREMIOS_MINIJUEGO).toBe(50);
    const demasiados = ladder(MAX_PREMIOS_MINIJUEGO + 1);
    expectError(
      () => prepareMinijuegoWrite(payload(demasiados)),
      "MINIGAME_TOO_MANY_PRIZES",
      "Un minijuego puede tener máximo 50 premios.",
    );
    expect(guardarMinijuegoSchema.safeParse(payload(demasiados)).success).toBe(false);
    expectError(() => prepareMinijuegoWrite(payload([])), "MINIGAME_PRIZES_REQUIRED");
  });

  it("acepta 0 % en premios de puntos y en el especial (solo null es error)", () => {
    const prepared = prepareMinijuegoWrite(
      payload([puntos(10, 0), puntos(20, 100), especial(0, 1)]),
    );
    expect(prepared.premios.map((premio) => premio.weight)).toEqual([0, 100_000, 0]);
    expect(prepared.premios.map((premio) => premio.probabilidad)).toEqual([0, 100, 0]);
    expect(prepared.premios[2]).toMatchObject({ especial: true, stock: 1, maxGanadores: 1 });

    expectError(
      () =>
        prepareMinijuegoWrite(
          payload([
            puntos(10, 100),
            { nombre: "20 puntos", tipo: "points", valor: 20 } as PremioInput,
          ]),
        ),
      "MINIGAME_PROBABILITY_REQUIRED",
    );
    expect(
      guardarMinijuegoSchema.safeParse(payload([puntos(10, 0), puntos(20, 100)])).success,
    ).toBe(true);
  });

  it("rechaza ids de premio repetidos con 400 MINIGAME_INVALID_PRIZE", () => {
    expectError(
      () =>
        prepareMinijuegoWrite(
          payload([puntos(10, 50, "p-1"), puntos(20, 25, "p-2"), puntos(30, 25, " p-1 ")]),
        ),
      "MINIGAME_INVALID_PRIZE",
      "El premio 3 repite el id del premio 1. Recarga el panel e inténtalo de nuevo.",
    );
    expect(() =>
      prepareMinijuegoWrite(payload([puntos(10, 50, "x"), puntos(20, 50, "x")])),
    ).toThrow(expect.objectContaining({ code: "MINIGAME_INVALID_PRIZE", status: 400 }));
    // zod no los rechaza: la regla vive en la lógica (código propio).
    expect(
      guardarMinijuegoSchema.safeParse(payload([puntos(10, 50, "x"), puntos(20, 50, "x")])).success,
    ).toBe(true);
    // Premios nuevos (sin id) nunca chocan entre sí.
    expect(
      prepareMinijuegoWrite(payload([puntos(10, 50), puntos(20, 50)])).premios,
    ).toHaveLength(2);
  });
});

describe("premios dinámicos: elegibles, sorteo y sectores", () => {
  it("un premio de 0 % nunca sale en ninguno de los 100000 resultados posibles", () => {
    const prizes = percentPrizes([
      { id: "cero-inicio", probabilidad: 0 },
      { id: "A", probabilidad: 60 },
      { id: "cero-medio", probabilidad: 0 },
      { id: "B", probabilidad: 40 },
      { id: "especial", probabilidad: 0, stock: 5, especial: true },
    ]);
    expect(prizeDrawWeights(prizes)).toEqual([0, 60_000, 0, 40_000, 0]);
    const counts = exactCounts(prizes);
    expect(counts.get("A")).toBe(60_000);
    expect(counts.get("B")).toBe(40_000);
    expect(counts.get("cero-inicio")).toBe(0);
    expect(counts.get("cero-medio")).toBe(0);
    expect(counts.get("especial")).toBe(0);
  });

  it("en un juego antiguo con pesos, la probabilidad 0 manda aunque el peso sea ≥ 1", () => {
    const legacy: MinijuegoPremio[] = [
      { id: "w5", minijuegoId: "g", nombre: "5", tipo: "points", valor: 5, stock: null, weight: 5, orden: 0 },
      // mapPremio fuerza weight ≥ 1, pero el premio tiene 0 % definido.
      { id: "cero", minijuegoId: "g", nombre: "0", tipo: "points", valor: 1, stock: null, weight: 1, probabilidad: 0, orden: 1 },
      { id: "w3", minijuegoId: "g", nombre: "3", tipo: "points", valor: 3, stock: null, weight: 3, orden: 2 },
    ];
    expect(prizeDrawWeights(legacy)).toEqual([5, 0, 3]);
    const counts = exactCounts(legacy);
    expect(counts.get("cero")).toBe(0);
    expect(counts.get("w5")).toBe(5);
    expect(counts.get("w3")).toBe(3);
    expect(rouletteSegments(legacy).map((premio) => premio.id)).toEqual(["w5", "w3"]);
    // El panel lo ve en 0 % (convertido) y al guardar sigue deshabilitado.
    const admin = adminPrizeProbabilities(legacy);
    expect(admin.modo).toBe("convertida");
    expect(admin.porcentajes[1]).toBe(0);
    expect(admin.porcentajes.reduce((sum, value) => sum + (percentToUnits(value) ?? 0), 0)).toBe(100_000);
  });

  it("los sectores solo incluyen premios elegibles y conservan el de la jugada pendiente", () => {
    const prizes = percentPrizes([
      { id: "cero", probabilidad: 0 },
      { id: "A", probabilidad: 70 },
      { id: "agotado", probabilidad: 29.7, stock: 0 },
      { id: "especial", probabilidad: 0.3, stock: 1, especial: true },
    ]);
    expect(rouletteSegments(prizes).map((premio) => premio.id)).toEqual(["A", "especial"]);
    expect(rouletteSegments(prizes, "agotado").map((premio) => premio.id)).toEqual([
      "A",
      "agotado",
      "especial",
    ]);
    expect(rouletteSegments(prizes, "no-existe").map((premio) => premio.id)).toEqual([
      "A",
      "especial",
    ]);
  });

  it("sin elegibles (todo en 0 % salvo un especial agotado) no hay premios disponibles", () => {
    const prizes = percentPrizes([
      { id: "cero-1", probabilidad: 0 },
      { id: "cero-2", probabilidad: 0 },
      { id: "especial", probabilidad: 100, stock: 0, especial: true },
    ]);
    expect(hasEligiblePrize(prizes)).toBe(false);
    expect(rouletteSegments(prizes)).toEqual([]);
    expect(() => pickWeightedPrize(prizes, () => 0)).toThrow(
      expect.objectContaining({ code: "MINIGAME_NO_PRIZES", status: 409 }),
    );
    prizes[2].stock = 1;
    expect(hasEligiblePrize(prizes)).toBe(true);
  });
});

describe("premios dinámicos: servicio con Firestore en memoria", () => {
  beforeAll(() => {
    if (!(firestoreApp as { __memory?: boolean }).__memory) {
      throw new Error("El mock de Firestore no está activo.");
    }
  });

  beforeEach(() => {
    keySequence = 0;
    memoryFirestore.reset();
    prizeRoll.reset();
    loyaltyFeatureFlagsService.clearCache();
  });

  it.each([1, 4, 8, 10, 13, MAX_PREMIOS_MINIJUEGO])(
    "crea y juega un minijuego con %i premios",
    async (n) => {
      const created = await create(ladder(n));
      expect(premiosGuardados(created.minijuegoId)).toHaveLength(n);
      expect(created.minijuego.premios).toHaveLength(n);

      seedUser("jugador");
      const view = await details(created.minijuegoId, "jugador");
      expect(view.segments).toHaveLength(n);
      expect(view.premiosDisponibles).toBe(true);

      prizeRoll.mode = "last";
      const result = await play(created.minijuegoId, "jugador");
      expect(result.prizeId).toBe(created.minijuego.premios[n - 1].id);
    },
  );

  it("un premio de 0 % nunca sale al jugar y no aparece como sector", async () => {
    const created = await create(
      [puntos(10, 0), puntos(20, 70), puntos(30, 0), puntos(40, 30), puntos(50, 0)],
      10,
    );
    const ids = created.minijuego.premios.map((premio) => premio.id);
    seedUser("socio");

    const view = await details(created.minijuegoId, "socio");
    expect(view.segments.map((segment) => segment.id)).toEqual([ids[1], ids[3]]);
    expect(view.segments.map((segment) => segment.label)).toEqual(["20", "40"]);

    const ganados: string[] = [];
    prizeRoll.mode = "zero";
    ganados.push((await play(created.minijuegoId, "socio")).prizeId);
    prizeRoll.mode = "last";
    ganados.push((await play(created.minijuegoId, "socio")).prizeId);
    prizeRoll.mode = "exact";
    for (const cursor of [69_999, 70_000, 99_999]) {
      prizeRoll.exact = cursor;
      ganados.push((await play(created.minijuegoId, "socio")).prizeId);
    }
    expect(prizeRoll.lastSpan).toBe(100_000);
    expect(ganados).toEqual([ids[1], ids[3], ids[1], ids[3], ids[3]]);
    expect(ganados.some((id) => [ids[0], ids[2], ids[4]].includes(id))).toBe(false);
  });

  it("un juego antiguo con un premio de 0 % guardado no lo sortea aunque mapPremio fuerce peso 1", async () => {
    const id = "legado-cero";
    memoryFirestore.put(`beneficios/${id}`, { estatus: true, titulo: "Legado" });
    memoryFirestore.put(`minijuegos/${id}`, {
      beneficioId: id,
      tipo: "ruleta",
      estatus: true,
      intentosPorUsuario: 20,
      audiencia: { visibilidad: "publico", usuariosPermitidos: [] },
    });
    memoryFirestore.put(`minijuegos/${id}/premios/w5`, {
      minijuegoId: id, nombre: "5 puntos", tipo: "points", valor: 5, stock: null, weight: 5, orden: 0,
    });
    memoryFirestore.put(`minijuegos/${id}/premios/cero`, {
      minijuegoId: id, nombre: "1 punto", tipo: "points", valor: 1, stock: null, weight: 0, probabilidad: 0, orden: 1,
    });
    memoryFirestore.put(`minijuegos/${id}/premios/w3`, {
      minijuegoId: id, nombre: "3 puntos", tipo: "points", valor: 3, stock: null, weight: 3, orden: 2,
    });
    seedUser("legado");

    const view = await details(id, "legado");
    expect(view.segments.map((segment) => segment.id)).toEqual(["w5", "w3"]);

    prizeRoll.mode = "exact";
    const ganados: string[] = [];
    for (let cursor = 0; cursor < 8; cursor += 1) {
      prizeRoll.exact = cursor;
      ganados.push((await play(id, "legado")).prizeId);
    }
    expect(prizeRoll.lastSpan).toBe(8);
    expect(ganados.filter((prize) => prize === "cero")).toHaveLength(0);
    expect(ganados.filter((prize) => prize === "w5")).toHaveLength(5);
    expect(ganados.filter((prize) => prize === "w3")).toHaveLength(3);
  });

  it("ids repetidos al editar responden 400 sin escribir nada", async () => {
    const created = await create(ladder(4));
    const before = JSON.stringify(premiosGuardados(created.minijuegoId));
    const ids = created.minijuego.premios.map((premio) => premio.id);

    await expect(
      minijuegoService.updateMinijuegoBeneficio(
        created.id,
        payload([
          puntos(10, 25, ids[0]),
          puntos(20, 25, ids[1]),
          puntos(30, 25, ids[1]),
          puntos(40, 25, ids[3]),
        ]),
      ),
    ).rejects.toMatchObject({ code: "MINIGAME_INVALID_PRIZE", status: 400 });
    expect(JSON.stringify(premiosGuardados(created.minijuegoId))).toBe(before);
    expect(memoryFirestore.list(`minijuegos/${created.minijuegoId}/premiosArchivados`)).toEqual([]);
  });

  it("al quitar premios los archiva en la misma edición, con fecha y autor, sin tocar jugadas ni ganadores", async () => {
    const created = await create([...ladder(10).map((premio) => ({ ...premio, probabilidad: 9.97 })), especial(0.3, 2)]);
    const premios = created.minijuego.premios;
    seedUser("ganador");
    prizeRoll.mode = "last";
    const ganado = await play(created.minijuegoId, "ganador");
    expect(ganado.prizeId).toBe(premios[10].id);
    const jugadasAntes = JSON.stringify(memoryFirestore.list("usuariosApp/ganador/minijuego_jugadas"));
    const ganadoresAntes = JSON.stringify(memoryFirestore.list("ganadoresPremioEspecial"));

    // Se quedan 5 premios de puntos (el resto y el especial se quitan).
    const kept = premios.slice(0, 5).map((premio) => puntos(premio.valor ?? 0, 20, premio.id));
    await minijuegoService.updateMinijuegoBeneficio(created.id, payload(kept), {
      uid: "staff-uid",
    });

    const vivos = premiosGuardados(created.minijuegoId);
    expect(vivos.map((premio) => premio.id)).toEqual(premios.slice(0, 5).map((premio) => premio.id));
    const archivados = memoryFirestore.list(`minijuegos/${created.minijuegoId}/premiosArchivados`);
    expect(archivados.map((premio) => premio.id).sort()).toEqual(
      premios.slice(5).map((premio) => premio.id).sort(),
    );
    const especialArchivado = archivados.find((premio) => premio.id === premios[10].id);
    expect(especialArchivado).toMatchObject({
      nombre: "2 boletos León vs América",
      especial: true,
      probabilidad: 0.3,
      stock: 1,
      maxGanadores: 2,
      archivadoPor: "staff-uid",
    });
    expect(typeof (especialArchivado?.archivadoEl as { toDate?: unknown })?.toDate).toBe("function");

    // Jugadas, ganadores y puntos no se tocan.
    expect(JSON.stringify(memoryFirestore.list("usuariosApp/ganador/minijuego_jugadas"))).toBe(jugadasAntes);
    expect(JSON.stringify(memoryFirestore.list("ganadoresPremioEspecial"))).toBe(ganadoresAntes);

    // Sin uid no se escribe archivadoPor.
    await minijuegoService.updateMinijuegoBeneficio(
      created.id,
      payload(kept.slice(0, 4).map((premio) => ({ ...premio, probabilidad: 25 }))),
    );
    const ultimo = memoryFirestore.read(
      `minijuegos/${created.minijuegoId}/premiosArchivados/${premios[4].id}`,
    );
    expect(ultimo).not.toBeNull();
    expect(ultimo).not.toHaveProperty("archivadoPor");

    // Los archivados nunca vuelven como sector.
    const view = await details(created.minijuegoId, "otro-socio");
    expect(view.segments.map((segment) => segment.id)).toEqual(
      premios.slice(0, 4).map((premio) => premio.id),
    );
  });

  it("mis beneficios recurre al premio archivado cuando ya no está en premios", async () => {
    const created = await create([
      puntos(10, 99.7),
      especial(0.3, 1, {
        terminos: "Canje con identificación oficial.",
        caducaEl: "2099-12-31T00:00:00.000Z",
      }),
    ]);
    const especialId = created.minijuego.premios[1].id;
    memoryFirestore.put("ganadoresPremioEspecial/legado-archivado", {
      id: "legado-archivado",
      playId: "legado-archivado",
      minijuegoId: created.minijuegoId,
      beneficioId: created.id,
      beneficioTitulo: "Ruleta dinámica",
      uid: "socio-legado",
      premioId: especialId,
      premioNombre: "2 boletos León vs América",
      createdAt: Timestamp.fromDate(new Date("2026-02-01T00:00:00.000Z")),
    });

    await minijuegoService.updateMinijuegoBeneficio(
      created.id,
      payload([puntos(10, 100, created.minijuego.premios[0].id)]),
    );
    expect(memoryFirestore.read(`minijuegos/${created.minijuegoId}/premios/${especialId}`)).toBeNull();

    const [beneficio] = await minijuegoService.listMisBeneficios({ uid: "socio-legado" });
    expect(beneficio).toMatchObject({
      playId: "legado-archivado",
      terminos: "Canje con identificación oficial.",
      caducaEl: "2099-12-31T00:00:00.000Z",
      cartaImagenUrl: null,
      cartaDiseno: null,
    });
  });

  it("sin premios elegibles: premiosDisponibles false y jugar responde 409 sin consumir el intento", async () => {
    // Válido al guardar: solo el especial tiene probabilidad.
    const created = await create([puntos(10, 0), puntos(20, 0), especial(100, 1)], 3);
    const especialId = created.minijuego.premios[2].id;
    seedUser("primero");
    seedUser("segundo");

    const antes = await details(created.minijuegoId, "segundo");
    expect(antes.premiosDisponibles).toBe(true);
    expect(antes.segments.map((segment) => segment.id)).toEqual([especialId]);

    const ganado = await play(created.minijuegoId, "primero");
    expect(ganado.prizeId).toBe(especialId);

    const despues = await details(created.minijuegoId, "segundo");
    expect(despues.segments).toEqual([]);
    expect(despues.premiosDisponibles).toBe(false);

    await expect(play(created.minijuegoId, "segundo")).rejects.toMatchObject({
      code: "MINIGAME_NO_PRIZES",
      status: 409,
    });
    expect(memoryFirestore.read(`usuariosApp/segundo/minijuego_estado/${created.minijuegoId}`)).toBeNull();
    expect(memoryFirestore.list("usuariosApp/segundo/minijuego_jugadas")).toEqual([]);

    // Quien ya ganó conserva su jugada pendiente: hay algo que mostrar.
    const conPendiente = await details(created.minijuegoId, "primero");
    expect(conPendiente.premiosDisponibles).toBe(true);
    expect(conPendiente.pendingPlay?.prizeId).toBe(especialId);
    expect(conPendiente.segments.map((segment) => segment.id)).toEqual([especialId]);

    // Un segundo intento tampoco se consume.
    await expect(play(created.minijuegoId, "primero")).rejects.toMatchObject({
      code: "MINIGAME_NO_PRIZES",
    });
    expect(
      memoryFirestore.read(`usuariosApp/primero/minijuego_estado/${created.minijuegoId}`)?.intentosUsados,
    ).toBe(1);
    expect(memoryFirestore.list("usuariosApp/primero/minijuego_jugadas")).toHaveLength(1);

    await minijuegoService.acknowledge(created.minijuegoId, ganado.id, { uid: "primero" });
    const revelado = await details(created.minijuegoId, "primero");
    expect(revelado.pendingPlay).toBeNull();
    expect(revelado.premiosDisponibles).toBe(false);
  });

  it("la jugada pendiente de un premio archivado no agrega sectores", async () => {
    const created = await create([puntos(10, 50), puntos(20, 50)], 2);
    const [primero, segundo] = created.minijuego.premios;
    seedUser("pendiente");
    prizeRoll.mode = "last";
    const ganado = await play(created.minijuegoId, "pendiente");
    expect(ganado.prizeId).toBe(segundo.id);

    await minijuegoService.updateMinijuegoBeneficio(
      created.id,
      payload([puntos(10, 100, primero.id)]),
    );
    const view = await details(created.minijuegoId, "pendiente");
    expect(view.pendingPlay?.prizeId).toBe(segundo.id);
    expect(view.segments.map((segment) => segment.id)).toEqual([primero.id]);
    expect(view.premiosDisponibles).toBe(true);
  });

  it("el stock del especial cuenta solo a los ganadores de ese premio, sin tope", async () => {
    const created = await create([puntos(10, 99.7), especial(0.3, 2)], 5);
    const [puntosPremio, especialViejo] = created.minijuego.premios;
    prizeRoll.mode = "last";
    seedUser("viejo-1");
    expect((await play(created.minijuegoId, "viejo-1")).prizeId).toBe(especialViejo.id);
    expect(
      memoryFirestore.read(`minijuegos/${created.minijuegoId}/premios/${especialViejo.id}`)?.stock,
    ).toBe(1);

    // Se reemplaza el especial por uno nuevo (sin id): no hereda la victoria.
    const reemplazo = (await minijuegoService.updateMinijuegoBeneficio(
      created.id,
      payload([puntos(10, 99.7, puntosPremio.id), especial(0.3, 3, { nombre: "Playera firmada" })], 5),
    )) as unknown as AdminView;
    const especialNuevo = reemplazo.minijuego.premios.find((premio) => premio.especial);
    expect(especialNuevo?.id).not.toBe(especialViejo.id);
    expect(especialNuevo).toMatchObject({ stock: 3, maxGanadores: 3 });

    seedUser("nuevo-1");
    expect((await play(created.minijuegoId, "nuevo-1")).prizeId).toBe(especialNuevo?.id);

    // Subir el máximo de 3 a 5 descuenta solo su propio ganador (5 - 1).
    const ampliado = (await minijuegoService.updateMinijuegoBeneficio(
      created.id,
      payload(
        [
          puntos(10, 99.7, puntosPremio.id),
          especial(0.3, 5, { id: especialNuevo?.id, nombre: "Playera firmada" }),
        ],
        5,
      ),
    )) as unknown as AdminView;
    expect(ampliado.minijuego.premios.find((premio) => premio.especial)).toMatchObject({
      id: especialNuevo?.id,
      stock: 4,
      maxGanadores: 5,
    });

    // Más de 200 ganadores: los del especial viejo se ignoran y los del
    // actual se cuentan todos (antes había un tope de 200 sin filtrar).
    for (let index = 0; index < 205; index += 1) {
      memoryFirestore.put(`ganadoresPremioEspecial/viejo-${index}`, {
        minijuegoId: created.minijuegoId,
        premioId: especialViejo.id,
        uid: `viejo-extra-${index}`,
      });
      memoryFirestore.put(`ganadoresPremioEspecial/nuevo-${index}`, {
        minijuegoId: created.minijuegoId,
        premioId: especialNuevo?.id,
        uid: `nuevo-extra-${index}`,
      });
    }
    const otraVez = (await minijuegoService.updateMinijuegoBeneficio(
      created.id,
      payload(
        [
          puntos(10, 99.7, puntosPremio.id),
          especial(0.3, 300, { id: especialNuevo?.id, nombre: "Playera firmada" }),
        ],
        5,
      ),
    )) as unknown as AdminView;
    // 300 - (1 ganador real + 205 cargados) = 94.
    expect(otraVez.minijuego.premios.find((premio) => premio.especial)).toMatchObject({
      stock: 94,
      maxGanadores: 300,
    });
  });

  it("ganadores del especial: con especial vivo solo cuenta y lista los suyos, como su stock", async () => {
    const created = await create([puntos(10, 99.7), especial(0.3, 1)], 5);
    const [puntosPremio, especialViejo] = created.minijuego.premios;
    prizeRoll.mode = "last";
    seedUser("ganador-s1");
    expect((await play(created.minijuegoId, "ganador-s1")).prizeId).toBe(especialViejo.id);
    const ganadorS1 = { uid: "ganador-s1", nombre: null, email: "ganador-s1@socio.test", telefono: "4771000000" };
    expect(await minijuegoService.getGanadoresEspecial(created.minijuegoId)).toEqual({
      premio: "2 boletos León vs América",
      maxGanadores: 1,
      totalGanadores: 1,
      ganadores: [ganadorS1],
    });

    // Se guarda sin el especial (S1 queda archivado). Sin especial vivo se
    // conserva el comportamiento anterior: todos los ganadores del minijuego.
    await minijuegoService.updateMinijuegoBeneficio(
      created.id,
      payload([puntos(10, 100, puntosPremio.id)], 5),
    );
    expect(await minijuegoService.getGanadoresEspecial(created.minijuegoId)).toEqual({
      premio: "",
      maxGanadores: null,
      totalGanadores: 1,
      ganadores: [ganadorS1],
    });

    // Especial nuevo S2 con máximo 1: ni su stock ni su contador heredan al
    // ganador de S1 (antes el panel mostraba «1 / 1» y, al ganar S2, «2 / 1»).
    const conS2 = (await minijuegoService.updateMinijuegoBeneficio(
      created.id,
      payload(
        [puntos(10, 99.7, puntosPremio.id), especial(0.3, 1, { nombre: "Playera firmada" })],
        5,
      ),
    )) as unknown as AdminView;
    const especialNuevo = conS2.minijuego.premios.find((premio) => premio.especial);
    expect(especialNuevo).toMatchObject({ stock: 1, maxGanadores: 1 });
    expect(await minijuegoService.getGanadoresEspecial(created.minijuegoId)).toEqual({
      premio: "Playera firmada",
      maxGanadores: 1,
      totalGanadores: 0,
      ganadores: [],
    });

    seedUser("ganador-s2");
    expect((await play(created.minijuegoId, "ganador-s2")).prizeId).toBe(especialNuevo?.id);
    expect(await minijuegoService.getGanadoresEspecial(created.minijuegoId)).toEqual({
      premio: "Playera firmada",
      maxGanadores: 1,
      totalGanadores: 1,
      ganadores: [{ uid: "ganador-s2", nombre: null, email: "ganador-s2@socio.test", telefono: "4771000000" }],
    });
    expect(
      memoryFirestore.read(`minijuegos/${created.minijuegoId}/premios/${especialNuevo?.id}`)?.stock,
    ).toBe(0);

    // No se borra nada: el ganador de S1 sigue en Firestore.
    expect(
      memoryFirestore.list("ganadoresPremioEspecial").map((row) => row.premioId).sort(),
    ).toEqual([especialViejo.id, especialNuevo?.id].sort());
  });

  it("ganadores del especial: sin tope de 200 para el especial vivo y con el mismo conteo que su stock", async () => {
    const created = await create([puntos(10, 99.7), especial(0.3, 300)], 5);
    const [puntosPremio, especialVivo] = created.minijuego.premios;
    const base = Date.parse("2026-03-01T00:00:00.000Z");
    for (let index = 0; index < 205; index += 1) {
      const n = String(index).padStart(3, "0");
      // Mismo minijuego: ganadores del especial vivo y de uno reemplazado.
      memoryFirestore.put(`ganadoresPremioEspecial/g-${n}-vivo`, {
        minijuegoId: created.minijuegoId,
        premioId: especialVivo.id,
        uid: `vivo-${n}`,
        createdAt: Timestamp.fromMillis(base + index * 60_000),
      });
      memoryFirestore.put(`ganadoresPremioEspecial/g-${n}-viejo`, {
        minijuegoId: created.minijuegoId,
        premioId: "especial-reemplazado",
        uid: `viejo-${n}`,
        createdAt: Timestamp.fromMillis(base + index * 60_000 + 1),
      });
    }
    // Otro minijuego con el mismo premioId no cuenta.
    memoryFirestore.put("ganadoresPremioEspecial/otro-juego", {
      minijuegoId: "otro-minijuego",
      premioId: especialVivo.id,
      uid: "ajeno",
      createdAt: Timestamp.fromMillis(base),
    });

    const vista = await minijuegoService.getGanadoresEspecial(created.minijuegoId);
    expect(vista).toMatchObject({
      premio: "2 boletos León vs América",
      maxGanadores: 300,
      totalGanadores: 205,
    });
    expect(vista.ganadores).toHaveLength(205);
    expect(vista.ganadores.every((ganador) => ganador.uid.startsWith("vivo-"))).toBe(true);
    // Los más recientes primero, como antes.
    expect(vista.ganadores[0].uid).toBe("vivo-204");
    expect(vista.ganadores[204].uid).toBe("vivo-000");

    // Al editar, el stock descuenta exactamente esos 205: 400 - 205 = 195.
    const ampliado = (await minijuegoService.updateMinijuegoBeneficio(
      created.id,
      payload(
        [puntos(10, 99.7, puntosPremio.id), especial(0.3, 400, { id: especialVivo.id })],
        5,
      ),
    )) as unknown as AdminView;
    const guardado = ampliado.minijuego.premios.find((premio) => premio.especial);
    expect(guardado).toMatchObject({ id: especialVivo.id, stock: 195, maxGanadores: 400 });
    const despues = await minijuegoService.getGanadoresEspecial(created.minijuegoId);
    expect(despues).toMatchObject({ maxGanadores: 400, totalGanadores: 205 });
    expect((despues.maxGanadores ?? 0) - despues.totalGanadores).toBe(guardado?.stock);

    // Sin especial vivo se conserva el comportamiento anterior: todos los
    // ganadores del minijuego (de cualquier premio), con su tope de 200.
    await minijuegoService.updateMinijuegoBeneficio(
      created.id,
      payload([puntos(10, 100, puntosPremio.id)], 5),
    );
    const sinEspecial = await minijuegoService.getGanadoresEspecial(created.minijuegoId);
    expect(sinEspecial).toMatchObject({ premio: "", maxGanadores: null, totalGanadores: 200 });
    expect(sinEspecial.ganadores.some((ganador) => ganador.uid.startsWith("vivo-"))).toBe(true);
    expect(sinEspecial.ganadores.some((ganador) => ganador.uid.startsWith("viejo-"))).toBe(true);
    expect(sinEspecial.ganadores.some((ganador) => ganador.uid === "ajeno")).toBe(false);
    // No se borró ningún registro.
    expect(memoryFirestore.list("ganadoresPremioEspecial")).toHaveLength(411);
  });

  it("ganadores de un especial antiguo sin maxGanadores: máximo = stock + sus propios ganadores, como al guardar", async () => {
    const created = await create([puntos(10, 99.7), especial(0.3, 2)], 5);
    const [puntosPremio, especialPremio] = created.minijuego.premios;
    const premioPath = `minijuegos/${created.minijuegoId}/premios/${especialPremio.id}`;
    const legado = { ...memoryFirestore.read(premioPath) };
    delete legado.maxGanadores;
    memoryFirestore.put(premioPath, legado);
    memoryFirestore.put("ganadoresPremioEspecial/propio", {
      minijuegoId: created.minijuegoId,
      premioId: especialPremio.id,
      uid: "propio",
      email: "propio@socio.test",
      telefono: "4771000001",
      createdAt: Timestamp.now(),
    });
    memoryFirestore.put("ganadoresPremioEspecial/anterior", {
      minijuegoId: created.minijuegoId,
      premioId: "especial-anterior",
      uid: "anterior",
      createdAt: Timestamp.now(),
    });

    // Sin la corrección: 2 ganadores y máximo 2 + 2 = 4.
    expect(await minijuegoService.getGanadoresEspecial(created.minijuegoId)).toEqual({
      premio: "2 boletos León vs América",
      maxGanadores: 3,
      totalGanadores: 1,
      ganadores: [{ uid: "propio", nombre: null, email: "propio@socio.test", telefono: "4771000001" }],
    });

    // Guardar con el mismo número (el stock antiguo) fija ese mismo máximo.
    const guardado = (await minijuegoService.updateMinijuegoBeneficio(
      created.id,
      payload([puntos(10, 99.7, puntosPremio.id), especial(0.3, 2, { id: especialPremio.id })], 5),
    )) as unknown as AdminView;
    expect(guardado.minijuego.premios.find((premio) => premio.especial)).toMatchObject({
      stock: 2,
      maxGanadores: 3,
    });
    expect(await minijuegoService.getGanadoresEspecial(created.minijuegoId)).toMatchObject({
      maxGanadores: 3,
      totalGanadores: 1,
    });
  });
});
