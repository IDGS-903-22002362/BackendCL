import { createHash, randomUUID } from "crypto";
import { promises as fs } from "fs";
import sharp from "sharp";
import { storageAppOficial } from "../config/app.firebase";

/**
 * Arte de la carta coleccionable del premio especial.
 *
 * Es la ilustración que va dentro de la ventana ART de la cara dorada de la
 * carta (872 × 591 px en la plantilla de 1018 × 1416). El servidor la
 * normaliza siempre a 1744 × 1182 px (el doble de la ventana), WebP opaco y
 * sin metadatos, para que la app solo tenga que hacer un cover exacto.
 *
 * Los archivos viven en el bucket de la media de beneficios (APP_OFICIAL)
 * bajo minijuegos/cartas/<uuid>.webp y son inmutables: cada subida usa una
 * ruta nueva, nunca se sobrescriben (ifGenerationMatch: 0) y nunca se borran,
 * porque las jugadas y los ganadores guardan su URL.
 */

export const CARTA_IMAGEN_WIDTH = 1744;
export const CARTA_IMAGEN_HEIGHT = 1182;
export const CARTA_IMAGEN_MAX_BYTES = 10 * 1024 * 1024;
export const CARTA_IMAGEN_MIN_SIDE = 400;
export const CARTA_IMAGEN_MAX_INPUT_PIXELS = 40_000_000;
/** Diferencia relativa de proporción hasta la que se recorta (cover). */
export const CARTA_IMAGEN_COVER_TOLERANCE = 0.03;
export const CARTA_IMAGEN_PREFIX = "minijuegos/cartas/";
/** Verde oscuro sobre el que se aplana la transparencia. */
export const CARTA_IMAGEN_FONDO = "#0D3326";
export const CARTA_IMAGEN_CACHE_CONTROL = "public, max-age=31536000, immutable";
export const CARTA_IMAGEN_KIND = "carta-premio";
export const CARTA_IMAGEN_ALLOWED_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;
export const CARTA_IMAGEN_PRODUCTION_PUBLIC_BASE = "https://storage.googleapis.com";

const BLUR_SIGMA = 24;
const BRILLO_FONDO = 0.55;
const WEBP_QUALITY = 86;
const FILE_TYPE_HEADER_BYTES = 4100;
const UUID_V4_PATTERN =
  "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const SHARP_FORMAT_MIME: Record<string, string> = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

export class CartaImagenError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number, message: string) {
    super(message);
    this.name = "CartaImagenError";
    this.code = code;
    this.status = status;
  }
}

function invalidImage(message: string): CartaImagenError {
  return new CartaImagenError("CARD_IMAGE_INVALID", 400, message);
}

// ---------------------------------------------------------------------------
// Destino de Storage y guard local
// ---------------------------------------------------------------------------

function isCloudFunction(env: NodeJS.ProcessEnv): boolean {
  return Boolean(env.FUNCTION_NAME || env.K_SERVICE);
}

/** host:puerto del emulador de Storage (sin protocolo), o null. */
export function readStorageEmulatorHost(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const raw =
    (env.FIREBASE_STORAGE_EMULATOR_HOST ?? "").trim() ||
    (env.STORAGE_EMULATOR_HOST ?? "").trim();
  if (!raw) return null;
  const host = raw.replace(/^https?:\/\//i, "").replace(/\/+$/, "");
  return host || null;
}

/**
 * Origen de las URL públicas de las cartas, sin barra final:
 * https://storage.googleapis.com contra GCS y http://<host> con el emulador.
 */
export function resolveCartaImagenPublicBase(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const emulatorHost = readStorageEmulatorHost(env);
  return emulatorHost
    ? `http://${emulatorHost}`
    : CARTA_IMAGEN_PRODUCTION_PUBLIC_BASE;
}

/**
 * Guard de Storage para las cartas.
 *
 * - Servidor local (IS_LOCAL=true): solo contra el emulador de Storage
 *   (FIREBASE_STORAGE_EMULATOR_HOST o STORAGE_EMULATOR_HOST). Sin emulador
 *   responde 503 en lugar de escribir en el bucket de producción.
 * - Cloud Functions: esas variables no deben existir; si existen, 503.
 */
export function assertCartaImagenStorageAvailable(
  env: NodeJS.ProcessEnv = process.env,
): void {
  const emulatorHost = readStorageEmulatorHost(env);

  if (isCloudFunction(env)) {
    if (emulatorHost) {
      throw new CartaImagenError(
        "CARD_IMAGE_STORAGE_UNAVAILABLE",
        503,
        "Storage no está configurado correctamente en el servidor. Intenta más tarde.",
      );
    }
    return;
  }

  if (env.IS_LOCAL === "true" && !emulatorHost) {
    throw new CartaImagenError(
      "CARD_IMAGE_STORAGE_UNAVAILABLE",
      503,
      "El servidor local no sube imágenes a Storage de producción. Arranca el emulador de Storage y define FIREBASE_STORAGE_EMULATOR_HOST=127.0.0.1:9199.",
    );
  }
}

function cartaImagenBucket() {
  return storageAppOficial.bucket();
}

// ---------------------------------------------------------------------------
// URL pública
// ---------------------------------------------------------------------------

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Valida que la URL sea EXACTAMENTE la de una carta subida por el backend:
 * `<publicBase>/<bucket>/minijuegos/cartas/<uuid v4>.webp`, sin query string,
 * fragmento ni nada más. Devuelve la ruta del objeto o null.
 */
export function parseCartaImagenUrl(
  value: unknown,
  target: { publicBase: string; bucket: string },
): { path: string } | null {
  if (typeof value !== "string" || value.length === 0 || value.length > 2048) {
    return null;
  }
  const publicBase = target.publicBase.replace(/\/+$/, "");
  const bucket = target.bucket.trim();
  if (!publicBase || !bucket) return null;

  const pattern = new RegExp(
    `^${escapeRegExp(publicBase)}/${escapeRegExp(bucket)}/(${escapeRegExp(
      CARTA_IMAGEN_PREFIX,
    )}${UUID_V4_PATTERN}\\.webp)$`,
  );
  const match = pattern.exec(value);
  return match ? { path: match[1] } : null;
}

/** true si la ruta de un objeto cae en minijuegos/cartas/ (nunca se borra). */
export function isProtectedCartaImagenPath(objectPath: string): boolean {
  const normalized = objectPath
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/\/{2,}/g, "/")
    .toLowerCase();
  return normalized.startsWith(CARTA_IMAGEN_PREFIX);
}

export type CartaImagenUrlCheck =
  | { ok: true; path: string }
  | { ok: false; reason: "invalid" | "missing" | "unavailable" };

/**
 * Comprueba una cartaImagenUrl antes de guardarla en un premio: formato
 * exacto (bucket y prefijo propios) y que el objeto exista en Storage.
 */
export async function checkCartaImagenUrl(
  url: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<CartaImagenUrlCheck> {
  let bucket: ReturnType<typeof cartaImagenBucket>;
  try {
    bucket = cartaImagenBucket();
  } catch (error) {
    console.error("carta_imagen_bucket_unavailable", {
      reason: error instanceof Error ? error.message : "unknown",
    });
    return { ok: false, reason: "unavailable" };
  }

  const parsed = parseCartaImagenUrl(url, {
    publicBase: resolveCartaImagenPublicBase(env),
    bucket: bucket.name,
  });
  if (!parsed) return { ok: false, reason: "invalid" };

  try {
    assertCartaImagenStorageAvailable(env);
  } catch {
    return { ok: false, reason: "unavailable" };
  }

  try {
    const [exists] = await bucket.file(parsed.path).exists();
    return exists
      ? { ok: true, path: parsed.path }
      : { ok: false, reason: "missing" };
  } catch (error) {
    console.error("carta_imagen_exists_failed", {
      path: parsed.path,
      reason: error instanceof Error ? error.message : "unknown",
    });
    return { ok: false, reason: "unavailable" };
  }
}

// ---------------------------------------------------------------------------
// Normalización
// ---------------------------------------------------------------------------

export type CartaImagenAjuste = "cover" | "contain";

export type CartaImagenNormalizada = {
  buffer: Buffer;
  width: number;
  height: number;
  bytes: number;
  sha256: string;
  contentType: "image/webp";
  /** cover: proporción casi igual; contain: centrada sobre fondo difuminado. */
  ajuste: CartaImagenAjuste;
};

type CartaImagenSource = string | Buffer;

async function sourceSize(source: CartaImagenSource): Promise<number> {
  if (Buffer.isBuffer(source)) return source.length;
  return (await fs.stat(source)).size;
}

async function readHeader(source: CartaImagenSource): Promise<Buffer> {
  if (Buffer.isBuffer(source)) return source.subarray(0, FILE_TYPE_HEADER_BYTES);
  const handle = await fs.open(source, "r");
  try {
    const header = Buffer.alloc(FILE_TYPE_HEADER_BYTES);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    return header.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

function sharpFailure(error: unknown): CartaImagenError {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (message.includes("pixel limit")) {
    return invalidImage(
      "La imagen de la carta es demasiado grande: máximo 40 megapíxeles.",
    );
  }
  return invalidImage("La imagen de la carta está dañada o no se puede leer.");
}

/** Proporción de origen a menos de 3 % de 1744:1182 (= 872:591). */
export function cartaImagenAjuste(width: number, height: number): CartaImagenAjuste {
  const target = CARTA_IMAGEN_WIDTH / CARTA_IMAGEN_HEIGHT;
  const diff = Math.abs(width / height / target - 1);
  return diff <= CARTA_IMAGEN_COVER_TOLERANCE ? "cover" : "contain";
}

function sharpInput(source: CartaImagenSource) {
  // rotate() sin argumentos aplica la orientación EXIF; la salida no lleva
  // metadatos (sharp los quita salvo que se pida withMetadata/keepMetadata).
  return sharp(source, { limitInputPixels: CARTA_IMAGEN_MAX_INPUT_PIXELS })
    .rotate()
    .flatten({ background: CARTA_IMAGEN_FONDO });
}

async function renderCover(source: CartaImagenSource) {
  return sharpInput(source)
    .resize(CARTA_IMAGEN_WIDTH, CARTA_IMAGEN_HEIGHT, {
      fit: "cover",
      position: "centre",
    })
    .removeAlpha()
    .webp({ quality: WEBP_QUALITY })
    .toBuffer({ resolveWithObject: true });
}

async function renderContain(source: CartaImagenSource) {
  // Fondo: la misma imagen en cover, difuminada y oscurecida.
  const fondo = await sharpInput(source)
    .resize(CARTA_IMAGEN_WIDTH, CARTA_IMAGEN_HEIGHT, {
      fit: "cover",
      position: "centre",
    })
    .blur(BLUR_SIGMA)
    .modulate({ brightness: BRILLO_FONDO })
    .removeAlpha()
    .png({ compressionLevel: 1 })
    .toBuffer();
  // Frente: la imagen completa (contain), sin recortes ni deformación.
  const frente = await sharpInput(source)
    .resize(CARTA_IMAGEN_WIDTH, CARTA_IMAGEN_HEIGHT, { fit: "inside" })
    .removeAlpha()
    .png({ compressionLevel: 1 })
    .toBuffer();

  return sharp(fondo)
    .composite([{ input: frente, gravity: "centre" }])
    .removeAlpha()
    .webp({ quality: WEBP_QUALITY })
    .toBuffer({ resolveWithObject: true });
}

/**
 * Valida y normaliza la imagen de la carta.
 *
 * Entrada: JPEG, PNG o WebP (por bytes mágicos con file-type y por sharp),
 * máximo 10 MB, cada lado ≥ 400 px y máximo 40 MP.
 * Salida: WebP opaco de exactamente 1744 × 1182 px, sin metadatos.
 */
export async function normalizeCartaImagen(
  source: CartaImagenSource,
): Promise<CartaImagenNormalizada> {
  const size = await sourceSize(source);
  if (size <= 0) {
    throw invalidImage("Selecciona una imagen para la carta.");
  }
  if (size > CARTA_IMAGEN_MAX_BYTES) {
    throw invalidImage("La imagen de la carta no puede pesar más de 10 MB.");
  }

  // file-type es solo ESM: se importa bajo demanda.
  const { fileTypeFromBuffer } = await import("file-type");
  const detected = await fileTypeFromBuffer(await readHeader(source));
  const mime = detected?.mime ?? "";
  if (!(CARTA_IMAGEN_ALLOWED_MIME_TYPES as readonly string[]).includes(mime)) {
    throw invalidImage("La imagen de la carta debe ser JPEG, PNG o WebP.");
  }

  let metadata: sharp.Metadata;
  try {
    metadata = await sharp(source, {
      limitInputPixels: CARTA_IMAGEN_MAX_INPUT_PIXELS,
    }).metadata();
  } catch (error) {
    throw sharpFailure(error);
  }

  if (!metadata.format || SHARP_FORMAT_MIME[metadata.format] !== mime) {
    throw invalidImage("La imagen de la carta está dañada o no se puede leer.");
  }
  if (!metadata.width || !metadata.height) {
    throw invalidImage("La imagen de la carta está dañada o no se puede leer.");
  }
  if (metadata.width * metadata.height > CARTA_IMAGEN_MAX_INPUT_PIXELS) {
    throw invalidImage(
      "La imagen de la carta es demasiado grande: máximo 40 megapíxeles.",
    );
  }

  // Orientaciones EXIF 5-8 intercambian ancho y alto al aplicar rotate().
  const swapped = (metadata.orientation ?? 1) >= 5;
  const width = swapped ? metadata.height : metadata.width;
  const height = swapped ? metadata.width : metadata.height;
  if (width < CARTA_IMAGEN_MIN_SIDE || height < CARTA_IMAGEN_MIN_SIDE) {
    throw invalidImage(
      "La imagen de la carta debe medir al menos 400 px por lado. Recomendado: 1744 × 1182 px (horizontal, proporción 1.48:1).",
    );
  }

  const ajuste = cartaImagenAjuste(width, height);
  let output: { data: Buffer; info: sharp.OutputInfo };
  try {
    output =
      ajuste === "cover"
        ? await renderCover(source)
        : await renderContain(source);
  } catch (error) {
    throw sharpFailure(error);
  }

  if (
    output.info.width !== CARTA_IMAGEN_WIDTH ||
    output.info.height !== CARTA_IMAGEN_HEIGHT
  ) {
    throw new Error(
      `Normalización inesperada de la carta: ${output.info.width}x${output.info.height}`,
    );
  }

  return {
    buffer: output.data,
    width: CARTA_IMAGEN_WIDTH,
    height: CARTA_IMAGEN_HEIGHT,
    bytes: output.data.length,
    sha256: createHash("sha256").update(output.data).digest("hex"),
    contentType: "image/webp",
    ajuste,
  };
}

// ---------------------------------------------------------------------------
// Subida
// ---------------------------------------------------------------------------

export type CartaImagenSubida = {
  url: string;
  path: string;
  width: number;
  height: number;
  bytes: number;
};

/** Sube una imagen ya normalizada a una ruta nueva e inmutable. */
export async function uploadCartaImagen(
  imagen: CartaImagenNormalizada,
  input: { uploadedBy: string },
  env: NodeJS.ProcessEnv = process.env,
): Promise<CartaImagenSubida> {
  assertCartaImagenStorageAvailable(env);
  const bucket = cartaImagenBucket();
  const objectPath = `${CARTA_IMAGEN_PREFIX}${randomUUID()}.webp`;

  await bucket.file(objectPath).save(imagen.buffer, {
    resumable: false,
    public: true,
    preconditionOpts: { ifGenerationMatch: 0 },
    metadata: {
      contentType: imagen.contentType,
      cacheControl: CARTA_IMAGEN_CACHE_CONTROL,
      metadata: {
        kind: CARTA_IMAGEN_KIND,
        uploadedBy: input.uploadedBy,
        sha256: imagen.sha256,
      },
    },
  });

  return {
    url: `${resolveCartaImagenPublicBase(env)}/${bucket.name}/${objectPath}`,
    path: objectPath,
    width: imagen.width,
    height: imagen.height,
    bytes: imagen.bytes,
  };
}

/**
 * Flujo completo del endpoint: guard de Storage, normalización y subida.
 * El guard va primero para no procesar nada si no hay un destino seguro.
 */
export async function subirCartaImagen(
  input: { source: CartaImagenSource; uploadedBy: string },
  env: NodeJS.ProcessEnv = process.env,
): Promise<CartaImagenSubida> {
  assertCartaImagenStorageAvailable(env);
  const imagen = await normalizeCartaImagen(input.source);
  return uploadCartaImagen(imagen, { uploadedBy: input.uploadedBy }, env);
}

export default {
  normalizeCartaImagen,
  uploadCartaImagen,
  subirCartaImagen,
  parseCartaImagenUrl,
  checkCartaImagenUrl,
};
