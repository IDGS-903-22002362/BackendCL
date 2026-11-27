import { Timestamp } from "firebase-admin/firestore";
import { memoryFirestore } from "./helpers/memory-firestore";
import { MEMORY_BUCKET_NAME, memoryBucket } from "./helpers/memory-storage";
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
  const { memoryStorage } =
    require("./helpers/memory-storage") as typeof import("./helpers/memory-storage");
  return {
    firestoreApp: store.api,
    appOficial: {},
    storageAppOficial: memoryStorage,
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

import { guardarMinijuegoSchema } from "../src/middleware/validators/minijuego.validator";
import type { GuardarMinijuegoInput, PremioInput } from "../src/models/minijuego.model";
import loyaltyFeatureFlagsService from "../src/modules/loyalty/services/loyalty-feature-flags.service";
import { prepareMinijuegoWrite, resolveCartaImagenUrl } from "../src/services/minijuego.logic";
import minijuegoService from "../src/services/minijuego.service";

jest.setTimeout(120_000);

const UUID_A = "0b6e4c1e-8f7a-4c2d-9b3e-1a2b3c4d5e6f";
const UUID_B = "5f0c7b9a-2d4e-4f61-8a73-9c0d1e2f3a4b";
const UUID_C = "d2a1c3b4-e5f6-4a7b-b8c9-d0e1f2a3b4c5";

function cartaPath(uuid: string): string {
  return `minijuegos/cartas/${uuid}.webp`;
}

function cartaUrl(uuid: string, base = "https://storage.googleapis.com"): string {
  return `${base}/${MEMORY_BUCKET_NAME}/${cartaPath(uuid)}`;
}

/** Simula que la imagen ya se subió con el endpoint. */
function subida(uuid: string): string {
  memoryBucket.put(cartaPath(uuid));
  return cartaUrl(uuid);
}

type AdminPremio = {
  id: string;
  nombre: string;
  especial?: boolean;
  cartaImagenUrl?: string;
};

type AdminView = {
  id: string;
  minijuegoId: string;
  minijuego: { premios: AdminPremio[] };
};

type PlayResponse = {
  id: string;
  prizeId: string;
  alreadyPlayed: boolean;
  cartaImagenUrl?: string | null;
  cartaDiseno?: string | null;
};

const ENV_KEYS = [
  "IS_LOCAL",
  "FIREBASE_STORAGE_EMULATOR_HOST",
  "STORAGE_EMULATOR_HOST",
  "FUNCTION_NAME",
  "K_SERVICE",
] as const;
const savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

function payload(premios: PremioInput[], intentos = 1): GuardarMinijuegoInput {
  return {
    beneficio: { titulo: "Sobre sorpresa", descripcion: "Abre y gana", estatus: true },
    minijuego: {
      tipo: "sobre",
      intentosPorUsuario: intentos,
      audiencia: { visibilidad: "publico", usuariosPermitidos: [] },
    },
    premios,
  };
}

function puntos(id?: string): PremioInput {
  return {
    ...(id ? { id } : {}),
    nombre: "10 puntos",
    tipo: "points",
    valor: 10,
    probabilidad: 99.7,
  };
}

function especial(extra: Partial<PremioInput> = {}): PremioInput {
  return {
    nombre: "VUELO EN GLOBO",
    tipo: "physical",
    stock: 3,
    maxGanadores: 3,
    especial: true,
    probabilidad: 0.3,
    terminos: "Presenta tu folio.",
    ...extra,
  };
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
function nextKey(): string {
  keySequence += 1;
  return `carta${String(keySequence).padStart(8, "0")}`;
}

async function create(premios: PremioInput[], intentos = 1): Promise<AdminView> {
  return (await minijuegoService.createMinijuegoBeneficio(
    payload(premios, intentos),
  )) as unknown as AdminView;
}

async function update(
  view: AdminView,
  premios: PremioInput[],
  intentos = 1,
): Promise<AdminView> {
  return (await minijuegoService.updateMinijuegoBeneficio(
    view.id,
    payload(premios, intentos),
    { uid: "staff-uid" },
  )) as unknown as AdminView;
}

function storedEspecial(view: AdminView) {
  const id = view.minijuego.premios.find((premio) => premio.especial)?.id;
  return memoryFirestore.read(`minijuegos/${view.minijuegoId}/premios/${id}`);
}

function ids(view: AdminView) {
  const puntosId = view.minijuego.premios.find((premio) => !premio.especial)?.id ?? "";
  const especialId = view.minijuego.premios.find((premio) => premio.especial)?.id ?? "";
  return { puntosId, especialId };
}

beforeEach(() => {
  keySequence = 0;
  memoryFirestore.reset();
  memoryBucket.reset();
  prizeRoll.reset();
  loyaltyFeatureFlagsService.clearCache();
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

describe("cartaImagenUrl: validación del payload", () => {
  it("zod la acepta en el especial (string, null u omitida) y la rechaza en otros premios", () => {
    for (const cartaImagenUrl of [cartaUrl(UUID_A), null, "", undefined]) {
      const body = payload([puntos(), especial({ cartaImagenUrl })]);
      expect(guardarMinijuegoSchema.safeParse(body).success).toBe(true);
    }

    const ajeno = guardarMinijuegoSchema.safeParse(
      payload([{ ...puntos(), cartaImagenUrl: cartaUrl(UUID_A) }, especial()]),
    );
    expect(ajeno.success).toBe(false);
    if (!ajeno.success) {
      expect(ajeno.error.issues[0]).toMatchObject({
        path: ["premios", 0, "cartaImagenUrl"],
        message: "Solo el premio especial puede tener carta coleccionable.",
      });
    }
    // null en un premio que no es especial no es error: equivale a sin carta.
    expect(
      guardarMinijuegoSchema.safeParse(
        payload([{ ...puntos(), cartaImagenUrl: null }, especial()]),
      ).success,
    ).toBe(true);
    expect(
      guardarMinijuegoSchema.safeParse(
        payload([puntos(), especial({ cartaImagenUrl: "x".repeat(2049) })]),
      ).success,
    ).toBe(false);
  });

  it("la lógica conserva los tres estados y rechaza la carta fuera del especial", () => {
    const sinClave = prepareMinijuegoWrite(payload([puntos(), especial()]));
    expect(sinClave.premios[1]).not.toHaveProperty("cartaImagenUrl");

    const quitar = prepareMinijuegoWrite(payload([puntos(), especial({ cartaImagenUrl: null })]));
    expect(quitar.premios[1].cartaImagenUrl).toBeNull();
    const vacia = prepareMinijuegoWrite(payload([puntos(), especial({ cartaImagenUrl: "  " })]));
    expect(vacia.premios[1].cartaImagenUrl).toBeNull();

    const nueva = prepareMinijuegoWrite(
      payload([puntos(), especial({ cartaImagenUrl: ` ${cartaUrl(UUID_A)} ` })]),
    );
    expect(nueva.premios[1].cartaImagenUrl).toBe(cartaUrl(UUID_A));

    expect(() =>
      prepareMinijuegoWrite(
        payload([{ ...puntos(), cartaImagenUrl: cartaUrl(UUID_A) }, especial()]),
      ),
    ).toThrow(
      expect.objectContaining({
        code: "MINIGAME_INVALID_PRIZE",
        status: 400,
        message: "Solo el premio especial puede tener carta coleccionable.",
      }),
    );
  });

  it("resolveCartaImagenUrl: ausente conserva la del mismo especial; null y '' la quitan", () => {
    const previous = { especial: true, cartaImagenUrl: cartaUrl(UUID_A) };
    expect(resolveCartaImagenUrl({ especial: true, requested: undefined, previous })).toBe(
      cartaUrl(UUID_A),
    );
    expect(resolveCartaImagenUrl({ especial: true, requested: null, previous })).toBeUndefined();
    expect(resolveCartaImagenUrl({ especial: true, requested: "", previous })).toBeUndefined();
    expect(
      resolveCartaImagenUrl({ especial: true, requested: cartaUrl(UUID_B), previous }),
    ).toBe(cartaUrl(UUID_B));
    // Solo se conserva si el anterior también era especial; nunca fuera del especial.
    expect(
      resolveCartaImagenUrl({
        especial: true,
        requested: undefined,
        previous: { especial: false, cartaImagenUrl: cartaUrl(UUID_A) },
      }),
    ).toBeUndefined();
    expect(
      resolveCartaImagenUrl({ especial: false, requested: undefined, previous }),
    ).toBeUndefined();
    expect(resolveCartaImagenUrl({ especial: true, requested: undefined })).toBeUndefined();
  });
});

describe("cartaImagenUrl: crear y editar el minijuego", () => {
  it("crea el especial con su carta y el panel la recibe", async () => {
    const url = subida(UUID_A);
    const created = await create([puntos(), especial({ cartaImagenUrl: url })]);

    expect(storedEspecial(created)?.cartaImagenUrl).toBe(url);
    expect(created.minijuego.premios.find((premio) => premio.especial)?.cartaImagenUrl).toBe(url);
    expect(created.minijuego.premios.find((premio) => !premio.especial)).not.toHaveProperty(
      "cartaImagenUrl",
    );
  });

  it("rechaza con 400 una URL ajena, con query o de otro bucket, sin escribir nada", async () => {
    subida(UUID_A);
    const invalidas = [
      "https://example.com/carta.webp",
      `${cartaUrl(UUID_A)}?alt=media`,
      `https://storage.googleapis.com/otro-bucket/${cartaPath(UUID_A)}`,
      `https://storage.googleapis.com/${MEMORY_BUCKET_NAME}/beneficios/${UUID_A}.webp`,
      `http://storage.googleapis.com/${MEMORY_BUCKET_NAME}/${cartaPath(UUID_A)}`,
      `https://firebasestorage.googleapis.com/v0/b/${MEMORY_BUCKET_NAME}/o/minijuegos%2Fcartas%2F${UUID_A}.webp`,
    ];
    for (const cartaImagenUrl of invalidas) {
      await expect(
        create([puntos(), especial({ cartaImagenUrl })]),
      ).rejects.toMatchObject({
        code: "MINIGAME_INVALID_PRIZE",
        status: 400,
        message: "La imagen de la carta coleccionable no es válida. Súbela de nuevo desde el panel.",
      });
    }
    expect(memoryFirestore.list("beneficios")).toEqual([]);
    expect(memoryFirestore.list("minijuegos")).toEqual([]);
  });

  it("rechaza con 400 una URL válida cuyo objeto no existe en Storage", async () => {
    await expect(
      create([puntos(), especial({ cartaImagenUrl: cartaUrl(UUID_B) })]),
    ).rejects.toMatchObject({
      code: "MINIGAME_INVALID_PRIZE",
      status: 400,
      message: "No encontramos la imagen de la carta coleccionable. Vuelve a subirla.",
    });
    expect(memoryFirestore.list("minijuegos")).toEqual([]);
  });

  it("rechaza la carta en un premio que no es especial", async () => {
    const url = subida(UUID_A);
    await expect(
      create([{ ...puntos(), cartaImagenUrl: url }, especial()]),
    ).rejects.toMatchObject({
      code: "MINIGAME_INVALID_PRIZE",
      message: "Solo el premio especial puede tener carta coleccionable.",
    });
  });

  it("al editar: ausente conserva, una URL nueva reemplaza, null y '' quitan", async () => {
    const urlA = subida(UUID_A);
    const urlB = subida(UUID_B);
    const created = await create([puntos(), especial({ cartaImagenUrl: urlA })]);
    const { puntosId, especialId } = ids(created);

    // Panel abierto antes del cambio: no manda la clave → se conserva.
    let edited = await update(created, [puntos(puntosId), especial({ id: especialId, nombre: "Vuelo" })]);
    expect(storedEspecial(edited)?.cartaImagenUrl).toBe(urlA);
    expect(storedEspecial(edited)?.nombre).toBe("Vuelo");

    edited = await update(created, [puntos(puntosId), especial({ id: especialId, cartaImagenUrl: urlB })]);
    expect(storedEspecial(edited)?.cartaImagenUrl).toBe(urlB);

    edited = await update(created, [puntos(puntosId), especial({ id: especialId, cartaImagenUrl: null })]);
    expect(storedEspecial(edited)).not.toHaveProperty("cartaImagenUrl");
    expect(edited.minijuego.premios.find((premio) => premio.especial)).not.toHaveProperty(
      "cartaImagenUrl",
    );

    edited = await update(created, [puntos(puntosId), especial({ id: especialId, cartaImagenUrl: urlA })]);
    expect(storedEspecial(edited)?.cartaImagenUrl).toBe(urlA);
    edited = await update(created, [puntos(puntosId), especial({ id: especialId, cartaImagenUrl: "" })]);
    expect(storedEspecial(edited)).not.toHaveProperty("cartaImagenUrl");

    // Ni el reemplazo ni el retiro borran objetos de Storage.
    expect(memoryBucket.deleted).toEqual([]);
    expect(memoryBucket.objects.has(cartaPath(UUID_A))).toBe(true);
    expect(memoryBucket.objects.has(cartaPath(UUID_B))).toBe(true);
  });

  it("un especial nuevo (otro id) no hereda la carta del anterior si no la manda", async () => {
    const created = await create([puntos(), especial({ cartaImagenUrl: subida(UUID_A) })]);
    const { puntosId } = ids(created);
    const edited = await update(created, [puntos(puntosId), especial({ nombre: "Playera" })]);
    expect(storedEspecial(edited)).not.toHaveProperty("cartaImagenUrl");
  });

  it("si el premio deja de ser especial pierde la carta y no la recupera sola", async () => {
    const url = subida(UUID_A);
    const created = await create([puntos(), especial({ cartaImagenUrl: url })]);
    const { puntosId, especialId } = ids(created);
    const premioPath = `minijuegos/${created.minijuegoId}/premios/${especialId}`;

    // El mismo premio pasa a ser normal (sin la clave de la carta).
    const normal: PremioInput = {
      id: especialId,
      nombre: "VUELO EN GLOBO",
      tipo: "physical",
      stock: 3,
      probabilidad: 0.3,
    };
    await update(created, [puntos(puntosId), normal]);
    expect(memoryFirestore.read(premioPath)).not.toHaveProperty("cartaImagenUrl");
    expect(memoryFirestore.read(premioPath)).not.toHaveProperty("especial");

    // Vuelve a ser especial sin mandar la clave: no recupera la carta.
    await update(created, [puntos(puntosId), especial({ id: especialId })]);
    expect(memoryFirestore.read(premioPath)).toMatchObject({ especial: true });
    expect(memoryFirestore.read(premioPath)).not.toHaveProperty("cartaImagenUrl");

    // Mandarla de nuevo la guarda (el objeto sigue en Storage).
    await update(created, [puntos(puntosId), especial({ id: especialId, cartaImagenUrl: url })]);
    expect(memoryFirestore.read(premioPath)?.cartaImagenUrl).toBe(url);
    expect(memoryBucket.deleted).toEqual([]);
  });

  it("una URL sin cambios no se vuelve a comprobar; una nueva sí", async () => {
    const urlA = subida(UUID_A);
    const created = await create([puntos(), especial({ cartaImagenUrl: urlA })]);
    const { puntosId, especialId } = ids(created);

    // Aunque Storage no responda, reenviar la misma URL guarda sin problema.
    memoryBucket.setFailExists(true);
    const same = await update(created, [puntos(puntosId), especial({ id: especialId, cartaImagenUrl: urlA })]);
    expect(storedEspecial(same)?.cartaImagenUrl).toBe(urlA);

    // Una URL distinta exige comprobarla: sin Storage → 503, sin escribir.
    const urlB = subida(UUID_B);
    await expect(
      update(created, [puntos(puntosId), especial({ id: especialId, cartaImagenUrl: urlB })]),
    ).rejects.toMatchObject({ code: "MINIGAME_CARD_IMAGE_UNAVAILABLE", status: 503 });
    expect(storedEspecial(same)?.cartaImagenUrl).toBe(urlA);
  });

  it("en local sin emulador de Storage no acepta URLs nuevas (503)", async () => {
    process.env.IS_LOCAL = "true";
    await expect(
      create([puntos(), especial({ cartaImagenUrl: subida(UUID_A) })]),
    ).rejects.toMatchObject({ code: "MINIGAME_CARD_IMAGE_UNAVAILABLE", status: 503 });
    expect(memoryFirestore.list("minijuegos")).toEqual([]);
  });

  it("con el emulador solo acepta URLs del emulador", async () => {
    process.env.IS_LOCAL = "true";
    process.env.FIREBASE_STORAGE_EMULATOR_HOST = "127.0.0.1:9199";
    memoryBucket.put(cartaPath(UUID_A));
    const local = cartaUrl(UUID_A, "http://127.0.0.1:9199");

    const created = await create([puntos(), especial({ cartaImagenUrl: local })]);
    expect(storedEspecial(created)?.cartaImagenUrl).toBe(local);

    await expect(
      create([puntos(), especial({ cartaImagenUrl: cartaUrl(UUID_A) })]),
    ).rejects.toMatchObject({ code: "MINIGAME_INVALID_PRIZE", status: 400 });
  });
});

describe("cartaImagenUrl: copia inmutable al ganar", () => {
  it("gana A con la imagen A, se cambia a B, gana B: A conserva A", async () => {
    const urlA = subida(UUID_A);
    const urlB = subida(UUID_B);
    const created = await create([puntos(), especial({ cartaImagenUrl: urlA })]);
    const { puntosId, especialId } = ids(created);
    prizeRoll.mode = "last";

    seedUser("socio-a");
    const jugadaA = (await minijuegoService.play(
      created.minijuegoId,
      { uid: "socio-a" },
      nextKey(),
    )) as PlayResponse;
    expect(jugadaA).toMatchObject({
      prizeId: especialId,
      cartaImagenUrl: urlA,
      cartaDiseno: "personalizada",
    });

    await update(created, [puntos(puntosId), especial({ id: especialId, cartaImagenUrl: urlB })]);

    seedUser("socio-b");
    const jugadaB = (await minijuegoService.play(
      created.minijuegoId,
      { uid: "socio-b" },
      nextKey(),
    )) as PlayResponse;
    expect(jugadaB).toMatchObject({ cartaImagenUrl: urlB, cartaDiseno: "personalizada" });

    // Copia en la jugada y en el ganador de cada uno.
    expect(memoryFirestore.read(`usuariosApp/socio-a/minijuego_jugadas/${jugadaA.id}`)).toMatchObject({
      cartaImagenUrl: urlA,
      cartaDiseno: "personalizada",
    });
    expect(memoryFirestore.read(`ganadoresPremioEspecial/${jugadaA.id}`)).toMatchObject({
      cartaImagenUrl: urlA,
      cartaDiseno: "personalizada",
    });
    expect(memoryFirestore.read(`ganadoresPremioEspecial/${jugadaB.id}`)).toMatchObject({
      cartaImagenUrl: urlB,
      cartaDiseno: "personalizada",
    });

    const [beneficioA] = await minijuegoService.listMisBeneficios({ uid: "socio-a" });
    const [beneficioB] = await minijuegoService.listMisBeneficios({ uid: "socio-b" });
    expect(beneficioA).toMatchObject({ cartaImagenUrl: urlA, cartaDiseno: "personalizada" });
    expect(beneficioB).toMatchObject({ cartaImagenUrl: urlB, cartaDiseno: "personalizada" });

    // Se quita la carta: el siguiente ganador recibe el diseño predeterminado
    // y los anteriores no cambian.
    await update(created, [puntos(puntosId), especial({ id: especialId, cartaImagenUrl: null })]);
    seedUser("socio-c");
    const jugadaC = (await minijuegoService.play(
      created.minijuegoId,
      { uid: "socio-c" },
      nextKey(),
    )) as PlayResponse;
    expect(jugadaC).toMatchObject({ cartaImagenUrl: null, cartaDiseno: "predeterminada" });
    expect(memoryFirestore.read(`ganadoresPremioEspecial/${jugadaC.id}`)).toMatchObject({
      cartaImagenUrl: null,
      cartaDiseno: "predeterminada",
    });
    const [beneficioC] = await minijuegoService.listMisBeneficios({ uid: "socio-c" });
    expect(beneficioC).toMatchObject({ cartaImagenUrl: null, cartaDiseno: "predeterminada" });
    expect((await minijuegoService.listMisBeneficios({ uid: "socio-a" }))[0]).toMatchObject({
      cartaImagenUrl: urlA,
    });
  });

  it("la respuesta de la jugada lleva la carta en replay, pending-play, ack y getDetails", async () => {
    const url = subida(UUID_C);
    const created = await create([puntos(), especial({ cartaImagenUrl: url })]);
    prizeRoll.mode = "last";
    seedUser("socio");
    const key = nextKey();
    const first = (await minijuegoService.play(created.minijuegoId, { uid: "socio" }, key)) as PlayResponse;
    const expected = { cartaImagenUrl: url, cartaDiseno: "personalizada" };
    expect(first).toMatchObject(expected);

    const replay = (await minijuegoService.play(created.minijuegoId, { uid: "socio" }, key)) as PlayResponse;
    expect(replay).toMatchObject({ ...expected, alreadyPlayed: true, id: first.id });

    const pending = (await minijuegoService.getPendingPlay(created.minijuegoId, { uid: "socio" })) as PlayResponse;
    expect(pending).toMatchObject(expected);

    const view = (await minijuegoService.getDetails(created.minijuegoId, { uid: "socio" })) as {
      pendingPlay: PlayResponse | null;
    };
    expect(view.pendingPlay).toMatchObject(expected);

    const ack = (await minijuegoService.acknowledge(created.minijuegoId, first.id, { uid: "socio" })) as PlayResponse;
    expect(ack).toMatchObject(expected);
  });

  it("los premios de puntos y las jugadas anteriores no llevan campos de carta", async () => {
    const created = await create([puntos(), especial({ cartaImagenUrl: subida(UUID_A) })], 2);
    seedUser("socio");
    prizeRoll.mode = "zero";
    const pts = (await minijuegoService.play(created.minijuegoId, { uid: "socio" }, nextKey())) as PlayResponse;
    expect(pts).not.toHaveProperty("cartaImagenUrl");
    expect(pts).not.toHaveProperty("cartaDiseno");
    expect(memoryFirestore.read(`usuariosApp/socio/minijuego_jugadas/${pts.id}`)).not.toHaveProperty(
      "cartaImagenUrl",
    );

    // Jugada antigua del especial, sin la copia de la carta.
    const { especialId } = ids(created);
    memoryFirestore.put(`usuariosApp/antiguo/minijuego_jugadas/play-antigua`, {
      id: "play-antigua",
      minijuegoId: created.minijuegoId,
      userId: "antiguo",
      prizeId: especialId,
      prizeType: "physical",
      prizeName: "VUELO EN GLOBO",
      status: "completed",
      idempotencyKey: "antigua0001",
      revelado: false,
      createdAt: Timestamp.now(),
      terminos: "",
      premioImagenUrl: "",
    });
    memoryFirestore.put(`usuariosApp/antiguo/minijuego_estado/${created.minijuegoId}`, {
      intentosUsados: 1,
      ultimaPlayId: "play-antigua",
      claves: { antigua0001: "play-antigua" },
    });
    const antigua = (await minijuegoService.getPendingPlay(created.minijuegoId, {
      uid: "antiguo",
    })) as PlayResponse;
    expect(antigua.prizeId).toBe(especialId);
    expect(antigua).not.toHaveProperty("cartaImagenUrl");
    expect(antigua).not.toHaveProperty("cartaDiseno");
  });

  it("mis beneficios: registros anteriores dan null y nunca toman la carta del premio vivo", async () => {
    const url = subida(UUID_A);
    const created = await create([puntos(), especial({ cartaImagenUrl: url })]);
    const { especialId } = ids(created);
    memoryFirestore.put("ganadoresPremioEspecial/antiguo", {
      id: "antiguo",
      playId: "antiguo",
      minijuegoId: created.minijuegoId,
      beneficioId: created.id,
      beneficioTitulo: "Sobre sorpresa",
      uid: "socio-antiguo",
      premioId: especialId,
      premioNombre: "VUELO EN GLOBO",
      createdAt: Timestamp.fromDate(new Date("2026-11-10T18:00:00.000Z")),
      terminos: "Presenta tu folio.",
      validoDesde: null,
      caducaEl: null,
      premioImagenUrl: "",
    });

    const [beneficio] = await minijuegoService.listMisBeneficios({ uid: "socio-antiguo" });
    expect(beneficio).toMatchObject({
      playId: "antiguo",
      premioNombre: "VUELO EN GLOBO",
      cartaImagenUrl: null,
      cartaDiseno: null,
    });
    expect(memoryFirestore.read("ganadoresPremioEspecial/antiguo")).not.toHaveProperty(
      "cartaImagenUrl",
    );
  });
});
