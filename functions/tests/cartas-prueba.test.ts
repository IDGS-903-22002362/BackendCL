import { Timestamp } from "firebase-admin/firestore";
import { memoryFirestore } from "./helpers/memory-firestore";

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

import express from "express";
import { getMisCartasPrueba } from "../src/controllers/minijuegos/cartas-prueba.controller";
import minijuegosRouter from "../src/routes/minijuegos.routes";
import { parseGrantTestCardArgs } from "../src/scripts/grant-test-prize-card.args";
import { errorHandler, notFoundHandler } from "../src/utils/error-handler";

// Same as the other route tests: supertest ships without type declarations here.
const request = require("supertest");
import cartasPruebaService, {
  CARTAS_PRUEBA_COLLECTION,
  cartaPruebaId,
  isTestCardsFirestore,
  testPrizeCardsEnabled,
} from "../src/services/cartas-prueba.service";
import minijuegoService from "../src/services/minijuego.service";

const TESTER = "uid-tester";
const LEGIT_WINNER = "uid-ganador-legitimo";
const GAME = "game-globo";
const PRIZE = "premio-globo";

const ENV_KEYS = [
  "TEST_PRIZE_CARDS",
  "FIRESTORE_EMULATOR_HOST",
  "APP_OFICIAL_PROJECT_ID",
] as const;
const savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

function seedBalloonWinner(): void {
  const createdAt = Timestamp.fromDate(new Date("2026-11-10T18:00:00.000Z"));
  memoryFirestore.put(`minijuegos/${GAME}`, {
    id: GAME,
    beneficioId: "beneficio-globo",
    tipo: "sobre",
  });
  memoryFirestore.put(`minijuegos/${GAME}/premios/${PRIZE}`, {
    id: PRIZE,
    minijuegoId: GAME,
    nombre: "VUELO EN GLOBO",
    tipo: "physical",
    stock: 0,
    maxGanadores: 1,
    especial: true,
  });
  memoryFirestore.put(`ganadoresPremioEspecial/play-legit`, {
    id: "play-legit",
    playId: "play-legit",
    minijuegoId: GAME,
    beneficioId: "beneficio-globo",
    beneficioTitulo: "Sobre sorpresa",
    uid: LEGIT_WINNER,
    email: "ganador@ejemplo.com",
    telefono: "4770000000",
    premioId: PRIZE,
    premioNombre: "VUELO EN GLOBO",
    createdAt,
    terminos: "Presenta tu folio.",
    validoDesde: createdAt,
    caducaEl: Timestamp.fromDate(new Date("2026-11-11T23:59:59.000Z")),
    premioImagenUrl: "https://example.com/globo.png",
  });
  memoryFirestore.put(`usuariosApp/${TESTER}`, {
    uid: TESTER,
    email: "tester@ejemplo.com",
    nombre: "Cuenta de prueba",
    puntosActuales: 120,
  });
  memoryFirestore.put(`usuariosApp/${LEGIT_WINNER}`, {
    uid: LEGIT_WINNER,
    email: "ganador@ejemplo.com",
    nombre: "Ganador",
    puntosActuales: 40,
  });
}

/** Everything a test card must never touch. */
function prizeState() {
  return JSON.stringify({
    winners: memoryFirestore.list("ganadoresPremioEspecial"),
    prize: memoryFirestore.read(`minijuegos/${GAME}/premios/${PRIZE}`),
    game: memoryFirestore.read(`minijuegos/${GAME}`),
    tester: memoryFirestore.read(`usuariosApp/${TESTER}`),
    testerPlays: memoryFirestore.list(`usuariosApp/${TESTER}/minijuego_jugadas`),
    testerPoints: memoryFirestore.list(`usuariosApp/${TESTER}/historialPuntos`),
    winner: memoryFirestore.read(`usuariosApp/${LEGIT_WINNER}`),
  });
}

const createMockResponse = () => {
  const res: Record<string, jest.Mock> = {
    status: jest.fn(),
    json: jest.fn(),
  };
  res.status.mockReturnValue(res);
  return res;
};

beforeEach(() => {
  memoryFirestore.reset();
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
  for (const key of ENV_KEYS) delete process.env[key];
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

describe("entorno de las cartas de prueba", () => {
  it("se apagan sin el flag, aun en el emulador", () => {
    expect(
      testPrizeCardsEnabled({ FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080" }),
    ).toBe(false);
  });

  it("se encienden con el flag contra el emulador", () => {
    expect(
      testPrizeCardsEnabled({
        TEST_PRIZE_CARDS: "true",
        FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080",
      }),
    ).toBe(true);
  });

  it("nunca se encienden contra Firestore de producción", () => {
    for (const project of [undefined, "app-oficial-leon", "e-comerce-leon"]) {
      expect(
        testPrizeCardsEnabled({
          TEST_PRIZE_CARDS: "true",
          ...(project ? { APP_OFICIAL_PROJECT_ID: project } : {}),
        }),
      ).toBe(false);
    }
  });

  it("se permiten en un proyecto propio no productivo", () => {
    expect(isTestCardsFirestore({ APP_OFICIAL_PROJECT_ID: "club-leon-staging" })).toBe(true);
    expect(
      testPrizeCardsEnabled({
        TEST_PRIZE_CARDS: "true",
        APP_OFICIAL_PROJECT_ID: "club-leon-staging",
      }),
    ).toBe(true);
  });
});

describe("asignación de cartas de prueba", () => {
  it("asigna la carta una sola vez aunque se pida dos veces", async () => {
    seedBalloonWinner();

    const first = await cartasPruebaService.grantCartaPrueba({
      uid: TESTER,
      diseno: "globo",
      now: new Date("2026-11-23T12:00:00.000Z"),
    });
    const second = await cartasPruebaService.grantCartaPrueba({
      uid: TESTER,
      diseno: "globo",
    });

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.carta).toEqual(first.carta);
    expect(first.carta).toEqual({
      id: cartaPruebaId(TESTER, "globo"),
      diseno: "globo",
      premioNombre: "VUELO EN GLOBO",
      asignadaEl: "2026-11-23T12:00:00.000Z",
    });
    expect(memoryFirestore.list(CARTAS_PRUEBA_COLLECTION)).toHaveLength(1);
    expect(await cartasPruebaService.listCartasPrueba(TESTER)).toHaveLength(1);
  });

  it("guarda el uid, nunca el correo", async () => {
    await cartasPruebaService.grantCartaPrueba({ uid: TESTER, diseno: "globo" });
    const stored = memoryFirestore.read(
      `${CARTAS_PRUEBA_COLLECTION}/${cartaPruebaId(TESTER, "globo")}`,
    );
    expect(stored?.uid).toBe(TESTER);
    expect(JSON.stringify(stored)).not.toContain("@");
  });

  it("no toca premios, ganadores, existencias, jugadas ni puntos", async () => {
    seedBalloonWinner();
    const before = prizeState();

    await cartasPruebaService.grantCartaPrueba({ uid: TESTER, diseno: "globo" });

    expect(prizeState()).toBe(before);
  });

  it("el ganador legítimo conserva su premio y la cuenta de prueba no recibe ninguno", async () => {
    seedBalloonWinner();
    await cartasPruebaService.grantCartaPrueba({ uid: TESTER, diseno: "globo" });

    const winnerPrizes = await minijuegoService.listMisBeneficios({ uid: LEGIT_WINNER });
    expect(winnerPrizes).toHaveLength(1);
    expect(winnerPrizes[0]).toMatchObject({
      playId: "play-legit",
      premioNombre: "VUELO EN GLOBO",
    });

    const testerPrizes = await minijuegoService.listMisBeneficios({ uid: TESTER });
    expect(testerPrizes).toEqual([]);
  });

  it("cada cuenta solo ve sus propias cartas de prueba", async () => {
    seedBalloonWinner();
    await cartasPruebaService.grantCartaPrueba({ uid: TESTER, diseno: "globo" });

    expect(await cartasPruebaService.listCartasPrueba(TESTER)).toHaveLength(1);
    expect(await cartasPruebaService.listCartasPrueba(LEGIT_WINNER)).toEqual([]);
    expect(await cartasPruebaService.listCartasPrueba("uid-otra")).toEqual([]);
  });

  it("retira la carta, y retirarla otra vez no falla", async () => {
    await cartasPruebaService.grantCartaPrueba({ uid: TESTER, diseno: "globo" });

    expect(
      await cartasPruebaService.revokeCartaPrueba({ uid: TESTER, diseno: "globo" }),
    ).toBe(true);
    expect(
      await cartasPruebaService.revokeCartaPrueba({ uid: TESTER, diseno: "globo" }),
    ).toBe(false);
    expect(await cartasPruebaService.listCartasPrueba(TESTER)).toEqual([]);
  });

  it("rechaza diseños desconocidos y cuentas vacías", async () => {
    await expect(
      cartasPruebaService.grantCartaPrueba({ uid: TESTER, diseno: "tesoro" }),
    ).rejects.toThrow("Diseño desconocido");
    await expect(
      cartasPruebaService.grantCartaPrueba({ uid: "  ", diseno: "globo" }),
    ).rejects.toThrow("Falta el uid");
    expect(memoryFirestore.list(CARTAS_PRUEBA_COLLECTION)).toEqual([]);
  });
});

describe("uid a partir del correo", () => {
  it("encuentra la cuenta sin importar mayúsculas ni espacios", async () => {
    seedBalloonWinner();
    expect(await cartasPruebaService.findUidByEmail("  Tester@Ejemplo.com ")).toBe(TESTER);
  });

  it("falla si no hay cuenta o si el correo es ambiguo", async () => {
    seedBalloonWinner();
    await expect(
      cartasPruebaService.findUidByEmail("nadie@ejemplo.com"),
    ).rejects.toThrow("No hay ninguna cuenta");

    memoryFirestore.put("usuariosApp/uid-duplicada", {
      uid: "uid-duplicada",
      email: "tester@ejemplo.com",
    });
    await expect(
      cartasPruebaService.findUidByEmail("tester@ejemplo.com"),
    ).rejects.toThrow("más de una cuenta");
  });
});

describe("GET /api/minijuegos/me/cartas-prueba", () => {
  function request(uid: string, extra: Record<string, unknown> = {}) {
    return {
      user: { uid },
      query: {},
      body: {},
      params: {},
      ...extra,
    } as unknown as Parameters<typeof getMisCartasPrueba>[0];
  }

  it("responde 404 fuera de un entorno de pruebas", async () => {
    await cartasPruebaService.grantCartaPrueba({ uid: TESTER, diseno: "globo" });
    process.env.TEST_PRIZE_CARDS = "true";
    process.env.APP_OFICIAL_PROJECT_ID = "app-oficial-leon";

    const res = createMockResponse();
    await getMisCartasPrueba(request(TESTER), res as never);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("devuelve solo las cartas de la cuenta del token", async () => {
    await cartasPruebaService.grantCartaPrueba({ uid: TESTER, diseno: "globo" });
    process.env.TEST_PRIZE_CARDS = "true";
    process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";

    const mine = createMockResponse();
    await getMisCartasPrueba(request(TESTER), mine as never);
    expect(mine.status).toHaveBeenCalledWith(200);
    expect(mine.json.mock.calls[0][0]).toMatchObject({
      success: true,
      count: 1,
      data: [{ diseno: "globo", premioNombre: "VUELO EN GLOBO" }],
    });

    // Nothing in the request can ask for someone else's cards.
    const other = createMockResponse();
    await getMisCartasPrueba(
      request("uid-otra", { query: { uid: TESTER }, body: { uid: TESTER } }),
      other as never,
    );
    expect(other.json.mock.calls[0][0]).toMatchObject({ count: 0, data: [] });
  });
});

describe("ruta /me/cartas-prueba montada en el router", () => {
  function app() {
    const server = express();
    server.use("/api/minijuegos", minijuegosRouter);
    server.use(notFoundHandler);
    server.use(errorHandler);
    return server;
  }

  it("apagada, responde igual que una ruta que no existe, sin pedir token", async () => {
    process.env.TEST_PRIZE_CARDS = "true";
    process.env.APP_OFICIAL_PROJECT_ID = "app-oficial-leon";
    delete process.env.FIRESTORE_EMULATOR_HOST;

    const hidden = await request(app()).get("/api/minijuegos/me/cartas-prueba");
    const missing = await request(app()).get("/api/minijuegos/me/no-existe");

    expect(hidden.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(hidden.body.code).toBe("NOT_FOUND");
    expect(hidden.body.message).toBe(missing.body.message);
  });

  it("encendida, exige el token de la cuenta", async () => {
    process.env.TEST_PRIZE_CARDS = "true";
    process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";

    const res = await request(app()).get("/api/minijuegos/me/cartas-prueba");

    expect(res.status).toBe(401);
  });
});

describe("argumentos del script de asignación", () => {
  it("lee la cuenta, el diseño y las acciones", () => {
    expect(parseGrantTestCardArgs(["--uid", " uid-1 ", "--list"])).toEqual({
      uid: "uid-1",
      diseno: "globo",
      revoke: false,
      list: true,
    });
    expect(
      parseGrantTestCardArgs(["--email", "a@b.mx", "--diseno", "globo", "--revoke"]),
    ).toMatchObject({ email: "a@b.mx", diseno: "globo", revoke: true });
  });

  it("no toma otra opción como valor", () => {
    expect(() => parseGrantTestCardArgs(["--uid", "--list"])).toThrow(
      "Falta el valor de --uid",
    );
    expect(() => parseGrantTestCardArgs(["--uid", "--revoke"])).toThrow(
      "Falta el valor de --uid",
    );
    expect(() => parseGrantTestCardArgs(["--email"])).toThrow(
      "Falta el valor de --email",
    );
  });

  it("rechaza una cuenta en blanco y las opciones desconocidas", () => {
    expect(() => parseGrantTestCardArgs(["--uid", "   "])).toThrow(
      "Falta el valor de --uid",
    );
    expect(() => parseGrantTestCardArgs(["--list"])).toThrow(
      "Indica la cuenta con --email o --uid.",
    );
    expect(() => parseGrantTestCardArgs(["--uid", "u", "--todo"])).toThrow(
      "Opción desconocida: --todo",
    );
  });
});
