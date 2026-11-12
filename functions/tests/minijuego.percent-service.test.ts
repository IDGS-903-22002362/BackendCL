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
import type { GuardarMinijuegoInput, PremioInput } from "../src/models/minijuego.model";
import loyaltyFeatureFlagsService from "../src/modules/loyalty/services/loyalty-feature-flags.service";
import beneficioService from "../src/services/beneficio.service";
import minijuegoService from "../src/services/minijuego.service";

jest.setTimeout(120_000);

type AdminView = {
  id: string;
  minijuegoId: string;
  minijuego: {
    probabilidadModo: "porcentaje" | "convertida";
    premios: Array<{ id: string; nombre: string; probabilidad: number; stock: number | null }>;
  };
};

type PlayResponse = { id: string; prizeId: string; alreadyPlayed: boolean };

function payload(premios: PremioInput[]): GuardarMinijuegoInput {
  return {
    beneficio: { titulo: "Ruleta León", descripcion: "Gira y gana", estatus: true },
    minijuego: {
      tipo: "ruleta",
      intentosPorUsuario: 1,
      audiencia: { visibilidad: "publico", usuariosPermitidos: [] },
    },
    premios,
  };
}

const PUNTOS: Array<[number, number]> = [
  [10, 30],
  [20, 25],
  [30, 15],
  [40, 10],
  [50, 7],
  [60, 5],
  [70, 3],
  [80, 2],
  [90, 1.5],
  [100, 1.2],
];

function ladder(specialStock = 1, specialProbabilidad = 0.3): PremioInput[] {
  return [
    ...PUNTOS.map(([valor, probabilidad]) => ({
      nombre: `${valor} puntos`,
      tipo: "points" as const,
      valor,
      probabilidad,
    })),
    {
      nombre: "2 boletos León vs América",
      tipo: "physical",
      stock: specialStock,
      maxGanadores: specialStock,
      especial: true,
      probabilidad: specialProbabilidad,
    },
  ];
}

function premiosGuardados(minijuegoId: string) {
  return memoryFirestore
    .list(`minijuegos/${minijuegoId}/premios`)
    .sort((a, b) => Number(a.orden) - Number(b.orden));
}

function seedUser(uid: string) {
  memoryFirestore.put(`usuariosApp/${uid}`, {
    email: `${uid}@socio.test`,
    telefono: "4771000000",
    puntosActuales: 0,
    createdAt: Timestamp.now(),
  });
}

async function adminView(beneficioId: string): Promise<AdminView> {
  const beneficio = await beneficioService.getBeneficioById(beneficioId);
  if (!beneficio) throw new Error("beneficio no encontrado");
  return (minijuegoService as unknown as {
    adminResponse: (b: unknown) => Promise<AdminView>;
  }).adminResponse(beneficio);
}

describe("12. crear y editar minijuegos con probabilidades porcentuales", () => {
  beforeAll(() => {
    if (!(firestoreApp as { __memory?: boolean }).__memory) {
      throw new Error("El mock de Firestore no está activo.");
    }
  });

  beforeEach(() => {
    memoryFirestore.reset();
    prizeRoll.reset();
    loyaltyFeatureFlagsService.clearCache();
  });

  it("crea un minijuego y guarda cada porcentaje con su equivalente en unidades", async () => {
    const created = (await minijuegoService.createMinijuegoBeneficio(
      payload(ladder()),
    )) as unknown as AdminView;

    const stored = premiosGuardados(created.minijuegoId);
    expect(stored.map((premio) => premio.probabilidad)).toEqual([
      ...PUNTOS.map(([, probabilidad]) => probabilidad),
      0.3,
    ]);
    expect(stored.map((premio) => premio.weight)).toEqual([
      30_000, 25_000, 15_000, 10_000, 7_000, 5_000, 3_000, 2_000, 1_500, 1_200, 300,
    ]);
    expect(created.minijuego.probabilidadModo).toBe("porcentaje");
    expect(created.minijuego.premios.at(-1)?.probabilidad).toBe(0.3);
  });

  it("no escribe nada si la suma no es 100 %", async () => {
    await expect(
      minijuegoService.createMinijuegoBeneficio(payload(ladder(1, 0.4))),
    ).rejects.toMatchObject({
      code: "MINIGAME_INVALID_PROBABILITY_TOTAL",
      message: "Probabilidad total: 100.1%. Excedes el límite por 0.1%.",
    });
    expect(memoryFirestore.list("beneficios")).toHaveLength(0);
    expect(memoryFirestore.list("minijuegos")).toHaveLength(0);
  });

  it("edita los porcentajes y rechaza una edición inválida sin tocar lo guardado", async () => {
    const created = (await minijuegoService.createMinijuegoBeneficio(
      payload(ladder()),
    )) as unknown as AdminView;
    const ids = created.minijuego.premios.map((premio) => premio.id);

    const edited = ladder();
    edited[0] = { ...edited[0], id: ids[0], probabilidad: 29.95 };
    edited[10] = { ...edited[10], id: ids[10], probabilidad: 0.35 };
    for (let index = 1; index < 10; index += 1) edited[index] = { ...edited[index], id: ids[index] };

    const updated = (await minijuegoService.updateMinijuegoBeneficio(
      created.id,
      payload(edited),
    )) as unknown as AdminView;
    expect(updated.minijuego.premios[0].probabilidad).toBe(29.95);
    expect(updated.minijuego.premios[10].probabilidad).toBe(0.35);
    expect(premiosGuardados(created.minijuegoId)[10]).toMatchObject({
      probabilidad: 0.35,
      weight: 350,
    });

    const invalid = edited.map((premio) => ({ ...premio }));
    invalid[0].probabilidad = 25;
    await expect(
      minijuegoService.updateMinijuegoBeneficio(created.id, payload(invalid)),
    ).rejects.toMatchObject({
      code: "MINIGAME_INVALID_PROBABILITY_TOTAL",
      message: "Probabilidad total: 95.05%. Falta asignar 4.95%.",
    });
    expect(premiosGuardados(created.minijuegoId)[0].probabilidad).toBe(29.95);
  });

  it("un minijuego antiguo se muestra convertido y pasa a porcentaje al guardarlo", async () => {
    const id = "antiguo";
    memoryFirestore.put(`beneficios/${id}`, {
      id,
      titulo: "Ruleta antigua",
      descripcion: "Con pesos",
      estatus: true,
      tipo: "minijuego",
      minijuegoId: id,
      minijuegoTipo: "ruleta",
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });
    memoryFirestore.put(`minijuegos/${id}`, {
      beneficioId: id,
      tipo: "ruleta",
      estatus: true,
      intentosPorUsuario: 1,
      audiencia: { visibilidad: "publico", usuariosPermitidos: [] },
    });
    const pesos = [1, 1, 1];
    pesos.forEach((weight, index) =>
      memoryFirestore.put(`minijuegos/${id}/premios/p${index}`, {
        minijuegoId: id,
        nombre: `${(index + 1) * 10} puntos`,
        tipo: "points",
        valor: (index + 1) * 10,
        stock: null,
        weight,
        orden: index,
      }),
    );

    const before = await adminView(id);
    expect(before.minijuego.probabilidadModo).toBe("convertida");
    expect(before.minijuego.premios.map((premio) => premio.probabilidad)).toEqual([
      33.334, 33.333, 33.333,
    ]);
    // Ver el minijuego no modifica Firestore.
    expect(premiosGuardados(id).map((premio) => premio.probabilidad)).toEqual([
      undefined,
      undefined,
      undefined,
    ]);

    const after = (await minijuegoService.updateMinijuegoBeneficio(
      id,
      payload(
        before.minijuego.premios.map((premio, index) => ({
          id: premio.id,
          nombre: premio.nombre,
          tipo: "points",
          valor: (index + 1) * 10,
          probabilidad: premio.probabilidad,
        })),
      ),
    )) as unknown as AdminView;
    expect(after.minijuego.probabilidadModo).toBe("porcentaje");
    expect(premiosGuardados(id).map((premio) => premio.weight)).toEqual([33_334, 33_333, 33_333]);
  });
});

describe("13. concurrencia e idempotencia con porcentajes", () => {
  beforeEach(() => {
    memoryFirestore.reset();
    prizeRoll.reset();
    loyaltyFeatureFlagsService.clearCache();
  });

  it("20 jugadas concurrentes entregan el especial de 0.3 % una sola vez con stock 1", async () => {
    const created = (await minijuegoService.createMinijuegoBeneficio(
      payload(ladder(1)),
    )) as unknown as AdminView;
    const especialId = created.minijuego.premios.at(-1)?.id;
    // "last" fuerza el último cursor: siempre cae en el especial mientras haya stock.
    prizeRoll.mode = "last";

    const uids = Array.from({ length: 20 }, (_, index) => `pct-race-${index}`);
    uids.forEach(seedUser);
    const results = (await Promise.all(
      uids.map((uid, index) =>
        minijuegoService.play(created.minijuegoId, { uid }, `pctrace${String(index).padStart(6, "0")}`),
      ),
    )) as PlayResponse[];

    expect(results.filter((result) => result.prizeId === especialId)).toHaveLength(1);
    expect(memoryFirestore.read(`minijuegos/${created.minijuegoId}/premios/${especialId}`)?.stock).toBe(0);
    expect(
      memoryFirestore
        .list("ganadoresPremioEspecial")
        .filter((winner) => winner.minijuegoId === created.minijuegoId),
    ).toHaveLength(1);
    // Los porcentajes configurados no cambiaron al agotarse el especial.
    expect(premiosGuardados(created.minijuegoId).at(-1)?.probabilidad).toBe(0.3);
  });

  it("la misma clave enviada 10 veces en paralelo crea una sola jugada", async () => {
    const created = (await minijuegoService.createMinijuegoBeneficio(
      payload(ladder(1)),
    )) as unknown as AdminView;
    prizeRoll.mode = "last";
    seedUser("pct-idem");

    const results = (await Promise.all(
      Array.from({ length: 10 }, () =>
        minijuegoService.play(created.minijuegoId, { uid: "pct-idem" }, "pctidempotente01"),
      ),
    )) as PlayResponse[];

    expect(new Set(results.map((result) => result.id)).size).toBe(1);
    expect(memoryFirestore.list("usuariosApp/pct-idem/minijuego_jugadas")).toHaveLength(1);
    expect(memoryFirestore.list("ganadoresPremioEspecial")).toHaveLength(1);
  });
});
