import type { NextFunction, Request, Response } from "express";
import { promises as fs } from "fs";
import os from "os";
import sharp from "sharp";
import { memoryFirestore } from "./helpers/memory-firestore";
import { MEMORY_BUCKET_NAME, memoryBucket } from "./helpers/memory-storage";

// file-type es solo ESM y jest no lo puede cargar (en Node 22 se carga con
// require(esm)). Este doble reconoce los mismos bytes mágicos.
jest.mock(
  "file-type",
  () => ({
    fileTypeFromBuffer: async (input: Uint8Array) => {
      const bytes = Buffer.from(input);
      if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
        return { ext: "jpg", mime: "image/jpeg" };
      }
      if (bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))) {
        return { ext: "png", mime: "image/png" };
      }
      if (
        bytes.toString("latin1", 0, 4) === "RIFF" &&
        bytes.toString("latin1", 8, 12) === "WEBP"
      ) {
        return { ext: "webp", mime: "image/webp" };
      }
      return undefined;
    },
  }),
  { virtual: true },
);

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

// Sesiones de prueba por token (sin JWT ni Firebase Auth).
jest.mock("../src/utils/middlewares", () => {
  const usuarios: Record<string, { uid: string; rol: string }> = {
    "Bearer admin": { uid: "admin-1", rol: "ADMIN" },
    "Bearer empleado": { uid: "empleado-1", rol: "EMPLEADO" },
    "Bearer club": { uid: "club-1", rol: "EMPLEADO_CLUB" },
    "Bearer socio1": { uid: "socio-1", rol: "CLIENTE" },
    "Bearer socio2": { uid: "socio-2", rol: "CLIENTE" },
    "Bearer socio3": { uid: "socio-3", rol: "CLIENTE" },
  };
  const autenticar = (req: Request): boolean => {
    const usuario = usuarios[req.header("authorization") ?? ""];
    if (!usuario) return false;
    req.user = {
      ...usuario,
      email: `${usuario.uid}@club.test`,
      nombre: usuario.uid,
    } as never;
    return true;
  };
  return {
    authMiddleware: (req: Request, res: Response, next: NextFunction) => {
      if (!autenticar(req)) {
        return res.status(401).json({ success: false, message: "No autenticado" });
      }
      return next();
    },
    optionalAuthWithUserMiddleware: (req: Request, _res: Response, next: NextFunction) => {
      autenticar(req);
      next();
    },
  };
});

import express from "express";
import loyaltyFeatureFlagsService from "../src/modules/loyalty/services/loyalty-feature-flags.service";
import beneficiosRouter from "../src/routes/beneficios.routes";
import minijuegosRouter from "../src/routes/minijuegos.routes";

// supertest ya es dependencia de desarrollo; el repo no trae sus tipos.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const request = require("supertest");

jest.setTimeout(120_000);

const UPLOAD = "/api/beneficios/minijuego/carta-imagen";
const PROD_URL =
  /^https:\/\/storage\.googleapis\.com\/app-oficial-leon\.firebasestorage\.app\/minijuegos\/cartas\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.webp$/;

function isMultipart(req: express.Request): boolean {
  return (req.headers["content-type"] ?? "").includes("multipart/form-data");
}

/** Igual que app.ts: el multipart llega como Buffer y el resto como JSON. */
function buildApp() {
  const app = express();
  app.use(
    express.raw({ type: (req) => isMultipart(req as express.Request), limit: "55mb" }),
  );
  app.use((req, res, next) =>
    isMultipart(req) ? next() : express.json({ limit: "32mb" })(req, res, next),
  );
  app.use("/api/beneficios", beneficiosRouter);
  app.use("/api/minijuegos", minijuegosRouter);
  return app;
}

const app = buildApp();

async function imagen(
  width: number,
  height: number,
  format: "jpeg" | "png" | "webp" = "jpeg",
): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 196, g: 163, b: 90 } },
  })
    .toFormat(format)
    .toBuffer();
}

async function subir(
  token: string,
  file: Buffer,
  options: { field?: string; filename?: string; contentType?: string } = {},
) {
  return request(app)
    .post(UPLOAD)
    .set("Authorization", token)
    .attach(options.field ?? "imagen", file, {
      filename: options.filename ?? "carta.jpg",
      contentType: options.contentType ?? "image/jpeg",
    });
}

async function temporalesMultipart(): Promise<Set<string>> {
  const files = await fs.readdir(os.tmpdir());
  return new Set(files.filter((name) => name.startsWith("ai-upload-")));
}

const ENV_KEYS = [
  "IS_LOCAL",
  "FIREBASE_STORAGE_EMULATOR_HOST",
  "STORAGE_EMULATOR_HOST",
  "FUNCTION_NAME",
  "K_SERVICE",
] as const;
const savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

beforeEach(() => {
  memoryFirestore.reset();
  memoryBucket.reset();
  loyaltyFeatureFlagsService.clearCache();
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  jest.restoreAllMocks();
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

describe("POST /api/beneficios/minijuego/carta-imagen", () => {
  it("el staff sube la imagen: 201 con url, path, 1744 × 1182 y bytes", async () => {
    const roles: Array<[string, string]> = [
      ["Bearer admin", "admin-1"],
      ["Bearer empleado", "empleado-1"],
      ["Bearer club", "club-1"],
    ];
    for (const [token, uid] of roles) {
      const response = await subir(token, await imagen(1000, 678));
      expect(response.status).toBe(201);
      expect(response.body).toEqual({
        success: true,
        data: {
          url: expect.stringMatching(PROD_URL),
          path: expect.stringMatching(/^minijuegos\/cartas\/.+\.webp$/),
          width: 1744,
          height: 1182,
          bytes: expect.any(Number),
        },
      });
      const { url, path: objectPath, bytes } = response.body.data;
      expect(url).toBe(`https://storage.googleapis.com/${MEMORY_BUCKET_NAME}/${objectPath}`);
      const stored = memoryBucket.objects.get(objectPath);
      expect(stored?.data.length).toBe(bytes);
      expect(stored?.options).toMatchObject({
        resumable: false,
        public: true,
        preconditionOpts: { ifGenerationMatch: 0 },
        metadata: {
          contentType: "image/webp",
          cacheControl: "public, max-age=31536000, immutable",
          metadata: { kind: "carta-premio", uploadedBy: uid },
        },
      });
    }
    expect(memoryBucket.objects.size).toBe(3);
  });

  it("acepta PNG y WebP además de JPEG", async () => {
    const png = await subir("Bearer club", await imagen(1744, 1182, "png"), {
      filename: "carta.png",
      contentType: "image/png",
    });
    const webp = await subir("Bearer club", await imagen(800, 800, "webp"), {
      filename: "carta.webp",
      contentType: "image/webp",
    });
    expect(png.status).toBe(201);
    expect(webp.status).toBe(201);
  });

  it("sin sesión 401 y para clientes 403, sin subir nada", async () => {
    const anonimo = await request(app)
      .post(UPLOAD)
      .attach("imagen", await imagen(1000, 678), { filename: "carta.jpg", contentType: "image/jpeg" });
    expect(anonimo.status).toBe(401);

    const cliente = await subir("Bearer socio1", await imagen(1000, 678));
    expect(cliente.status).toBe(403);
    expect(memoryBucket.objects.size).toBe(0);
  });

  it("400 CARD_IMAGE_INVALID por tipo, tamaño, dimensiones, archivo dañado o petición mal formada", async () => {
    const invalida = (response: { status: number; body: Record<string, unknown> }, message: string | RegExp) => {
      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({ success: false, code: "CARD_IMAGE_INVALID" });
      if (typeof message === "string") expect(response.body.message).toBe(message);
      else expect(response.body.message).toMatch(message);
    };

    invalida(
      await subir("Bearer club", await imagen(1000, 678), { field: "foto" }),
      "Selecciona una imagen JPEG, PNG o WebP para la carta.",
    );
    invalida(
      await subir("Bearer club", Buffer.from("GIF89a no permitido"), {
        filename: "carta.gif",
        contentType: "image/gif",
      }),
      /^Tipo de archivo no permitido/,
    );
    invalida(
      await subir("Bearer club", Buffer.from("esto no es una imagen"), {
        filename: "carta.png",
        contentType: "image/png",
      }),
      "La imagen de la carta debe ser JPEG, PNG o WebP.",
    );
    invalida(
      await subir("Bearer club", await imagen(300, 300)),
      /al menos 400 px por lado/,
    );
    invalida(
      await subir("Bearer club", Buffer.concat([Buffer.from("ffd8ffe0", "hex"), Buffer.alloc(4096, 3)])),
      "La imagen de la carta está dañada o no se puede leer.",
    );
    const grande = Buffer.alloc(10 * 1024 * 1024 + 1, 0);
    grande.set([0xff, 0xd8, 0xff]);
    invalida(await subir("Bearer club", grande), /excede el límite de 10MB/);

    const dos = await request(app)
      .post(UPLOAD)
      .set("Authorization", "Bearer club")
      .attach("imagen", await imagen(1000, 678), { filename: "a.jpg", contentType: "image/jpeg" })
      .attach("imagen", await imagen(1000, 678), { filename: "b.jpg", contentType: "image/jpeg" });
    invalida(dos, "Máximo 1 imágenes por solicitud");

    const json = await request(app)
      .post(UPLOAD)
      .set("Authorization", "Bearer club")
      .send({ imagen: "https://example.com/carta.jpg" });
    invalida(json, "Content-Type inválido. Se requiere multipart/form-data");

    expect(memoryBucket.objects.size).toBe(0);
  });

  it("503 en el servidor local sin emulador de Storage", async () => {
    process.env.IS_LOCAL = "true";
    const response = await subir("Bearer club", await imagen(1000, 678));
    expect(response.status).toBe(503);
    expect(response.body).toMatchObject({
      success: false,
      code: "CARD_IMAGE_STORAGE_UNAVAILABLE",
      message: expect.stringContaining("FIREBASE_STORAGE_EMULATOR_HOST"),
    });
    expect(memoryBucket.objects.size).toBe(0);

    process.env.FIREBASE_STORAGE_EMULATOR_HOST = "127.0.0.1:9199";
    const local = await subir("Bearer club", await imagen(1000, 678));
    expect(local.status).toBe(201);
    expect(local.body.data.url).toBe(
      `http://127.0.0.1:9199/${MEMORY_BUCKET_NAME}/${local.body.data.path}`,
    );
  });

  it("500 genérico si Storage falla al guardar", async () => {
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    jest.spyOn(memoryBucket, "file").mockImplementationOnce(
      () =>
        ({
          save: async () => {
            throw new Error("Storage caído");
          },
        }) as never,
    );
    const response = await subir("Bearer club", await imagen(1000, 678));
    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      success: false,
      code: "INTERNAL_ERROR",
      message: "No pudimos subir la imagen de la carta. Intenta de nuevo.",
    });
  });

  it("borra los temporales del multipart al terminar, con éxito o con error", async () => {
    const antes = await temporalesMultipart();
    expect((await subir("Bearer club", await imagen(1000, 678))).status).toBe(201);
    expect((await subir("Bearer club", await imagen(300, 300))).status).toBe(400);
    const nuevos = [...(await temporalesMultipart())].filter((name) => !antes.has(name));
    expect(nuevos).toEqual([]);
  });
});

describe("flujo completo por HTTP: subir, guardar, jugar y conservar la carta", () => {
  type Premio = { id: string; especial?: boolean; cartaImagenUrl?: string; probabilidad: number };

  function minijuegoPayload(premios: Array<Record<string, unknown>>) {
    return {
      beneficio: { titulo: "Sobre sorpresa", descripcion: "Abre y gana", estatus: true },
      minijuego: {
        tipo: "sobre",
        intentosPorUsuario: 1,
        audiencia: { visibilidad: "publico", usuariosPermitidos: [] },
      },
      premios,
    };
  }

  it("la carta viaja del panel a la jugada y a mis beneficios, y queda fija para cada ganador", async () => {
    const subidaA = await subir("Bearer club", await imagen(1000, 678));
    const urlA = subidaA.body.data.url as string;

    // Puntos en 0 %: guardado pero deshabilitado; el especial siempre sale.
    const creado = await request(app)
      .post("/api/beneficios/minijuego")
      .set("Authorization", "Bearer club")
      .send(
        minijuegoPayload([
          { nombre: "10 puntos", tipo: "points", valor: 10, probabilidad: 0 },
          {
            nombre: "VUELO EN GLOBO",
            tipo: "physical",
            stock: 2,
            maxGanadores: 2,
            especial: true,
            probabilidad: 100,
            cartaImagenUrl: urlA,
          },
        ]),
      );
    expect(creado.status).toBe(201);
    const beneficioId = creado.body.data.id as string;
    const minijuegoId = creado.body.data.minijuegoId as string;
    const premios = creado.body.data.minijuego.premios as Premio[];
    const especial = premios.find((premio) => premio.especial)!;
    const puntos = premios.find((premio) => !premio.especial)!;
    expect(especial.cartaImagenUrl).toBe(urlA);
    expect(puntos).not.toHaveProperty("cartaImagenUrl");
    expect(puntos.probabilidad).toBe(0);

    const admin = await request(app)
      .get(`/api/beneficios/${beneficioId}?admin=1`)
      .set("Authorization", "Bearer club");
    expect(admin.status).toBe(200);
    expect(
      (admin.body.data.minijuego.premios as Premio[]).find((premio) => premio.especial)?.cartaImagenUrl,
    ).toBe(urlA);

    // La ruleta solo muestra lo que puede salir.
    const detalle = await request(app)
      .get(`/api/minijuegos/${minijuegoId}`)
      .set("Authorization", "Bearer socio1");
    expect(detalle.status).toBe(200);
    expect(detalle.body.data.premiosDisponibles).toBe(true);
    expect(detalle.body.data.segments.map((segment: { id: string }) => segment.id)).toEqual([especial.id]);

    const jugadaA = await request(app)
      .post(`/api/minijuegos/${minijuegoId}/play`)
      .set("Authorization", "Bearer socio1")
      .set("Idempotency-Key", "jugada-socio-1");
    expect(jugadaA.status).toBe(200);
    expect(jugadaA.body.data).toMatchObject({
      prizeId: especial.id,
      cartaImagenUrl: urlA,
      cartaDiseno: "personalizada",
    });

    // El staff cambia el arte a B (mismo premio especial).
    const urlB = (await subir("Bearer club", await imagen(800, 800))).body.data.url as string;
    const editado = await request(app)
      .put(`/api/beneficios/${beneficioId}/minijuego`)
      .set("Authorization", "Bearer club")
      .send(
        minijuegoPayload([
          { id: puntos.id, nombre: "10 puntos", tipo: "points", valor: 10, probabilidad: 0 },
          {
            id: especial.id,
            nombre: "VUELO EN GLOBO",
            tipo: "physical",
            stock: 2,
            maxGanadores: 2,
            especial: true,
            probabilidad: 100,
            cartaImagenUrl: urlB,
          },
        ]),
      );
    expect(editado.status).toBe(200);

    const jugadaB = await request(app)
      .post(`/api/minijuegos/${minijuegoId}/play`)
      .set("Authorization", "Bearer socio2")
      .set("Idempotency-Key", "jugada-socio-2");
    expect(jugadaB.body.data).toMatchObject({ cartaImagenUrl: urlB, cartaDiseno: "personalizada" });

    const misA = await request(app)
      .get("/api/minijuegos/me/beneficios")
      .set("Authorization", "Bearer socio1");
    const misB = await request(app)
      .get("/api/minijuegos/me/beneficios")
      .set("Authorization", "Bearer socio2");
    expect(misA.body.data).toEqual([
      expect.objectContaining({ cartaImagenUrl: urlA, cartaDiseno: "personalizada" }),
    ]);
    expect(misB.body.data).toEqual([
      expect.objectContaining({ cartaImagenUrl: urlB, cartaDiseno: "personalizada" }),
    ]);

    // Especial agotado y puntos en 0 %: sin premios disponibles, 409 y sin
    // gastar el intento.
    const sinPremios = await request(app)
      .get(`/api/minijuegos/${minijuegoId}`)
      .set("Authorization", "Bearer socio3");
    expect(sinPremios.body.data).toMatchObject({ premiosDisponibles: false, segments: [] });
    const rechazada = await request(app)
      .post(`/api/minijuegos/${minijuegoId}/play`)
      .set("Authorization", "Bearer socio3")
      .set("Idempotency-Key", "jugada-socio-3");
    expect(rechazada.status).toBe(409);
    expect(rechazada.body).toMatchObject({ success: false, code: "MINIGAME_NO_PRIZES" });
    const despues = await request(app)
      .get(`/api/minijuegos/${minijuegoId}`)
      .set("Authorization", "Bearer socio3");
    expect(despues.body.data).toMatchObject({ intentosUsados: 0, intentosRestantes: 1 });

    // Las cartas subidas nunca se borraron.
    expect(memoryBucket.deleted).toEqual([]);
  });

  it("rechaza la carta en un premio no especial (zod) y una URL ajena al guardar", async () => {
    const url = (await subir("Bearer club", await imagen(1000, 678))).body.data.url as string;

    const noEspecial = await request(app)
      .post("/api/beneficios/minijuego")
      .set("Authorization", "Bearer club")
      .send(
        minijuegoPayload([
          { nombre: "10 puntos", tipo: "points", valor: 10, probabilidad: 99, cartaImagenUrl: url },
          { nombre: "Playera", tipo: "physical", stock: 1, especial: true, probabilidad: 1 },
        ]),
      );
    expect(noEspecial.status).toBe(400);
    expect(noEspecial.body.errors).toEqual([
      expect.objectContaining({
        campo: "premios.0.cartaImagenUrl",
        mensaje: "Solo el premio especial puede tener carta coleccionable.",
      }),
    ]);

    const ajena = await request(app)
      .post("/api/beneficios/minijuego")
      .set("Authorization", "Bearer club")
      .send(
        minijuegoPayload([
          { nombre: "10 puntos", tipo: "points", valor: 10, probabilidad: 99 },
          {
            nombre: "Playera",
            tipo: "physical",
            stock: 1,
            especial: true,
            probabilidad: 1,
            cartaImagenUrl: "https://example.com/carta.webp",
          },
        ]),
      );
    expect(ajena.status).toBe(400);
    expect(ajena.body).toMatchObject({ success: false, code: "MINIGAME_INVALID_PRIZE" });
    expect(memoryFirestore.list("minijuegos")).toEqual([]);
  });
});
