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
import type { GuardarMinijuegoInput } from "../src/models/minijuego.model";
import { nombreDeUsuario, toSpecialWinnersView } from "../src/services/minijuego.logic";
import minijuegoService from "../src/services/minijuego.service";

jest.setTimeout(120_000);

type AdminView = {
  id: string;
  minijuegoId: string;
  minijuego: { premios: Array<{ id: string; especial?: boolean }> };
};

type Juego = { minijuegoId: string; especialId: string };

type Ganador = { uid: string; nombre: string | null; email: string; telefono: string };

const PREMIO_ESPECIAL = "2 boletos León vs América";
const BASE = Date.parse("2026-11-01T12:00:00.000Z");

function payload(maxGanadores: number): GuardarMinijuegoInput {
  return {
    beneficio: { titulo: "Ruleta con especial", descripcion: "Gira y gana", estatus: true },
    minijuego: {
      tipo: "ruleta",
      intentosPorUsuario: 5,
      audiencia: { visibilidad: "publico", usuariosPermitidos: [] },
    },
    premios: [
      { nombre: "10 puntos", tipo: "points", valor: 10, probabilidad: 99.7 },
      {
        nombre: PREMIO_ESPECIAL,
        tipo: "physical",
        stock: maxGanadores,
        maxGanadores,
        especial: true,
        probabilidad: 0.3,
      },
    ],
  };
}

/** Minijuego con un premio de puntos y el especial vivo (el último). */
async function juegoConEspecial(maxGanadores = 3): Promise<Juego> {
  const created = (await minijuegoService.createMinijuegoBeneficio(
    payload(maxGanadores),
  )) as unknown as AdminView;
  const especialId = created.minijuego.premios.find((premio) => premio.especial)?.id ?? "";
  expect(especialId).not.toBe("");
  return { minijuegoId: created.minijuegoId, especialId };
}

function perfil(uid: string, extra: Record<string, unknown> = {}) {
  memoryFirestore.put(`usuariosApp/${uid}`, {
    email: `${uid}@socio.test`,
    telefono: "4771000000",
    ...extra,
  });
}

/** Registro de ganador como lo guarda play: uid, correo y teléfono, sin nombre. */
function registro(juego: Juego, row: { id: string; uid: string; minuto: number }) {
  memoryFirestore.put(`ganadoresPremioEspecial/${row.id}`, {
    id: row.id,
    playId: row.id,
    minijuegoId: juego.minijuegoId,
    premioId: juego.especialId,
    premioNombre: PREMIO_ESPECIAL,
    uid: row.uid,
    email: `${row.id}@ganador.test`,
    telefono: `477200${String(row.minuto).padStart(4, "0")}`,
    createdAt: Timestamp.fromMillis(BASE + row.minuto * 60_000),
  });
}

/** 150 ganadores distintos con nombre «Socio NNN» (los más recientes primero). */
async function cientoCincuentaGanadores(): Promise<Juego> {
  const juego = await juegoConEspecial(300);
  for (let index = 0; index < 150; index += 1) {
    const n = String(index).padStart(3, "0");
    perfil(`socio-${n}`, { nombre: `Socio ${n}` });
    registro(juego, { id: `g-${n}`, uid: `socio-${n}`, minuto: index });
  }
  return juego;
}

function nombreEsperado(ganador: Ganador): string {
  return `Socio ${ganador.uid.slice("socio-".length)}`;
}

function contacto(ganadores: Ganador[]) {
  return ganadores.map((ganador) => ({
    uid: ganador.uid,
    email: ganador.email,
    telefono: ganador.telefono,
  }));
}

function rutas(refs: unknown[]): string[] {
  return refs.map((ref) => (ref as { path: string }).path);
}

describe("nombreDeUsuario", () => {
  it("devuelve el campo nombre del perfil, recortado", () => {
    expect(nombreDeUsuario({ nombre: "Cristian Perez" })).toBe("Cristian Perez");
    expect(nombreDeUsuario({ nombre: "  Cristian Perez \n\t" })).toBe("Cristian Perez");
    expect(nombreDeUsuario({ nombre: " Ana  María ", email: "ana@socio.test" })).toBe("Ana  María");
  });

  it.each<[string, unknown]>([
    ["sin perfil (undefined)", undefined],
    ["perfil null", null],
    ["un texto suelto", "Cristian Perez"],
    ["un número", 7],
    ["un arreglo", ["Cristian Perez"]],
    ["un perfil sin campo nombre", { email: "socio@socio.test" }],
    ["un nombre vacío", { nombre: "" }],
    ["un nombre con solo espacios", { nombre: "  \n\t " }],
    ["un nombre numérico", { nombre: 42 }],
    ["un nombre null", { nombre: null }],
    ["un nombre objeto", { nombre: { completo: "Cristian Perez" } }],
    ["un nombre arreglo", { nombre: ["Cristian", "Perez"] }],
  ])("devuelve null con %s", (_caso, data) => {
    expect(nombreDeUsuario(data)).toBeNull();
  });
});

describe("toSpecialWinnersView con nombre", () => {
  it("devuelve uid, nombre, correo y teléfono en ese orden, con null si no hay nombre", () => {
    const vista = toSpecialWinnersView({
      premio: "Playera firmada",
      maxGanadores: 2,
      ganadores: [
        { uid: "u1", nombre: "Cristian Perez", email: "u1@socio.test", telefono: "4771234567" },
        { uid: "u2", email: "u2@socio.test", telefono: "" },
        { uid: "u3", nombre: null, email: "", telefono: "4777654321" },
      ],
    });

    expect(vista).toEqual({
      premio: "Playera firmada",
      maxGanadores: 2,
      totalGanadores: 3,
      ganadores: [
        { uid: "u1", nombre: "Cristian Perez", email: "u1@socio.test", telefono: "4771234567" },
        { uid: "u2", nombre: null, email: "u2@socio.test", telefono: "" },
        { uid: "u3", nombre: null, email: "", telefono: "4777654321" },
      ],
    });
    expect(Object.keys(vista.ganadores[0])).toEqual(["uid", "nombre", "email", "telefono"]);
    expect(Object.keys(vista.ganadores[1])).toEqual(["uid", "nombre", "email", "telefono"]);
  });
});

describe("ganadores del especial: nombre leído de usuariosApp", () => {
  beforeAll(() => {
    if (!(firestoreApp as { __memory?: boolean }).__memory) {
      throw new Error("El mock de Firestore no está activo.");
    }
  });

  beforeEach(() => {
    memoryFirestore.reset();
    prizeRoll.reset();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("devuelve el nombre del perfil del ganador (el registro no lo guarda)", async () => {
    const juego = await juegoConEspecial(2);
    perfil("socio-cristian", { nombre: "Cristian Perez" });
    prizeRoll.mode = "last";
    const ganado = await minijuegoService.play(
      juego.minijuegoId,
      { uid: "socio-cristian" },
      "nombre00000001",
    );
    expect(ganado.prizeId).toBe(juego.especialId);

    const vista = await minijuegoService.getGanadoresEspecial(juego.minijuegoId);
    expect(vista.ganadores).toEqual([
      {
        uid: "socio-cristian",
        nombre: "Cristian Perez",
        email: "socio-cristian@socio.test",
        telefono: "4771000000",
      },
    ]);
    const registros = memoryFirestore.list("ganadoresPremioEspecial");
    expect(registros).toHaveLength(1);
    expect(registros[0]).not.toHaveProperty("nombre");
  });

  it("recorta los espacios del nombre sin tocar el perfil", async () => {
    const juego = await juegoConEspecial();
    perfil("socio-espacios", { nombre: "   Cristian Perez \t\n" });
    registro(juego, { id: "g-1", uid: "socio-espacios", minuto: 1 });

    const vista = await minijuegoService.getGanadoresEspecial(juego.minijuegoId);
    expect(vista.ganadores.map((ganador) => ganador.nombre)).toEqual(["Cristian Perez"]);
    expect(memoryFirestore.read("usuariosApp/socio-espacios")?.nombre).toBe("   Cristian Perez \t\n");
  });

  it("un perfil sin nombre, con nombre vacío o que no es texto da nombre null sin afectar a los demás", async () => {
    const juego = await juegoConEspecial(10);
    const perfiles: Array<[string, Record<string, unknown>]> = [
      ["sin-campo", {}],
      ["vacio", { nombre: "" }],
      ["espacios", { nombre: "   " }],
      ["numero", { nombre: 42 }],
      ["nulo", { nombre: null }],
      ["objeto", { nombre: { completo: "Cristian Perez" } }],
      ["arreglo", { nombre: ["Cristian", "Perez"] }],
    ];
    perfiles.forEach(([uid, extra], index) => {
      perfil(uid, extra);
      registro(juego, { id: `g-${uid}`, uid, minuto: index + 1 });
    });
    // El registro más antiguo: su perfil se lee al final, después de los
    // inválidos, y solo conserva su nombre si ninguno de ellos hizo fallar el lote.
    perfil("valido", { nombre: "Cristian Perez" });
    registro(juego, { id: "g-valido", uid: "valido", minuto: 0 });
    const warn = jest.spyOn(console, "warn");

    const vista = await minijuegoService.getGanadoresEspecial(juego.minijuegoId);
    expect(vista.totalGanadores).toBe(perfiles.length + 1);
    expect(vista.ganadores.map((ganador) => [ganador.uid, ganador.nombre])).toEqual([
      ...perfiles.map(([uid]) => [uid, null]).reverse(),
      ["valido", "Cristian Perez"],
    ]);
    // Cada perfil da null por sí mismo: la lectura de nombres no cayó en el catch.
    expect(warn).not.toHaveBeenCalled();
  });

  it("si el usuario ya no existe, su nombre es null y el resto del listado queda intacto", async () => {
    const juego = await juegoConEspecial();
    perfil("socio-activo", { nombre: "Cristian Perez" });
    registro(juego, { id: "g-activo", uid: "socio-activo", minuto: 1 });
    // Sin documento en usuariosApp (cuenta eliminada).
    registro(juego, { id: "g-borrado", uid: "socio-borrado", minuto: 2 });

    const vista = await minijuegoService.getGanadoresEspecial(juego.minijuegoId);
    expect(vista).toEqual({
      premio: PREMIO_ESPECIAL,
      maxGanadores: 3,
      totalGanadores: 2,
      ganadores: [
        { uid: "socio-borrado", nombre: null, email: "g-borrado@ganador.test", telefono: "4772000002" },
        { uid: "socio-activo", nombre: "Cristian Perez", email: "g-activo@ganador.test", telefono: "4772000001" },
      ],
    });
    expect(memoryFirestore.read("usuariosApp/socio-borrado")).toBeNull();
  });

  it("un registro sin uid queda con nombre null y no se consulta usuariosApp", async () => {
    const juego = await juegoConEspecial();
    registro(juego, { id: "g-sin-uid", uid: "", minuto: 1 });
    const getAll = jest.spyOn(firestoreApp, "getAll");

    const vista = await minijuegoService.getGanadoresEspecial(juego.minijuegoId);
    expect(vista.ganadores).toEqual([
      { uid: "", nombre: null, email: "g-sin-uid@ganador.test", telefono: "4772000001" },
    ]);
    expect(getAll).not.toHaveBeenCalled();
  });

  it("el mismo uid en dos registros: ambos con su nombre y una sola lectura por uid", async () => {
    const juego = await juegoConEspecial();
    perfil("socio-repetido", { nombre: "Ana López" });
    perfil("socio-otro", { nombre: "Beto Ruiz" });
    registro(juego, { id: "g-1", uid: "socio-repetido", minuto: 1 });
    registro(juego, { id: "g-2", uid: "socio-otro", minuto: 2 });
    registro(juego, { id: "g-3", uid: "socio-repetido", minuto: 3 });
    const getAll = jest.spyOn(firestoreApp, "getAll");

    const vista = await minijuegoService.getGanadoresEspecial(juego.minijuegoId);
    expect(vista.ganadores.map((ganador) => [ganador.uid, ganador.nombre])).toEqual([
      ["socio-repetido", "Ana López"],
      ["socio-otro", "Beto Ruiz"],
      ["socio-repetido", "Ana López"],
    ]);
    expect(getAll).toHaveBeenCalledTimes(1);
    const leidas = rutas(getAll.mock.calls[0]);
    expect(leidas).toHaveLength(2);
    expect([...leidas].sort()).toEqual(["usuariosApp/socio-otro", "usuariosApp/socio-repetido"]);
  });

  it.each<[string, () => unknown]>([
    ["rechaza la promesa", () => Promise.reject(new Error("14 UNAVAILABLE: sin conexión"))],
    [
      "lanza al llamarse",
      () => {
        throw new Error("14 UNAVAILABLE: sin conexión");
      },
    ],
  ])("si getAll %s, el listado se devuelve con nombre null y no lanza", async (_caso, falla) => {
    const juego = await juegoConEspecial();
    perfil("socio-a", { nombre: "Cristian Perez" });
    perfil("socio-b", { nombre: "Ana López" });
    registro(juego, { id: "g-a", uid: "socio-a", minuto: 1 });
    registro(juego, { id: "g-b", uid: "socio-b", minuto: 2 });
    const conNombres = await minijuegoService.getGanadoresEspecial(juego.minijuegoId);
    expect(conNombres.ganadores.map((ganador) => ganador.nombre)).toEqual(["Ana López", "Cristian Perez"]);

    jest
      .spyOn(firestoreApp, "getAll")
      .mockImplementation(falla as unknown as typeof firestoreApp.getAll);
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);

    const vista = await minijuegoService.getGanadoresEspecial(juego.minijuegoId);
    expect(vista.ganadores.map((ganador) => ganador.nombre)).toEqual([null, null]);
    expect(contacto(vista.ganadores)).toEqual(contacto(conNombres.ganadores));
    expect(vista).toMatchObject({
      premio: conNombres.premio,
      maxGanadores: conNombres.maxGanadores,
      totalGanadores: conNombres.totalGanadores,
    });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith("ganadores_especial_nombres_error", {
      usuarios: 2,
      error: "14 UNAVAILABLE: sin conexión",
    });
    // El log no lleva datos personales.
    const log = JSON.stringify(warn.mock.calls);
    for (const dato of ["socio-a", "socio-b", "@ganador.test", "4772000001", "Cristian", "Ana López"]) {
      expect(log).not.toContain(dato);
    }
  });

  it("lee usuariosApp en lotes de 100, una vez por uid", async () => {
    const juego = await cientoCincuentaGanadores();
    const getAll = jest.spyOn(firestoreApp, "getAll");

    const vista = await minijuegoService.getGanadoresEspecial(juego.minijuegoId);
    const lotes = getAll.mock.calls.map((refs) => rutas(refs));
    expect(lotes.map((lote) => lote.length)).toEqual([100, 50]);
    expect(new Set(([] as string[]).concat(...lotes)).size).toBe(150);
    expect(vista.totalGanadores).toBe(150);
    expect(vista.ganadores.every((ganador) => ganador.nombre === nombreEsperado(ganador))).toBe(true);
  });

  it("si falla un lote, conserva los nombres ya leídos y los demás quedan en null", async () => {
    const juego = await cientoCincuentaGanadores();
    const realGetAll = firestoreApp.getAll.bind(firestoreApp) as unknown as (
      ...refs: unknown[]
    ) => Promise<unknown>;
    let lotes = 0;
    jest.spyOn(firestoreApp, "getAll").mockImplementation(((...refs: unknown[]) => {
      lotes += 1;
      return lotes === 2 ? Promise.reject(new Error("4 DEADLINE_EXCEEDED")) : realGetAll(...refs);
    }) as unknown as typeof firestoreApp.getAll);
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);

    const vista = await minijuegoService.getGanadoresEspecial(juego.minijuegoId);
    expect(lotes).toBe(2);
    expect(vista.totalGanadores).toBe(150);
    // Primer lote: los 100 más recientes conservan su nombre.
    expect(vista.ganadores.slice(0, 100).every((ganador) => ganador.nombre === nombreEsperado(ganador))).toBe(true);
    expect(vista.ganadores.slice(100).every((ganador) => ganador.nombre === null)).toBe(true);
    expect(warn).toHaveBeenCalledWith("ganadores_especial_nombres_error", {
      usuarios: 150,
      error: "4 DEADLINE_EXCEEDED",
    });
  });

  it("uid, correo, teléfono, orden, totalGanadores y maxGanadores no cambian", async () => {
    const juego = await juegoConEspecial(3);
    // El perfil cambió después de ganar: correo y teléfono siguen saliendo del
    // registro del ganador; solo el nombre se lee del perfil.
    perfil("socio-a", { nombre: "Alberto Díaz", email: "nuevo-a@socio.test", telefono: "4779999999" });
    perfil("socio-b", { nombre: "Beatriz Ruiz" });
    registro(juego, { id: "g-a", uid: "socio-a", minuto: 1 });
    registro(juego, { id: "g-b", uid: "socio-b", minuto: 2 });

    const vista = await minijuegoService.getGanadoresEspecial(juego.minijuegoId);
    expect(vista).toEqual({
      premio: PREMIO_ESPECIAL,
      maxGanadores: 3,
      totalGanadores: 2,
      ganadores: [
        { uid: "socio-b", nombre: "Beatriz Ruiz", email: "g-b@ganador.test", telefono: "4772000002" },
        { uid: "socio-a", nombre: "Alberto Díaz", email: "g-a@ganador.test", telefono: "4772000001" },
      ],
    });
    expect(Object.keys(vista)).toEqual(["premio", "maxGanadores", "totalGanadores", "ganadores"]);
    expect(Object.keys(vista.ganadores[0])).toEqual(["uid", "nombre", "email", "telefono"]);
  });

  it("no escribe nada en ganadoresPremioEspecial ni en usuariosApp", async () => {
    const juego = await juegoConEspecial();
    perfil("socio-a", { nombre: "  Cristian Perez  " });
    perfil("socio-sin-nombre");
    registro(juego, { id: "g-a", uid: "socio-a", minuto: 1 });
    registro(juego, { id: "g-b", uid: "socio-sin-nombre", minuto: 2 });
    registro(juego, { id: "g-c", uid: "socio-borrado", minuto: 3 });
    const estado = () =>
      JSON.stringify({
        ganadores: memoryFirestore.list("ganadoresPremioEspecial"),
        usuarios: memoryFirestore.list("usuariosApp"),
      });
    const antes = estado();

    const primera = await minijuegoService.getGanadoresEspecial(juego.minijuegoId);
    const segunda = await minijuegoService.getGanadoresEspecial(juego.minijuegoId);

    expect(primera.ganadores.map((ganador) => ganador.nombre)).toEqual([null, null, "Cristian Perez"]);
    expect(segunda).toEqual(primera);
    expect(estado()).toBe(antes);
    expect(memoryFirestore.read("usuariosApp/socio-borrado")).toBeNull();
    expect(memoryFirestore.list("ganadoresPremioEspecial").some((row) => "nombre" in row)).toBe(false);
  });
});
