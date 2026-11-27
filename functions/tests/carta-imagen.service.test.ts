import { createHash } from "crypto";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import sharp from "sharp";
import { MEMORY_BUCKET_NAME, memoryBucket } from "./helpers/memory-storage";

// file-type es solo ESM y jest no lo puede cargar (en Node 22 se carga con
// require(esm); ver ai.upload-validator.test.ts). Este doble reconoce los
// mismos bytes mágicos que file-type para los formatos de estas pruebas.
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
      if (bytes.toString("latin1", 0, 4) === "GIF8") {
        return { ext: "gif", mime: "image/gif" };
      }
      return undefined;
    },
  }),
  { virtual: true },
);

jest.mock("../src/config/app.firebase", () => {
  const { memoryStorage } =
    require("./helpers/memory-storage") as typeof import("./helpers/memory-storage");
  return {
    firestoreApp: {},
    appOficial: {},
    storageAppOficial: memoryStorage,
  };
});

import {
  CARTA_IMAGEN_CACHE_CONTROL,
  CARTA_IMAGEN_HEIGHT,
  CARTA_IMAGEN_MAX_BYTES,
  CARTA_IMAGEN_WIDTH,
  CartaImagenError,
  assertCartaImagenStorageAvailable,
  cartaImagenAjuste,
  checkCartaImagenUrl,
  isProtectedCartaImagenPath,
  normalizeCartaImagen,
  parseCartaImagenUrl,
  readStorageEmulatorHost,
  resolveCartaImagenPublicBase,
  subirCartaImagen,
  uploadCartaImagen,
} from "../src/services/carta-imagen.service";
import storageAppService from "../src/services/storageApp.service";

jest.setTimeout(120_000);

const UUID = "0b6e4c1e-8f7a-4c2d-9b3e-1a2b3c4d5e6f";
const PROD_BASE = "https://storage.googleapis.com";
const LOCAL_BASE = "http://127.0.0.1:9199";
const PROD = { publicBase: PROD_BASE, bucket: MEMORY_BUCKET_NAME };
const UUID_V4_PATH =
  /^minijuegos\/cartas\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.webp$/;

const ROJO = { r: 255, g: 0, b: 0 };
const AZUL = { r: 0, g: 0, b: 255 };
const VERDE = { r: 0, g: 255, b: 0 };
const AMARILLO = { r: 255, g: 255, b: 0 };
const FONDO_TRANSPARENCIA = [0x0d, 0x33, 0x26] as const;

type Rgb = { r: number; g: number; b: number };

function cartaPath(uuid = UUID): string {
  return `minijuegos/cartas/${uuid}.webp`;
}

function cartaUrl(base = PROD_BASE, uuid = UUID): string {
  return `${base}/${MEMORY_BUCKET_NAME}/${cartaPath(uuid)}`;
}

async function solid(
  width: number,
  height: number,
  background: Rgb,
  format: "png" | "jpeg" | "webp" | "gif" = "png",
): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background } })
    .toFormat(format)
    .toBuffer();
}

/**
 * Mitad izquierda roja y derecha azul, con una franja verde arriba y una
 * amarilla abajo: permite comprobar que no se recorta ni se deforma.
 */
async function mitades(
  width: number,
  height: number,
  options: { franja?: number; format?: "png" | "jpeg" | "webp"; orientation?: number } = {},
): Promise<Buffer> {
  const franja = options.franja ?? 0;
  const layers: sharp.OverlayOptions[] = [
    {
      input: await solid(Math.floor(width / 2), height, ROJO),
      left: 0,
      top: 0,
    },
  ];
  if (franja > 0) {
    layers.push(
      { input: await solid(width, franja, VERDE), left: 0, top: 0 },
      { input: await solid(width, franja, AMARILLO), left: 0, top: height - franja },
    );
  }
  let image = sharp({ create: { width, height, channels: 3, background: AZUL } })
    .composite(layers)
    .toFormat(options.format ?? "png");
  if (options.orientation) image = image.withMetadata({ orientation: options.orientation });
  return image.toBuffer();
}

async function decode(buffer: Buffer) {
  const { data, info } = await sharp(buffer).raw().toBuffer({ resolveWithObject: true });
  return {
    info,
    at(x: number, y: number): [number, number, number] {
      const offset = (y * info.width + x) * info.channels;
      return [data[offset], data[offset + 1], data[offset + 2]];
    },
  };
}

function expectColor(actual: readonly number[], expected: Rgb | readonly number[], tolerance = 40) {
  const target = Array.isArray(expected)
    ? expected
    : [(expected as Rgb).r, (expected as Rgb).g, (expected as Rgb).b];
  actual.forEach((value, index) => {
    expect(Math.abs(value - target[index])).toBeLessThanOrEqual(tolerance);
  });
}

async function expectNormalized(result: Awaited<ReturnType<typeof normalizeCartaImagen>>) {
  expect(result).toMatchObject({
    width: CARTA_IMAGEN_WIDTH,
    height: CARTA_IMAGEN_HEIGHT,
    contentType: "image/webp",
    bytes: result.buffer.length,
    sha256: createHash("sha256").update(result.buffer).digest("hex"),
  });
  const metadata = await sharp(result.buffer).metadata();
  expect(metadata).toMatchObject({
    format: "webp",
    width: 1744,
    height: 1182,
    channels: 3,
    hasAlpha: false,
  });
  // Sin metadatos: ni EXIF ni orientación.
  expect(metadata.exif).toBeUndefined();
  expect(metadata.orientation).toBeUndefined();
}

async function expectInvalid(source: Buffer | string, message: string | RegExp) {
  const error = await normalizeCartaImagen(source).then(
    () => null,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(CartaImagenError);
  expect(error).toMatchObject({ code: "CARD_IMAGE_INVALID", status: 400 });
  if (typeof message === "string") {
    expect((error as Error).message).toBe(message);
  } else {
    expect((error as Error).message).toMatch(message);
  }
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
  memoryBucket.reset();
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

describe("carta: ajuste según la proporción (tolerancia 3 %)", () => {
  it("cover hasta 3 % de 872:591 y contain más allá", () => {
    expect(cartaImagenAjuste(1744, 1182)).toBe("cover");
    expect(cartaImagenAjuste(872, 591)).toBe("cover");
    expect(cartaImagenAjuste(1000, 678)).toBe("cover");
    // 1.475465 × 1.03 = 1.5197 y × 0.97 = 1.4312
    expect(cartaImagenAjuste(1519, 1000)).toBe("cover");
    expect(cartaImagenAjuste(1521, 1000)).toBe("contain");
    expect(cartaImagenAjuste(1432, 1000)).toBe("cover");
    expect(cartaImagenAjuste(1430, 1000)).toBe("contain");
    expect(cartaImagenAjuste(1000, 1000)).toBe("contain");
    expect(cartaImagenAjuste(1920, 1080)).toBe("contain");
    expect(cartaImagenAjuste(1182, 1744)).toBe("contain");
  });
});

describe("carta: normalización real con sharp", () => {
  it("misma proporción: cover exacto a 1744 × 1182, sin recortar lo importante", async () => {
    const result = await normalizeCartaImagen(await mitades(1000, 678, { franja: 40 }));
    expect(result.ajuste).toBe("cover");
    await expectNormalized(result);

    const pixels = await decode(result.buffer);
    expectColor(pixels.at(100, 600), ROJO);
    expectColor(pixels.at(1644, 600), AZUL);
    // Las franjas de arriba y abajo siguen visibles (≈ 70 px tras escalar).
    expectColor(pixels.at(872, 20), VERDE);
    expectColor(pixels.at(872, 1160), AMARILLO);
  });

  it("también acepta JPEG y WebP de la misma proporción (cover)", async () => {
    for (const format of ["jpeg", "webp"] as const) {
      const result = await normalizeCartaImagen(await mitades(1744, 1182, { format }));
      expect(result.ajuste).toBe("cover");
      await expectNormalized(result);
    }
    // 872 × 591 (la ventana a 1×) se amplía a 2×.
    const small = await normalizeCartaImagen(await solid(872, 591, AZUL, "jpeg"));
    expect(small.ajuste).toBe("cover");
    await expectNormalized(small);
  });

  it("proporción distinta: contain centrado sobre la misma imagen difuminada y oscurecida", async () => {
    const result = await normalizeCartaImagen(await mitades(800, 800, { franja: 40 }));
    expect(result.ajuste).toBe("contain");
    await expectNormalized(result);

    const pixels = await decode(result.buffer);
    // La imagen completa queda en x = 281..1462 (1182 × 1182): sin recortes.
    expectColor(pixels.at(300, 600), ROJO);
    expectColor(pixels.at(1440, 600), AZUL);
    expectColor(pixels.at(872, 25), VERDE);
    expectColor(pixels.at(872, 1158), AMARILLO);

    // A los lados, la misma imagen en cover, difuminada y más oscura: sin
    // barras negras.
    const izquierda = pixels.at(100, 600);
    const derecha = pixels.at(1644, 600);
    expect(izquierda[0]).toBeGreaterThan(60);
    expect(izquierda[0]).toBeLessThan(215);
    expect(izquierda[0]).toBeGreaterThan(izquierda[1] + 40);
    expect(izquierda[0]).toBeGreaterThan(izquierda[2] + 40);
    expect(derecha[2]).toBeGreaterThan(60);
    expect(derecha[2]).toBeLessThan(215);
    expect(derecha[2]).toBeGreaterThan(derecha[0] + 40);
    expect(izquierda[0]).toBeLessThan(pixels.at(300, 600)[0] - 30);
  });

  it("una imagen vertical tampoco se deforma ni se recorta", async () => {
    const result = await normalizeCartaImagen(await mitades(600, 1200, { franja: 60 }));
    expect(result.ajuste).toBe("contain");
    await expectNormalized(result);
    const pixels = await decode(result.buffer);
    // 600 × 1200 → 591 × 1182 centrada (x = 576..1166).
    expectColor(pixels.at(872, 15), VERDE);
    expectColor(pixels.at(872, 1168), AMARILLO);
    expectColor(pixels.at(600, 600), ROJO);
    expectColor(pixels.at(1140, 600), AZUL);
  });

  it("aplana la transparencia sobre #0D3326", async () => {
    const transparente = await sharp({
      create: { width: 1000, height: 678, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 0 } },
    })
      .composite([{ input: await solid(200, 200, { r: 255, g: 255, b: 255 }), left: 400, top: 239 }])
      .png()
      .toBuffer();

    const result = await normalizeCartaImagen(transparente);
    expect(result.ajuste).toBe("cover");
    await expectNormalized(result);
    const pixels = await decode(result.buffer);
    expectColor(pixels.at(20, 20), FONDO_TRANSPARENCIA, 12);
    expectColor(pixels.at(1720, 1160), FONDO_TRANSPARENCIA, 12);
    expectColor(pixels.at(872, 591), [255, 255, 255], 12);
  });

  it("aplica la orientación EXIF antes de decidir el ajuste y quita los metadatos", async () => {
    // Guardada en horizontal (rojo a la izquierda) con orientación 6: se ve
    // vertical, con el rojo arriba y el azul abajo.
    const input = await mitades(1000, 678, { format: "jpeg", orientation: 6 });
    expect((await sharp(input).metadata()).orientation).toBe(6);

    const result = await normalizeCartaImagen(input);
    expect(result.ajuste).toBe("contain");
    await expectNormalized(result);
    const pixels = await decode(result.buffer);
    expectColor(pixels.at(872, 150), ROJO);
    expectColor(pixels.at(872, 1030), AZUL);
  });

  it("acepta la ruta del temporal que deja el multipart", async () => {
    const filePath = path.join(os.tmpdir(), `carta-prueba-${process.pid}-${Date.now()}.png`);
    await fs.writeFile(filePath, await mitades(1744, 1182));
    try {
      const result = await normalizeCartaImagen(filePath);
      expect(result.ajuste).toBe("cover");
      await expectNormalized(result);
    } finally {
      await fs.unlink(filePath).catch(() => undefined);
    }
  });

  it("rechaza imágenes demasiado chicas (menos de 400 px por lado)", async () => {
    const message =
      "La imagen de la carta debe medir al menos 400 px por lado. Recomendado: 1744 × 1182 px (horizontal, proporción 1.48:1).";
    await expectInvalid(await solid(399, 1000, ROJO), message);
    await expectInvalid(await solid(1000, 399, ROJO, "jpeg"), message);
    await expectInvalid(await solid(300, 200, ROJO, "webp"), message);
    // 400 × 400 sí se acepta.
    const minimo = await normalizeCartaImagen(await solid(400, 400, ROJO));
    expect(minimo.ajuste).toBe("contain");
    await expectNormalized(minimo);
  });

  it("rechaza bytes que no son imagen, formatos no permitidos y archivos vacíos", async () => {
    const tipo = "La imagen de la carta debe ser JPEG, PNG o WebP.";
    await expectInvalid(Buffer.from("esto no es una imagen, aunque se llame carta.png"), tipo);
    await expectInvalid(Buffer.from("%PDF-1.7\n%âãÏÓ\n1 0 obj"), tipo);
    await expectInvalid(await solid(800, 600, ROJO, "gif"), tipo);
    await expectInvalid(Buffer.alloc(0), "Selecciona una imagen para la carta.");
  });

  it("rechaza archivos dañados aunque empiecen como imagen", async () => {
    const danada = "La imagen de la carta está dañada o no se puede leer.";
    const pngMagic = Buffer.from("89504e470d0a1a0a", "hex");
    await expectInvalid(Buffer.concat([pngMagic, Buffer.alloc(2048, 7)]), danada);

    const ruido = await sharp(Buffer.alloc(1000 * 678 * 3).map((_, index) => (index * 7919) % 251), {
      raw: { width: 1000, height: 678, channels: 3 },
    })
      .jpeg({ quality: 95 })
      .toBuffer();
    await expectInvalid(ruido.subarray(0, Math.floor(ruido.length / 2)), danada);
  });

  it("rechaza más de 10 MB sin procesarla", async () => {
    const grande = Buffer.alloc(CARTA_IMAGEN_MAX_BYTES + 1, 0);
    grande[0] = 0xff;
    grande[1] = 0xd8;
    grande[2] = 0xff;
    await expectInvalid(grande, "La imagen de la carta no puede pesar más de 10 MB.");
  });

  it("rechaza más de 40 megapíxeles", async () => {
    const enorme = await sharp({
      create: { width: 8000, height: 5001, channels: 3, background: ROJO },
    })
      .jpeg({ quality: 40 })
      .toBuffer();
    expect(enorme.length).toBeLessThan(CARTA_IMAGEN_MAX_BYTES);
    await expectInvalid(enorme, "La imagen de la carta es demasiado grande: máximo 40 megapíxeles.");
  });
});

describe("carta: URL pública estricta", () => {
  it("acepta solo <publicBase>/<bucket>/minijuegos/cartas/<uuid v4>.webp", () => {
    expect(parseCartaImagenUrl(cartaUrl(), PROD)).toEqual({ path: cartaPath() });
    expect(
      parseCartaImagenUrl(cartaUrl(), { publicBase: `${PROD_BASE}/`, bucket: MEMORY_BUCKET_NAME }),
    ).toEqual({ path: cartaPath() });
    expect(
      parseCartaImagenUrl(cartaUrl(LOCAL_BASE), { publicBase: LOCAL_BASE, bucket: MEMORY_BUCKET_NAME }),
    ).toEqual({ path: cartaPath() });

    const invalidas: unknown[] = [
      `${cartaUrl()}?alt=media`,
      `${cartaUrl()}#carta`,
      `${cartaUrl()}/`,
      ` ${cartaUrl()}`,
      cartaUrl(LOCAL_BASE),
      `http://storage.googleapis.com/${MEMORY_BUCKET_NAME}/${cartaPath()}`,
      `${PROD_BASE}/otro-bucket/${cartaPath()}`,
      `${PROD_BASE}/app-oficial-leonXfirebasestorage.app/${cartaPath()}`,
      `${PROD_BASE}/${MEMORY_BUCKET_NAME}/beneficios/${UUID}.webp`,
      `${PROD_BASE}/${MEMORY_BUCKET_NAME}/minijuegos/cartas/sub/${UUID}.webp`,
      `${PROD_BASE}/${MEMORY_BUCKET_NAME}/minijuegos/cartas/../cartas/${UUID}.webp`,
      `${PROD_BASE}/${MEMORY_BUCKET_NAME}/minijuegos/cartas/${UUID}.png`,
      `${PROD_BASE}/${MEMORY_BUCKET_NAME}/minijuegos/cartas/${UUID.toUpperCase()}.webp`,
      // uuid v1 (no v4)
      `${PROD_BASE}/${MEMORY_BUCKET_NAME}/minijuegos/cartas/0b6e4c1e-8f7a-1c2d-9b3e-1a2b3c4d5e6f.webp`,
      `${PROD_BASE}/${MEMORY_BUCKET_NAME}/minijuegos/cartas/carta.webp`,
      `https://firebasestorage.googleapis.com/v0/b/${MEMORY_BUCKET_NAME}/o/minijuegos%2Fcartas%2F${UUID}.webp?alt=media`,
      `${cartaUrl()}${"x".repeat(2048)}`,
      "",
      null,
      undefined,
      42,
    ];
    for (const value of invalidas) {
      expect(parseCartaImagenUrl(value, PROD)).toBeNull();
    }
    expect(parseCartaImagenUrl(cartaUrl(), { publicBase: "", bucket: MEMORY_BUCKET_NAME })).toBeNull();
    expect(parseCartaImagenUrl(cartaUrl(), { publicBase: PROD_BASE, bucket: " " })).toBeNull();
  });

  it("publicBase: GCS en producción, http://<host> con el emulador", () => {
    expect(resolveCartaImagenPublicBase({})).toBe(PROD_BASE);
    expect(resolveCartaImagenPublicBase({ FIREBASE_STORAGE_EMULATOR_HOST: "127.0.0.1:9199" })).toBe(
      LOCAL_BASE,
    );
    expect(resolveCartaImagenPublicBase({ STORAGE_EMULATOR_HOST: "http://localhost:9199/" })).toBe(
      "http://localhost:9199",
    );
    expect(
      resolveCartaImagenPublicBase({
        FIREBASE_STORAGE_EMULATOR_HOST: "127.0.0.1:9199",
        STORAGE_EMULATOR_HOST: "http://otro:1",
      }),
    ).toBe(LOCAL_BASE);
    expect(readStorageEmulatorHost({ FIREBASE_STORAGE_EMULATOR_HOST: "  " })).toBeNull();
  });

  it("checkCartaImagenUrl: formato exacto y objeto existente", async () => {
    expect(await checkCartaImagenUrl(cartaUrl(), {})).toEqual({ ok: false, reason: "missing" });
    memoryBucket.put(cartaPath());
    expect(await checkCartaImagenUrl(cartaUrl(), {})).toEqual({ ok: true, path: cartaPath() });
    expect(await checkCartaImagenUrl(`${cartaUrl()}?v=2`, {})).toEqual({ ok: false, reason: "invalid" });

    // Sin respuesta de Storage no se da por buena.
    memoryBucket.setFailExists(true);
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await checkCartaImagenUrl(cartaUrl(), {})).toEqual({ ok: false, reason: "unavailable" });
    memoryBucket.setFailExists(false);

    // Local sin emulador: no se consulta el bucket de producción.
    expect(await checkCartaImagenUrl(cartaUrl(), { IS_LOCAL: "true" })).toEqual({
      ok: false,
      reason: "unavailable",
    });
    // Con el emulador solo vale la URL del emulador.
    const local = { IS_LOCAL: "true", FIREBASE_STORAGE_EMULATOR_HOST: "127.0.0.1:9199" };
    expect(await checkCartaImagenUrl(cartaUrl(LOCAL_BASE), local)).toEqual({ ok: true, path: cartaPath() });
    expect(await checkCartaImagenUrl(cartaUrl(), local)).toEqual({ ok: false, reason: "invalid" });
  });
});

describe("carta: guard de Storage", () => {
  const sinEmulador = {
    code: "CARD_IMAGE_STORAGE_UNAVAILABLE",
    status: 503,
  };

  it("en local exige el emulador de Storage", () => {
    expect(() => assertCartaImagenStorageAvailable({ IS_LOCAL: "true" })).toThrow(
      expect.objectContaining({
        ...sinEmulador,
        message: expect.stringContaining("FIREBASE_STORAGE_EMULATOR_HOST=127.0.0.1:9199"),
      }),
    );
    expect(() =>
      assertCartaImagenStorageAvailable({ IS_LOCAL: "true", FIREBASE_STORAGE_EMULATOR_HOST: "127.0.0.1:9199" }),
    ).not.toThrow();
    expect(() =>
      assertCartaImagenStorageAvailable({ IS_LOCAL: "true", STORAGE_EMULATOR_HOST: "http://127.0.0.1:9199" }),
    ).not.toThrow();
  });

  it("en Cloud Functions no acepta variables de emulador", () => {
    expect(() => assertCartaImagenStorageAvailable({ K_SERVICE: "api" })).not.toThrow();
    expect(() => assertCartaImagenStorageAvailable({ FUNCTION_NAME: "api" })).not.toThrow();
    expect(() =>
      assertCartaImagenStorageAvailable({ K_SERVICE: "api", FIREBASE_STORAGE_EMULATOR_HOST: "127.0.0.1:9199" }),
    ).toThrow(expect.objectContaining(sinEmulador));
    expect(() =>
      assertCartaImagenStorageAvailable({ FUNCTION_NAME: "api", STORAGE_EMULATOR_HOST: "http://127.0.0.1:9199" }),
    ).toThrow(expect.objectContaining(sinEmulador));
  });
});

describe("carta: subida inmutable a minijuegos/cartas/", () => {
  it("guarda el WebP en una ruta nueva con las opciones del contrato", async () => {
    const result = await subirCartaImagen(
      { source: await mitades(1000, 678), uploadedBy: "staff-1" },
      {},
    );

    expect(result.path).toMatch(UUID_V4_PATH);
    expect(result).toEqual({
      url: `${PROD_BASE}/${MEMORY_BUCKET_NAME}/${result.path}`,
      path: result.path,
      width: 1744,
      height: 1182,
      bytes: expect.any(Number),
    });
    expect(parseCartaImagenUrl(result.url, PROD)).toEqual({ path: result.path });

    const stored = memoryBucket.objects.get(result.path);
    expect(stored).toBeDefined();
    const sha256 = createHash("sha256").update(stored!.data).digest("hex");
    expect(stored!.data.length).toBe(result.bytes);
    expect(stored!.options).toEqual({
      resumable: false,
      public: true,
      preconditionOpts: { ifGenerationMatch: 0 },
      metadata: {
        contentType: "image/webp",
        cacheControl: CARTA_IMAGEN_CACHE_CONTROL,
        metadata: { kind: "carta-premio", uploadedBy: "staff-1", sha256 },
      },
    });
    expect(CARTA_IMAGEN_CACHE_CONTROL).toBe("public, max-age=31536000, immutable");
    expect(await sharp(stored!.data).metadata()).toMatchObject({
      format: "webp",
      width: 1744,
      height: 1182,
    });
    expect(await checkCartaImagenUrl(result.url, {})).toEqual({ ok: true, path: result.path });
  });

  it("cada subida usa una ruta distinta y nunca sobrescribe ni borra", async () => {
    const imagen = await normalizeCartaImagen(await mitades(1744, 1182));
    const first = await uploadCartaImagen(imagen, { uploadedBy: "staff-1" }, {});
    const second = await uploadCartaImagen(imagen, { uploadedBy: "staff-2" }, {});
    expect(first.path).not.toBe(second.path);
    expect([...memoryBucket.objects.keys()].sort()).toEqual([first.path, second.path].sort());
    expect(memoryBucket.deleted).toEqual([]);

    // Si la ruta ya existiera, la precondición ifGenerationMatch: 0 lo impide.
    const ocupado = memoryBucket.file(first.path);
    await expect(
      ocupado.save(Buffer.from("otra"), { preconditionOpts: { ifGenerationMatch: 0 } }),
    ).rejects.toMatchObject({ code: 412 });
    expect(memoryBucket.objects.get(first.path)?.data.equals(imagen.buffer)).toBe(true);
  });

  it("con el emulador devuelve la URL del emulador", async () => {
    const env = { IS_LOCAL: "true", FIREBASE_STORAGE_EMULATOR_HOST: "127.0.0.1:9199" };
    const result = await subirCartaImagen(
      { source: await mitades(1744, 1182), uploadedBy: "staff-1" },
      env,
    );
    expect(result.url).toBe(`${LOCAL_BASE}/${MEMORY_BUCKET_NAME}/${result.path}`);
    expect(await checkCartaImagenUrl(result.url, env)).toEqual({ ok: true, path: result.path });
  });

  it("en local sin emulador responde 503 antes de procesar y no escribe nada", async () => {
    // Bytes inválidos: si se procesaran, el error sería 400.
    await expect(
      subirCartaImagen({ source: Buffer.from("no es imagen"), uploadedBy: "staff-1" }, { IS_LOCAL: "true" }),
    ).rejects.toMatchObject({ code: "CARD_IMAGE_STORAGE_UNAVAILABLE", status: 503 });
    const imagen = await normalizeCartaImagen(await mitades(1744, 1182));
    await expect(
      uploadCartaImagen(imagen, { uploadedBy: "staff-1" }, { IS_LOCAL: "true" }),
    ).rejects.toMatchObject({ code: "CARD_IMAGE_STORAGE_UNAVAILABLE", status: 503 });
    expect(memoryBucket.objects.size).toBe(0);
  });
});

describe("carta: nunca se borra de Storage", () => {
  it("isProtectedCartaImagenPath reconoce el prefijo minijuegos/cartas/", () => {
    for (const objectPath of [
      cartaPath(),
      `/${cartaPath()}`,
      `minijuegos//cartas/${UUID}.webp`,
      `MINIJUEGOS/Cartas/${UUID}.webp`,
      `minijuegos\\cartas\\${UUID}.webp`,
    ]) {
      expect(isProtectedCartaImagenPath(objectPath)).toBe(true);
    }
    for (const objectPath of [
      "beneficios/foto.jpg",
      "minijuegos/premios/foto.jpg",
      "minijuegos/cartas-viejas/foto.webp",
      "noticias/minijuegos/cartas/foto.webp",
    ]) {
      expect(isProtectedCartaImagenPath(objectPath)).toBe(false);
    }
  });

  it("storageApp.deleteFile se niega a borrar cartas y sigue borrando la otra media", async () => {
    jest.spyOn(console, "warn").mockImplementation(() => undefined);
    jest.spyOn(console, "log").mockImplementation(() => undefined);
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    memoryBucket.put(cartaPath());
    memoryBucket.put("beneficios/foto.jpg");
    memoryBucket.put("beneficios/otra.jpg");

    await expect(storageAppService.deleteFile(cartaUrl())).rejects.toThrow(
      "Las imágenes de cartas coleccionables no se pueden borrar",
    );
    await expect(
      storageAppService.deleteFile(
        `${PROD_BASE}/${MEMORY_BUCKET_NAME}/minijuegos%2Fcartas%2F${UUID}.webp`,
      ),
    ).rejects.toThrow("Las imágenes de cartas coleccionables no se pueden borrar");

    await storageAppService.deleteFile(`${PROD_BASE}/${MEMORY_BUCKET_NAME}/beneficios/foto.jpg`);
    await storageAppService.deleteMultipleFiles([
      cartaUrl(),
      `${PROD_BASE}/${MEMORY_BUCKET_NAME}/beneficios/otra.jpg`,
    ]);
    // deleteMultipleFiles usa Promise.all: la otra media termina en paralelo.
    await new Promise((resolve) => setImmediate(resolve));

    expect(memoryBucket.objects.has(cartaPath())).toBe(true);
    expect(memoryBucket.deleted.sort()).toEqual(["beneficios/foto.jpg", "beneficios/otra.jpg"]);
  });
});
