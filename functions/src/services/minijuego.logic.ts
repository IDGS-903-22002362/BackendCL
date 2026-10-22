import { BeneficioTipo } from "../models/beneficios.model";
import {
  GuardarMinijuegoInput,
  MINIJUEGO_TIPOS,
  Minijuego,
  MinijuegoAudiencia,
  MinijuegoEstado,
  MinijuegoPremio,
  MinijuegoTipo,
  MinijuegoVisibilidad,
  PRIZE_TYPES,
  PremioInput,
  PrizeType,
} from "../models/minijuego.model";
import { RolUsuario } from "../models/usuario.model";

export const SEGMENT_COLORS = [
  "#0E6B4F",
  "#C4A35A",
  "#163D32",
  "#8D6A32",
  "#1F6F8A",
  "#6E4B3A",
  "#2F6B4F",
  "#A6843D",
] as const;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9_-]{8,80}$/;
const COLOR_RE = /^#[0-9A-Fa-f]{6}$/;
const STAFF_ROLES = new Set<string>([
  RolUsuario.ADMIN,
  RolUsuario.EMPLEADO,
  RolUsuario.EMPLEADO_CLUB,
]);

export class MinijuegoError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number, message: string) {
    super(message);
    this.name = "MinijuegoError";
    this.code = code;
    this.status = status;
  }
}

export type BeneficioViewer = {
  uid?: string;
  email?: string;
  rol?: string;
  adminView: boolean;
};

export type PreparedPremio = {
  id?: string;
  nombre: string;
  tipo: PrizeType;
  valor?: number;
  stock: number | null;
  weight: number;
  orden: number;
  color: string;
  imagenUrl?: string;
  descripcion?: string;
  terminos?: string;
  validoDesde?: Date;
  caducaEl?: Date;
  especial?: boolean;
  maxGanadores?: number;
};

export type BeneficioEspecialEstado = "pendiente" | "caducado" | "vigente";

export function resolveBeneficioEspecialEstado(
  now: Date,
  validoDesde?: Date | null,
  caducaEl?: Date | null,
): BeneficioEspecialEstado {
  if (validoDesde && now.getTime() < validoDesde.getTime()) {
    return "pendiente";
  }
  if (caducaEl && now.getTime() > caducaEl.getTime()) {
    return "caducado";
  }
  return "vigente";
}

export type PlayDecision =
  | { type: "replay"; playId: string }
  | { type: "create"; prize: MinijuegoPremio };

export function resolveBeneficioTipo(value: unknown): BeneficioTipo {
  return value === "minijuego" ? "minijuego" : "estandar";
}

export function isBeneficiosStaff(rol?: string): boolean {
  return !!rol && STAFF_ROLES.has(rol);
}

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function normalizeEmailList(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const email = normalizeEmail(value);
    if (!email) continue;
    if (!EMAIL_RE.test(email) || email.length > 200) {
      throw new MinijuegoError("MINIGAME_INVALID_EMAIL", 400, "Correo inválido.");
    }
    if (seen.has(email)) continue;
    seen.add(email);
    result.push(email);
  }

  return result;
}

export function viewerFromRequest(req: {
  user?: { uid?: string; email?: unknown; rol?: string };
  query?: { admin?: unknown };
}): BeneficioViewer {
  const uid = req.user?.uid?.trim() ?? "";

  return {
    uid: uid || undefined,
    rol: req.user?.rol,
    adminView: req.query?.admin === "1" && isBeneficiosStaff(req.user?.rol),
  };
}

export function isPublicAudience(
  audiencia?: { visibilidad?: unknown } | null,
): boolean {
  return audiencia?.visibilidad === "publico";
}

export function normalizeUidList(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const uid = value.trim();
    if (!UID_RE.test(uid)) {
      throw new MinijuegoError(
        "MINIGAME_INVALID_USER",
        400,
        "Hay un usuario autorizado inválido.",
      );
    }
    if (seen.has(uid)) continue;
    seen.add(uid);
    result.push(uid);
  }

  return result;
}

export function assertIdempotencyKey(value: unknown): string {
  if (typeof value !== "string" || !IDEMPOTENCY_KEY_RE.test(value.trim())) {
    throw new MinijuegoError(
      "MINIGAME_IDEMPOTENCY_REQUIRED",
      400,
      "Falta la clave de idempotencia.",
    );
  }

  return value.trim();
}

export function canAccessMinijuego(
  audiencia: MinijuegoAudiencia | null | undefined,
  uid?: string,
): boolean {
  if (isPublicAudience(audiencia)) return true;
  if (audiencia?.visibilidad !== "restringido") return false;

  const actorUid = uid?.trim() ?? "";
  if (!actorUid) return false;
  return (audiencia?.usuariosPermitidos ?? []).some(
    (item) => item.trim() === actorUid,
  );
}

export function assertPlayable(input: {
  uid?: string;
  beneficioActivo: boolean;
  minijuego: Minijuego;
  now: Date;
}): void {
  if (!input.beneficioActivo || !input.minijuego.estatus) {
    throw new MinijuegoError(
      "MINIGAME_INACTIVE",
      403,
      "Este minijuego ya no está disponible.",
    );
  }

  if (
    input.minijuego.fechaInicio &&
    input.minijuego.fechaInicio.getTime() > input.now.getTime()
  ) {
    throw new MinijuegoError(
      "MINIGAME_NOT_STARTED",
      403,
      "Este minijuego todavía no está disponible.",
    );
  }

  if (
    input.minijuego.fechaFin &&
    input.minijuego.fechaFin.getTime() < input.now.getTime()
  ) {
    throw new MinijuegoError(
      "MINIGAME_EXPIRED",
      403,
      "Este minijuego ha terminado.",
    );
  }

  if (!canAccessMinijuego(input.minijuego.audiencia, input.uid)) {
    throw new MinijuegoError(
      "MINIGAME_ACCESS_DENIED",
      403,
      "Este minijuego ya no está disponible para tu cuenta.",
    );
  }
}

export function isVisibleInCatalog(input: {
  tipo: unknown;
  beneficioActivo: boolean;
  minijuego: Minijuego | null;
  uid?: string;
  now: Date;
  adminView: boolean;
}): boolean {
  if (input.adminView) return true;
  if (resolveBeneficioTipo(input.tipo) !== "minijuego") return true;
  if (!input.minijuego) return false;

  try {
    assertPlayable({
      uid: input.uid,
      beneficioActivo: input.beneficioActivo,
      minijuego: input.minijuego,
      now: input.now,
    });
    return true;
  } catch {
    return false;
  }
}

export function pickWeightedPrize(
  premios: MinijuegoPremio[],
  randomInt: (maxExclusive: number) => number,
): MinijuegoPremio {
  const eligible = premios.filter((premio) => {
    if (!Number.isInteger(premio.weight) || premio.weight < 1) return false;
    if (premio.stock == null) return true;
    return premio.stock > 0;
  });

  if (eligible.length === 0) {
    throw new MinijuegoError(
      "MINIGAME_NO_PRIZES",
      409,
      "Este minijuego no tiene premios disponibles.",
    );
  }

  const total = eligible.reduce((sum, premio) => sum + premio.weight, 0);
  let cursor = randomInt(total);

  if (!Number.isInteger(cursor) || cursor < 0 || cursor >= total) {
    throw new MinijuegoError(
      "MINIGAME_NO_PRIZES",
      500,
      "No pudimos completar la participación. Intenta de nuevo.",
    );
  }

  for (const premio of eligible) {
    cursor -= premio.weight;
    if (cursor < 0) return premio;
  }

  return eligible[eligible.length - 1];
}

export function drawAvailablePrize(
  premios: MinijuegoPremio[],
  randomInt: (maxExclusive: number) => number,
): { prize: MinijuegoPremio; premios: MinijuegoPremio[] } {
  const prize = pickWeightedPrize(premios, randomInt);

  return {
    prize,
    premios: premios.map((item) => {
      if (item.id !== prize.id || item.stock == null) return item;
      return { ...item, stock: item.stock - 1 };
    }),
  };
}

export const DEFAULT_ROULETTE_POINT_VALUES = [
  10, 20, 30, 40, 50, 60, 70, 80, 90, 100,
] as const;

export type SpecialWinnerProfile = {
  uid: string;
  email: string;
  telefono: string;
};

function readProfileText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

export function buildSpecialWinner(input: {
  tipo: string;
  especial?: boolean;
  uid: string;
  profile?: {
    email?: unknown;
    telefono?: unknown;
  } | null;
}): SpecialWinnerProfile | null {
  if (input.especial !== true) return null;

  const profile = input.profile ?? {};
  return {
    uid: input.uid,
    email: readProfileText(profile.email),
    telefono: readProfileText(profile.telefono),
  };
}

export function rouletteSegmentLabel(premio: {
  tipo: string;
  nombre: string;
  valor?: number;
  especial?: boolean;
}): string {
  if (premio.especial) return "ESPECIAL";
  if (premio.tipo === "points" && typeof premio.valor === "number") {
    return String(premio.valor);
  }
  return premio.nombre;
}

export function pointsLedgerAmount(prize: {
  tipo: string;
  valor?: number | null;
  especial?: boolean;
}): number {
  if (prize.especial || prize.tipo !== "points") return 0;
  if (prize.valor == null || prize.valor <= 0) return 0;
  return prize.valor;
}

export function resolveSpecialStock(input: {
  requestedMax: number;
  previousMax: number | null;
  previousStock: number | null;
  awarded: number;
}): { stock: number; maxGanadores: number } {
  const awarded = Math.max(0, input.awarded);
  if (
    input.previousMax != null &&
    input.requestedMax === input.previousMax &&
    input.previousStock != null
  ) {
    return { stock: input.previousStock, maxGanadores: input.previousMax };
  }
  if (
    input.previousMax == null &&
    input.previousStock != null &&
    input.requestedMax === input.previousStock
  ) {
    return {
      stock: input.previousStock,
      maxGanadores: input.previousStock + awarded,
    };
  }
  return {
    stock: Math.max(0, input.requestedMax - awarded),
    maxGanadores: input.requestedMax,
  };
}

export function toSpecialWinnersView(input: {
  premio: string;
  maxGanadores: number | null;
  ganadores: Array<{ uid: string; email: string; telefono: string }>;
}) {
  return {
    premio: input.premio,
    maxGanadores: input.maxGanadores,
    totalGanadores: input.ganadores.length,
    ganadores: input.ganadores.map((ganador) => ({
      uid: ganador.uid,
      email: ganador.email,
      telefono: ganador.telefono,
    })),
  };
}

export function rouletteSegments<T extends { id: string; stock: number | null }>(
  premios: T[],
  keepPrizeId?: string,
): T[] {
  return premios.filter((premio) => {
    if (keepPrizeId && premio.id === keepPrizeId) return true;
    return premio.stock == null || premio.stock > 0;
  });
}

export function decidePlay(input: {
  uid?: string;
  beneficioActivo: boolean;
  minijuego: Minijuego;
  premios: MinijuegoPremio[];
  estado: MinijuegoEstado | null;
  idempotencyKey: string;
  now: Date;
  randomInt: (maxExclusive: number) => number;
}): PlayDecision {
  const existingPlayId = input.estado?.claves?.[input.idempotencyKey];
  if (existingPlayId) {
    return { type: "replay", playId: existingPlayId };
  }

  assertPlayable({
    uid: input.uid,
    beneficioActivo: input.beneficioActivo,
    minijuego: input.minijuego,
    now: input.now,
  });

  const usados = input.estado?.intentosUsados ?? 0;
  if (usados >= input.minijuego.intentosPorUsuario) {
    throw new MinijuegoError(
      "MINIGAME_NO_ATTEMPTS",
      409,
      "Ya utilizaste tus intentos disponibles.",
    );
  }

  return {
    type: "create",
    prize: drawAvailablePrize(input.premios, input.randomInt).prize,
  };
}

export function parseOptionalDate(
  value: string | null | undefined,
): Date | null {
  if (value == null || value.trim() === "") return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new MinijuegoError("MINIGAME_INVALID_DATE", 400, "Fecha inválida.");
  }
  return date;
}

function readImageUrl(value?: string): string | undefined {
  if (!value || !value.trim()) return undefined;

  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return undefined;
    }
    return url.toString();
  } catch {
    return undefined;
  }
}

export function prepareMinijuegoWrite(input: GuardarMinijuegoInput): {
  beneficio: GuardarMinijuegoInput["beneficio"];
  minijuego: {
    tipo: MinijuegoTipo;
    fechaInicio: Date | null;
    fechaFin: Date | null;
    intentosPorUsuario: number;
    audiencia: MinijuegoAudiencia;
  };
  premios: PreparedPremio[];
} {
  if (!(MINIJUEGO_TIPOS as readonly string[]).includes(input.minijuego.tipo)) {
    throw new MinijuegoError(
      "MINIGAME_INVALID_TYPE",
      400,
      "Tipo de minijuego inválido.",
    );
  }

  const intentos = input.minijuego.intentosPorUsuario;
  if (!Number.isInteger(intentos) || intentos < 1 || intentos > 100) {
    throw new MinijuegoError(
      "MINIGAME_INVALID_ATTEMPTS",
      400,
      "Los intentos por usuario deben estar entre 1 y 100.",
    );
  }

  const visibilidad: MinijuegoVisibilidad =
    input.minijuego.audiencia.visibilidad === "publico"
      ? "publico"
      : "restringido";
  const usuariosPermitidos = normalizeUidList(
    input.minijuego.audiencia.usuariosPermitidos ?? [],
  );

  if (visibilidad === "restringido" && usuariosPermitidos.length === 0) {
    throw new MinijuegoError(
      "MINIGAME_ALLOWLIST_REQUIRED",
      400,
      "Selecciona al menos un usuario autorizado.",
    );
  }

  const fechaInicio = parseOptionalDate(input.minijuego.fechaInicio);
  const fechaFin = parseOptionalDate(input.minijuego.fechaFin);
  if (fechaInicio && fechaFin && fechaFin.getTime() < fechaInicio.getTime()) {
    throw new MinijuegoError(
      "MINIGAME_INVALID_DATE",
      400,
      "La fecha de fin no puede ser anterior al inicio.",
    );
  }

  if (!Array.isArray(input.premios) || input.premios.length === 0) {
    throw new MinijuegoError(
      "MINIGAME_PRIZES_REQUIRED",
      400,
      "Agrega al menos un premio.",
    );
  }

  if (input.premios.length > 12) {
    throw new MinijuegoError(
      "MINIGAME_TOO_MANY_PRIZES",
      400,
      "Un minijuego puede tener máximo 12 premios.",
    );
  }

  const premios = input.premios.map((premio, index) =>
    preparePremio(premio, index),
  );
  if (premios.filter((premio) => premio.especial).length > 1) {
    throw new MinijuegoError(
      "MINIGAME_INVALID_PRIZE",
      400,
      "El minijuego solo puede tener un premio especial.",
    );
  }

  return {
    beneficio: {
      titulo: input.beneficio.titulo.trim(),
      descripcion: input.beneficio.descripcion.trim(),
      estatus: input.beneficio.estatus,
    },
    minijuego: {
      tipo: input.minijuego.tipo,
      fechaInicio,
      fechaFin,
      intentosPorUsuario: intentos,
      audiencia: {
        visibilidad,
        usuariosPermitidos,
      },
    },
    premios,
  };
}

function preparePremio(premio: PremioInput, index: number): PreparedPremio {
  const nombre = premio.nombre?.trim() ?? "";
  if (!nombre || nombre.length > 80) {
    throw new MinijuegoError(
      "MINIGAME_INVALID_PRIZE",
      400,
      "Cada premio necesita un nombre válido.",
    );
  }

  if (!(PRIZE_TYPES as readonly string[]).includes(premio.tipo)) {
    throw new MinijuegoError(
      "MINIGAME_INVALID_PRIZE",
      400,
      "Tipo de premio inválido.",
    );
  }

  const tipo = premio.tipo;
  let valor = premio.valor;
  if (valor != null) {
    if (!Number.isInteger(valor) || valor < 0 || valor > 100_000) {
      throw new MinijuegoError(
        "MINIGAME_INVALID_PRIZE",
        400,
        "El valor del premio no es válido.",
      );
    }
  }

  if (tipo === "points") {
    if (valor == null || valor <= 0 || valor > 10_000) {
      throw new MinijuegoError(
        "MINIGAME_INVALID_PRIZE",
        400,
        "Indica los puntos del premio.",
      );
    }
  }

  let stock: number | null = null;
  if (premio.stock != null) {
    if (!Number.isInteger(premio.stock) || premio.stock < 0) {
      throw new MinijuegoError(
        "MINIGAME_INVALID_PRIZE",
        400,
        "El stock del premio no es válido.",
      );
    }
    stock = premio.stock;
  }

  const weight = premio.weight ?? 1;
  if (!Number.isInteger(weight) || weight < 1 || weight > 10_000) {
    throw new MinijuegoError(
      "MINIGAME_INVALID_PRIZE",
      400,
      "El peso del premio debe ser un entero mayor a cero.",
    );
  }

  const descripcion = premio.descripcion?.trim();
  if (descripcion && descripcion.length > 200) {
    throw new MinijuegoError(
      "MINIGAME_INVALID_PRIZE",
      400,
      "La descripción del premio es demasiado larga.",
    );
  }

  let terminos: string | undefined;
  let validoDesde: Date | null = null;
  let caducaEl: Date | null = null;
  if (premio.especial === true) {
    const rawTerminos = premio.terminos?.trim() ?? "";
    if (rawTerminos.length > 4000) {
      throw new MinijuegoError(
        "MINIGAME_INVALID_PRIZE",
        400,
        "Los términos del premio son demasiado largos.",
      );
    }
    if (rawTerminos) terminos = rawTerminos;
    validoDesde = parseOptionalDate(premio.validoDesde);
    caducaEl = parseOptionalDate(premio.caducaEl);
    if (validoDesde && caducaEl && caducaEl.getTime() < validoDesde.getTime()) {
      throw new MinijuegoError(
        "MINIGAME_INVALID_DATE",
        400,
        "La caducidad no puede ser anterior al inicio de la vigencia.",
      );
    }
  }

  const color =
    premio.color && COLOR_RE.test(premio.color)
      ? premio.color
      : SEGMENT_COLORS[index % SEGMENT_COLORS.length];

  return {
    id: premio.id?.trim() || undefined,
    nombre,
    tipo,
    ...(valor != null ? { valor } : {}),
    stock,
    weight,
    orden: index,
    color,
    ...(premio.especial === true && stock != null
      ? {
          maxGanadores:
            premio.maxGanadores != null && Number.isInteger(premio.maxGanadores)
              ? premio.maxGanadores
              : stock,
        }
      : {}),
    ...(readImageUrl(premio.imagenUrl)
      ? { imagenUrl: readImageUrl(premio.imagenUrl) }
      : {}),
    ...(descripcion ? { descripcion } : {}),
    ...(terminos ? { terminos } : {}),
    ...(validoDesde ? { validoDesde } : {}),
    ...(caducaEl ? { caducaEl } : {}),
    ...(premio.especial === true ? { especial: true } : {}),
  };
}
