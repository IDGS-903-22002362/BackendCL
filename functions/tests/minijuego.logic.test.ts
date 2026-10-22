import { describe, expect, it } from "@jest/globals";
import { Minijuego, MinijuegoPremio } from "../src/models/minijuego.model";
import {
  MinijuegoError,
  canAccessMinijuego,
  DEFAULT_ROULETTE_POINT_VALUES,
  buildSpecialWinner,
  decidePlay,
  drawAvailablePrize,
  isVisibleInCatalog,
  normalizeUidList,
  pickWeightedPrize,
  pointsLedgerAmount,
  prepareMinijuegoWrite,
  resolveBeneficioEspecialEstado,
  resolveSpecialStock,
  rouletteSegmentLabel,
  rouletteSegments,
  toSpecialWinnersView,
  resolveBeneficioTipo,
  viewerFromRequest,
} from "../src/services/minijuego.logic";

const now = new Date("2026-10-09T12:00:00.000Z");

function minijuego(overrides: Partial<Minijuego> = {}): Minijuego {
  return {
    id: "game-1",
    beneficioId: "game-1",
    tipo: "ruleta",
    estatus: true,
    intentosPorUsuario: 1,
    audiencia: {
      visibilidad: "publico",
      usuariosPermitidos: [],
    },
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function premio(overrides: Partial<MinijuegoPremio> = {}): MinijuegoPremio {
  return {
    id: "p1",
    minijuegoId: "game-1",
    nombre: "100 puntos",
    tipo: "points",
    valor: 100,
    stock: null,
    weight: 1,
    orden: 0,
    ...overrides,
  };
}

describe("minijuego logic", () => {
  it("trata un beneficio antiguo sin tipo como estándar", () => {
    expect(resolveBeneficioTipo(undefined)).toBe("estandar");
    expect(resolveBeneficioTipo("otro")).toBe("estandar");
    expect(resolveBeneficioTipo("minijuego")).toBe("minijuego");
  });

  it("normaliza y deduplica UIDs", () => {
    expect(
      normalizeUidList([
        " 00G1mpn5pebEAjiaiZsiOYAGCQy2 ",
        "00G1mpn5pebEAjiaiZsiOYAGCQy2",
        "uid-b",
      ]),
    ).toEqual(["00G1mpn5pebEAjiaiZsiOYAGCQy2", "uid-b"]);
  });

  it("rechaza una allowlist restringida vacía", () => {
    expect(() =>
      prepareMinijuegoWrite({
        beneficio: {
          titulo: "Prueba ruleta",
          descripcion: "Prueba",
          estatus: true,
        },
        minijuego: {
          tipo: "ruleta",
          intentosPorUsuario: 1,
          audiencia: {
            visibilidad: "restringido",
            usuariosPermitidos: [],
          },
        },
        premios: [
          {
            nombre: "100 puntos",
            tipo: "points",
            valor: 100,
          },
        ],
      }),
    ).toThrow(MinijuegoError);
  });

  it("solo el UID autorizado ve un minijuego restringido", () => {
    const game = minijuego({
      audiencia: {
        visibilidad: "restringido",
        usuariosPermitidos: ["uid-a"],
      },
    });
    const missing = minijuego({
      audiencia: {
        visibilidad: "publico",
        usuariosPermitidos: [],
      },
    });
    const unknown = {
      ...missing,
      audiencia: {
        visibilidad: "interno" as "publico",
        usuariosPermitidos: ["uid-a"],
      },
    };

    expect(canAccessMinijuego(game.audiencia)).toBe(false);
    expect(canAccessMinijuego(game.audiencia, "uid-b")).toBe(false);
    expect(canAccessMinijuego(game.audiencia, " uid-a ")).toBe(true);
    expect(canAccessMinijuego(missing.audiencia)).toBe(true);
    expect(canAccessMinijuego(unknown.audiencia, "uid-a")).toBe(false);
    expect(canAccessMinijuego(unknown.audiencia, "uid-b")).toBe(false);
    expect(canAccessMinijuego(unknown.audiencia)).toBe(false);
    expect(
      isVisibleInCatalog({
        tipo: "minijuego",
        beneficioActivo: true,
        minijuego: game,
        uid: "uid-b",
        now,
        adminView: false,
      }),
    ).toBe(false);
    expect(
      isVisibleInCatalog({
        tipo: "minijuego",
        beneficioActivo: true,
        minijuego: game,
        uid: "uid-a",
        now,
        adminView: false,
      }),
    ).toBe(true);
    expect(
      isVisibleInCatalog({
        tipo: "minijuego",
        beneficioActivo: true,
        minijuego: game,
        now,
        adminView: false,
      }),
    ).toBe(false);
    expect(
      isVisibleInCatalog({
        tipo: undefined,
        beneficioActivo: false,
        minijuego: null,
        now,
        adminView: false,
      }),
    ).toBe(true);
  });

  it("dos consultas seguidas no entregan el juego de A a B", () => {
    const game = minijuego({
      audiencia: {
        visibilidad: "restringido",
        usuariosPermitidos: ["uid-a"],
      },
    });
    const visibleFor = (uid?: string) =>
      isVisibleInCatalog({
        tipo: "minijuego",
        beneficioActivo: true,
        minijuego: game,
        uid,
        now,
        adminView: false,
      });

    expect(visibleFor("uid-a")).toBe(true);
    expect(visibleFor("uid-b")).toBe(false);
    expect(visibleFor()).toBe(false);
  });

  it("elige el premio según el peso y no según el orden", () => {
    const premios = [
      premio({ id: "bajo", weight: 1 }),
      premio({ id: "alto", nombre: "500 puntos", valor: 500, weight: 9, orden: 1 }),
    ];

    expect(pickWeightedPrize(premios, () => 0).id).toBe("bajo");
    expect(pickWeightedPrize(premios, () => 1).id).toBe("alto");
    expect(pickWeightedPrize(premios, () => 9).id).toBe("alto");
  });

  it("ignora premios sin stock", () => {
    const chosen = pickWeightedPrize(
      [
        premio({ id: "agotado", stock: 0, weight: 100 }),
        premio({ id: "disponible", weight: 1, orden: 1 }),
      ],
      () => 0,
    );

    expect(chosen.id).toBe("disponible");
  });

  it("repite la misma participación cuando llega la misma clave", () => {
    const decision = decidePlay({
      uid: "uid-a",
      beneficioActivo: true,
      minijuego: minijuego({
        audiencia: {
          visibilidad: "restringido",
          usuariosPermitidos: ["uid-b"],
        },
      }),
      premios: [premio()],
      estado: {
        intentosUsados: 1,
        ultimaPlayId: "play-1",
        claves: { "idem-key-1": "play-1" },
      },
      idempotencyKey: "idem-key-1",
      now,
      randomInt: () => 0,
    });

    expect(decision).toEqual({ type: "replay", playId: "play-1" });
  });

  it("responde sin intentos y niega el acceso antes de sortear", () => {
    expect(() =>
      decidePlay({
        uid: "uid-a",
        beneficioActivo: true,
        minijuego: minijuego(),
        premios: [premio(), premio({ id: "p2", orden: 1 })],
        estado: { intentosUsados: 1, claves: {} },
        idempotencyKey: "idem-key-2",
        now,
        randomInt: () => {
          throw new Error("no debe sortear");
        },
      }),
    ).toThrow(expect.objectContaining({ code: "MINIGAME_NO_ATTEMPTS", status: 409 }));

    expect(() =>
      decidePlay({
        uid: "uid-b",
        beneficioActivo: true,
        minijuego: minijuego({
          audiencia: {
            visibilidad: "restringido",
            usuariosPermitidos: ["uid-a"],
          },
        }),
        premios: [premio()],
        estado: null,
        idempotencyKey: "idem-key-3",
        now,
        randomInt: () => 0,
      }),
    ).toThrow(expect.objectContaining({ code: "MINIGAME_ACCESS_DENIED", status: 403 }));
  });

  it("TEST 11: un especial con stock 1 solo se adjudica una vez", () => {
    const points = premio({ id: "pts", nombre: "10 puntos", valor: 10, weight: 30 });
    const special = premio({
      id: "esp",
      nombre: "2 boletos para León vs América",
      tipo: "physical",
      valor: undefined,
      stock: 1,
      weight: 1,
      orden: 1,
      especial: true,
    });

    const first = drawAvailablePrize([points, special], () => 30);
    expect(first.prize.id).toBe("esp");
    expect(first.premios.find((item) => item.id === "esp")?.stock).toBe(0);

    const second = drawAvailablePrize(first.premios, () => 0);
    expect(second.prize.id).toBe("pts");
    expect(second.premios.find((item) => item.id === "esp")?.stock).toBe(0);
    expect(
      [first, second].filter((draw) => draw.prize.id === "esp"),
    ).toHaveLength(1);
  });

  it("TEST 12: stock 2 se agota y el especial sale del sorteo", () => {
    let premios = [
      premio({ id: "pts", nombre: "10 puntos", valor: 10, weight: 1 }),
      premio({
        id: "esp",
        nombre: "1 acceso a entrenamiento",
        tipo: "physical",
        valor: undefined,
        stock: 2,
        weight: 1,
        orden: 1,
        especial: true,
      }),
    ];
    const winners: string[] = [];

    for (let turn = 0; turn < 2; turn += 1) {
      const draw = drawAvailablePrize(premios, () => 1);
      winners.push(draw.prize.id);
      premios = draw.premios;
    }

    expect(winners).toEqual(["esp", "esp"]);
    expect(premios.find((item) => item.id === "esp")?.stock).toBe(0);
    expect(drawAvailablePrize(premios, () => 0).prize.id).toBe("pts");
    expect(pickWeightedPrize(premios, () => 0).id).toBe("pts");
  });

  it("TEST 13: con el especial agotado la ruleta sigue con puntos ilimitados", () => {
    const premios = [
      premio({ id: "pts", nombre: "10 puntos", valor: 10, weight: 30 }),
      premio({
        id: "esp",
        nombre: "2 boletos para León vs América",
        tipo: "physical",
        valor: undefined,
        stock: 0,
        weight: 1,
        orden: 1,
        especial: true,
      }),
    ];

    expect(pickWeightedPrize(premios, () => 29).id).toBe("pts");
    expect(() => pickWeightedPrize(premios, () => 30)).toThrow(
      expect.objectContaining({ code: "MINIGAME_NO_PRIZES" }),
    );
    expect(rouletteSegments(premios).map((item) => item.id)).toEqual(["pts"]);
    expect(rouletteSegments(premios, "esp").map((item) => item.id)).toEqual([
      "pts",
      "esp",
    ]);

    const decision = decidePlay({
      uid: "uid-a",
      beneficioActivo: true,
      minijuego: minijuego(),
      premios,
      estado: null,
      idempotencyKey: "giro-agotado",
      now,
      randomInt: () => 0,
    });

    expect(decision).toEqual({
      type: "create",
      prize: expect.objectContaining({ id: "pts" }),
    });
  });

  it("TEST 14: el peso manda, no el tamaño ni la posición del segmento", () => {
    const points = Array.from({ length: 10 }, (_, index) =>
      premio({
        id: `p${index}`,
        nombre: `${(index + 1) * 10} puntos`,
        valor: (index + 1) * 10,
        weight: 10,
        orden: index,
      }),
    );
    const special = premio({
      id: "esp",
      nombre: "2 boletos para León vs América",
      tipo: "physical",
      valor: undefined,
      stock: 1,
      weight: 1,
      orden: 10,
      especial: true,
    });
    const premios = [...points, special];

    expect(pickWeightedPrize(premios, () => 0).id).toBe("p0");
    expect(pickWeightedPrize(premios, () => 10).id).toBe("p1");
    expect(pickWeightedPrize(premios, () => 99).id).toBe("p9");
    expect(pickWeightedPrize(premios, () => 100).id).toBe("esp");
  });

  it("TEST 15: dos giros simultáneos no adjudican dos veces el último especial", () => {
    const snapshot = [
      premio({ id: "pts", nombre: "10 puntos", valor: 10, weight: 30 }),
      premio({
        id: "esp",
        nombre: "2 boletos para León vs América",
        tipo: "physical",
        valor: undefined,
        stock: 1,
        weight: 1,
        orden: 1,
        especial: true,
      }),
    ];
    const roll = (max: number) => (max > 30 ? 30 : max - 1);

    const first = drawAvailablePrize(snapshot, roll);
    const retry = drawAvailablePrize(first.premios, roll);
    const winners = [first, retry].filter((draw) => draw.prize.id === "esp");

    expect(first.prize.id).toBe("esp");
    expect(first.premios.find((item) => item.id === "esp")?.stock).toBe(0);
    expect(retry.prize.id).toBe("pts");
    expect(winners).toHaveLength(1);
  });

  it("una ruleta nueva parte de 10 a 100 y esos valores se pueden editar", () => {
    expect(DEFAULT_ROULETTE_POINT_VALUES).toEqual([
      10, 20, 30, 40, 50, 60, 70, 80, 90, 100,
    ]);

    const edited = prepareMinijuegoWrite({
      beneficio: { titulo: "Ruleta", descripcion: "Prueba", estatus: true },
      minijuego: {
        tipo: "ruleta",
        intentosPorUsuario: 1,
        audiencia: { visibilidad: "publico", usuariosPermitidos: [] },
      },
      premios: [
        { id: "p10", nombre: "4 puntos", tipo: "points", valor: 4, weight: 30 },
        { id: "p20", nombre: "8 puntos", tipo: "points", valor: 8, weight: 25 },
        {
          id: "esp",
          nombre: "2 boletos León vs América",
          tipo: "physical",
          stock: 1,
          weight: 1,
          especial: true,
          maxGanadores: 1,
        },
      ],
    });

    expect(edited.premios[0]).toMatchObject({ id: "p10", valor: 4, stock: null });
    expect(edited.premios[1]).toMatchObject({ id: "p20", valor: 8 });
    expect(edited.premios[2]).toMatchObject({
      id: "esp",
      especial: true,
      stock: 1,
      maxGanadores: 1,
    });
    expect(rouletteSegmentLabel(edited.premios[0])).toBe("4");
    expect(rouletteSegmentLabel(edited.premios[2])).toBe("ESPECIAL");
  });

  it("un especial con máximo 5 no pasa de cinco y al agotarse siguen los puntos", () => {
    let premios = [
      premio({ id: "pts", nombre: "40 puntos", valor: 40, weight: 1 }),
      premio({
        id: "esp",
        nombre: "Playera oficial",
        tipo: "physical",
        valor: undefined,
        stock: 5,
        weight: 1,
        orden: 1,
        especial: true,
      }),
    ];

    for (let turn = 0; turn < 5; turn += 1) {
      const draw = drawAvailablePrize(premios, () => 1);
      expect(draw.prize.id).toBe("esp");
      premios = draw.premios;
    }

    expect(premios.find((item) => item.id === "esp")?.stock).toBe(0);
    expect(drawAvailablePrize(premios, () => 0).prize.id).toBe("pts");
    expect(rouletteSegments(premios).map((item) => item.id)).toEqual(["pts"]);
  });

  it("40 puntos suman 40 al ledger y el especial no acredita puntos", () => {
    expect(pointsLedgerAmount({ tipo: "points", valor: 40 })).toBe(40);
    expect(
      pointsLedgerAmount({
        tipo: "physical",
        valor: 40,
        especial: true,
      }),
    ).toBe(0);
  });

  it("el snapshot del especial sale de usuariosApp y no se duplica en un replay", () => {
    expect(
      buildSpecialWinner({
        tipo: "ruleta",
        especial: true,
        uid: "fhDPCB4OtqbuGdwQtPiupxByKI92",
        profile: {
          email: "jonyhdzmichaca@gmail.com",
          telefono: "4771234567",
          phone: "0000000000",
        } as { email: string; telefono: string },
      }),
    ).toEqual({
      uid: "fhDPCB4OtqbuGdwQtPiupxByKI92",
      email: "jonyhdzmichaca@gmail.com",
      telefono: "4771234567",
    });

    const replay = decidePlay({
      uid: "fhDPCB4OtqbuGdwQtPiupxByKI92",
      beneficioActivo: true,
      minijuego: minijuego(),
      premios: [premio({ id: "esp", especial: true, stock: 1, tipo: "physical", valor: undefined })],
      estado: {
        intentosUsados: 1,
        ultimaPlayId: "play-esp",
        claves: { "idem-especial": "play-esp" },
      },
      idempotencyKey: "idem-especial",
      now,
      randomInt: () => {
        throw new Error("no debe sortear otra vez");
      },
    });
    expect(replay).toEqual({ type: "replay", playId: "play-esp" });
  });

  it("conserva el stock ya consumido si el máximo de ganadores no cambia", () => {
    expect(
      resolveSpecialStock({
        requestedMax: 2,
        previousMax: 2,
        previousStock: 1,
        awarded: 1,
      }),
    ).toEqual({ stock: 1, maxGanadores: 2 });

    expect(
      resolveSpecialStock({
        requestedMax: 5,
        previousMax: 2,
        previousStock: 1,
        awarded: 1,
      }),
    ).toEqual({ stock: 4, maxGanadores: 5 });

    expect(
      resolveSpecialStock({
        requestedMax: 1,
        previousMax: 2,
        previousStock: 1,
        awarded: 1,
      }),
    ).toEqual({ stock: 0, maxGanadores: 1 });
  });

  it("el catálogo público no lleva ganadores y el admin solo devuelve uid, correo y teléfono", () => {
    const segments = rouletteSegments([
      premio({ id: "p40", nombre: "40 puntos", valor: 40, weight: 10 }),
      premio({
        id: "esp",
        nombre: "2 boletos León vs América",
        tipo: "physical",
        valor: undefined,
        stock: 0,
        weight: 1,
        especial: true,
        orden: 1,
      }),
    ]).map((item) => ({
      id: item.id,
      label: rouletteSegmentLabel(item),
    }));
    const publicView = {
      id: "game-1",
      segments,
      intentosRestantes: 1,
    };

    expect(segments.map((item) => item.label)).toEqual(["40"]);
    expect(JSON.stringify(publicView)).not.toMatch(/ganadores|telefono|email|weight/);

    const adminView = toSpecialWinnersView({
      premio: "2 boletos León vs América",
      maxGanadores: 2,
      ganadores: [
        {
          uid: "fhDPCB4OtqbuGdwQtPiupxByKI92",
          email: "jonyhdzmichaca@gmail.com",
          telefono: "4771234567",
        },
      ],
    });

    expect(adminView).toEqual({
      premio: "2 boletos León vs América",
      maxGanadores: 2,
      totalGanadores: 1,
      ganadores: [
        {
          uid: "fhDPCB4OtqbuGdwQtPiupxByKI92",
          email: "jonyhdzmichaca@gmail.com",
          telefono: "4771234567",
        },
      ],
    });
    expect(Object.keys(adminView.ganadores[0])).toEqual([
      "uid",
      "email",
      "telefono",
    ]);
  });

  it("guarda uid, correo y teléfono al ganar el especial de cualquier minijuego", () => {
    expect(
      buildSpecialWinner({
        tipo: "ruleta",
        especial: true,
        uid: "00G1mpn5pebEAjiaiZsiOYAGCQy2",
        profile: {
          email: "vilchezkarol01@gmail.com",
          telefono: "4771234567",
        },
      }),
    ).toEqual({
      uid: "00G1mpn5pebEAjiaiZsiOYAGCQy2",
      email: "vilchezkarol01@gmail.com",
      telefono: "4771234567",
    });

    expect(
      buildSpecialWinner({
        tipo: "ruleta",
        especial: true,
        uid: "uid-sin-correo",
        profile: { telefono: "4770000000" },
      })?.email,
    ).toBe("");

    expect(
      buildSpecialWinner({
        tipo: "ruleta",
        especial: false,
        uid: "uid-a",
        profile: { email: "a@b.com", telefono: "4770000000" },
      }),
    ).toBeNull();

    for (const tipo of ["cofre", "rasca", "cartas", "sobre"]) {
      expect(
        buildSpecialWinner({
          tipo,
          especial: true,
          uid: "uid-a",
          profile: { email: "a@b.com", telefono: "4770000000" },
        }),
      ).toEqual({
        uid: "uid-a",
        email: "a@b.com",
        telefono: "4770000000",
      });
    }
  });

  it("guarda un solo premio especial y usa peso 1 si no se indica", () => {
    const prepared = prepareMinijuegoWrite({
      beneficio: {
        titulo: "Ruleta",
        descripcion: "Prueba",
        estatus: true,
      },
      minijuego: {
        tipo: "ruleta",
        intentosPorUsuario: 1,
        audiencia: { visibilidad: "publico", usuariosPermitidos: [] },
      },
      premios: [
        { nombre: "10 puntos", tipo: "points", valor: 10 },
        {
          nombre: "2 boletos para León vs América",
          tipo: "physical",
          stock: 1,
          especial: true,
        },
      ],
    });

    expect(prepared.premios[1]).toMatchObject({
      especial: true,
      stock: 1,
      weight: 1,
    });
    expect(prepared.premios[0].stock).toBeNull();
    expect(prepared.premios[0].especial).toBeUndefined();

    expect(() =>
      prepareMinijuegoWrite({
        beneficio: {
          titulo: "Ruleta",
          descripcion: "Prueba",
          estatus: true,
        },
        minijuego: {
          tipo: "ruleta",
          intentosPorUsuario: 1,
          audiencia: { visibilidad: "publico", usuariosPermitidos: [] },
        },
        premios: [
          { nombre: "Boletos", tipo: "physical", stock: 1, especial: true },
          { nombre: "Playera", tipo: "physical", stock: 1, especial: true },
        ],
      }),
    ).toThrow(expect.objectContaining({ code: "MINIGAME_INVALID_PRIZE" }));

    expect(() =>
      prepareMinijuegoWrite({
        beneficio: {
          titulo: "Cofre",
          descripcion: "Prueba",
          estatus: true,
        },
        minijuego: {
          tipo: "cofre",
          intentosPorUsuario: 1,
          audiencia: { visibilidad: "publico", usuariosPermitidos: [] },
        },
        premios: [
          { nombre: "Boletos", tipo: "physical", stock: 1, especial: true },
          { nombre: "Playera", tipo: "physical", stock: 1, especial: true },
        ],
      }),
    ).toThrow(expect.objectContaining({ code: "MINIGAME_INVALID_PRIZE" }));
  });

  it("guarda términos y vigencia solo en el premio especial", () => {
    const prepared = prepareMinijuegoWrite({
      beneficio: {
        titulo: "Cartas",
        descripcion: "Prueba",
        estatus: true,
      },
      minijuego: {
        tipo: "cartas",
        intentosPorUsuario: 1,
        audiencia: { visibilidad: "publico", usuariosPermitidos: [] },
      },
      premios: [
        {
          nombre: "10 puntos",
          tipo: "points",
          valor: 10,
          terminos: "No deben guardarse",
          validoDesde: "2026-01-01T00:00:00.000Z",
          caducaEl: "2026-02-01T00:00:00.000Z",
        },
        {
          nombre: "Boletos",
          tipo: "physical",
          stock: 1,
          especial: true,
          terminos: " Canje en taquilla. ",
          validoDesde: "2026-03-01T00:00:00.000Z",
          caducaEl: "2026-04-01T00:00:00.000Z",
        },
      ],
    });

    expect(prepared.premios[0].terminos).toBeUndefined();
    expect(prepared.premios[0].validoDesde).toBeUndefined();
    expect(prepared.premios[1]).toMatchObject({
      especial: true,
      terminos: "Canje en taquilla.",
      validoDesde: new Date("2026-03-01T00:00:00.000Z"),
      caducaEl: new Date("2026-04-01T00:00:00.000Z"),
    });
  });

  it("rechaza una caducidad anterior al inicio de vigencia", () => {
    expect(() =>
      prepareMinijuegoWrite({
        beneficio: {
          titulo: "Cartas",
          descripcion: "Prueba",
          estatus: true,
        },
        minijuego: {
          tipo: "cartas",
          intentosPorUsuario: 1,
          audiencia: { visibilidad: "publico", usuariosPermitidos: [] },
        },
        premios: [
          {
            nombre: "Boletos",
            tipo: "physical",
            stock: 1,
            especial: true,
            validoDesde: "2026-05-01T00:00:00.000Z",
            caducaEl: "2026-04-01T00:00:00.000Z",
          },
        ],
      }),
    ).toThrow(expect.objectContaining({ code: "MINIGAME_INVALID_DATE" }));
  });

  it("calcula vigente, pendiente y caducado sin inventar fechas", () => {
    const now = new Date("2026-10-14T18:00:00.000Z");

    expect(resolveBeneficioEspecialEstado(now, null, null)).toBe("vigente");
    expect(
      resolveBeneficioEspecialEstado(
        now,
        new Date("2026-11-01T00:00:00.000Z"),
        new Date("2026-12-01T00:00:00.000Z"),
      ),
    ).toBe("pendiente");
    expect(
      resolveBeneficioEspecialEstado(
        now,
        new Date("2026-01-01T00:00:00.000Z"),
        new Date("2026-02-01T00:00:00.000Z"),
      ),
    ).toBe("caducado");
    expect(
      resolveBeneficioEspecialEstado(
        now,
        new Date("2026-01-01T00:00:00.000Z"),
        new Date("2026-12-31T00:00:00.000Z"),
      ),
    ).toBe("vigente");
  });

  it("no marca adminView si el rol no es de staff", () => {
    expect(
      viewerFromRequest({
        user: { uid: "u1", email: "A@B.com", rol: "CLIENTE" },
        query: { admin: "1" },
      }),
    ).toMatchObject({
      uid: "u1",
      adminView: false,
    });
  });
});
