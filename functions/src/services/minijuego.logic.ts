import { BeneficioTipo } from "../models/beneficios.model";
import {
  GuardarMinijuegoInput,
  MAX_PREMIOS_MINIJUEGO,
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
import {
  PROBABILITY_TOTAL_UNITS,
  describeProbabilityTotal,
  percentToUnits,
  unitsToPercent,
  weightsToUnits,
} from "./minijuego.probability";

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
  /** Probabilidad en unidades de 0.001 % (igual a probabilidad * 1000). */
  weight: number;
  /** Probabilidad configurada en porcentaje. */
  probabilidad: number;
  orden: number;
  color: string;
  imagenUrl?: string;
  /**
   * Solo premio especial. undefined = no se envió (al editar se conserva la
   * del mismo premio); null = sin carta; string = URL a validar y guardar.
   */
  cartaImagenUrl?: string | null;
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

/**
 * Peso entero con el que participa cada premio en el sorteo.
 *
 * - Si todos los premios tienen una probabilidad porcentual válida, se usan
 *   sus unidades de 0.001 % (30 % = 30000). Así los porcentajes decimales se
 *   sortean con enteros, sin redondeos ni sesgos.
 * - Si algún premio no la tiene (minijuegos creados antes de los porcentajes),
 *   se usan los pesos relativos originales sin cambios, para que esos
 *   minijuegos sigan sorteando exactamente igual que antes.
 * - Un premio con probabilidad definida de 0 % pesa 0 en ambos modos: queda
 *   guardado pero nunca sale, aunque su peso relativo diga otra cosa
 *   (mapPremio fuerza weight ≥ 1 para los minijuegos antiguos).
 */
export function prizeDrawWeights(
  premios: Array<Pick<MinijuegoPremio, "weight" | "probabilidad">>,
): number[] {
  const units = premios.map((premio) => percentToUnits(premio.probabilidad));
  const percentMode =
    premios.length > 0 && units.every((value) => value != null);

  return premios.map((premio, index) => {
    if (percentMode) return units[index] ?? 0;
    if (units[index] === 0) return 0;
    return Number.isInteger(premio.weight) && premio.weight >= 1
      ? premio.weight
      : 0;
  });
}

type DrawablePrize = Pick<MinijuegoPremio, "weight" | "probabilidad" | "stock">;

function isEligibleDraw(stock: number | null, weight: number): boolean {
  if (!Number.isInteger(weight) || weight < 1) return false;
  return stock == null || stock > 0;
}

/**
 * Premios que pueden salir, con su peso efectivo: stock disponible (null =
 * ilimitado) y peso ≥ 1 (un premio de 0 % nunca sale). Es el mismo criterio
 * para el sorteo, los sectores de la ruleta y premiosDisponibles.
 */
export function eligiblePrizes<T extends DrawablePrize>(
  premios: T[],
): Array<{ premio: T; weight: number }> {
  const weights = prizeDrawWeights(premios);
  return premios
    .map((premio, index) => ({ premio, weight: weights[index] ?? 0 }))
    .filter(({ premio, weight }) => isEligibleDraw(premio.stock, weight));
}

export function hasEligiblePrize(premios: DrawablePrize[]): boolean {
  return eligiblePrizes(premios).length > 0;
}

/**
 * Probabilidades que ve el administrador.
 * Para minijuegos antiguos convierte los pesos a porcentajes equivalentes que
 * suman exactamente 100 % (método del mayor residuo, precisión 0.001 %).
 */
export function adminPrizeProbabilities(
  premios: Array<Pick<MinijuegoPremio, "weight" | "probabilidad">>,
): { modo: "porcentaje" | "convertida"; porcentajes: number[] } {
  const units = premios.map((premio) => percentToUnits(premio.probabilidad));
  if (premios.length > 0 && units.every((value) => value != null)) {
    return {
      modo: "porcentaje",
      porcentajes: units.map((value) => unitsToPercent(value ?? 0)),
    };
  }

  // Con los pesos efectivos del sorteo: un premio que tenga 0 % definido se
  // ve en 0 % (nunca sale), aunque su peso relativo sea mayor.
  return {
    modo: "convertida",
    porcentajes: weightsToUnits(prizeDrawWeights(premios)).map(unitsToPercent),
  };
}

export function pickWeightedPrize(
  premios: MinijuegoPremio[],
  randomInt: (maxExclusive: number) => number,
): MinijuegoPremio {
  // Los premios agotados y los de 0 % salen del sorteo. Al sortear sobre la
  // suma de los que quedan, la probabilidad de un agotado se redistribuye
  // proporcionalmente sin tocar los porcentajes guardados.
  const eligible = eligiblePrizes(premios);

  if (eligible.length === 0) {
    throw new MinijuegoError(
      "MINIGAME_NO_PRIZES",
      409,
      "Este minijuego no tiene premios disponibles.",
    );
  }

  const total = eligible.reduce((sum, item) => sum + item.weight, 0);
  let cursor = randomInt(total);

  if (!Number.isInteger(cursor) || cursor < 0 || cursor >= total) {
    throw new MinijuegoError(
      "MINIGAME_NO_PRIZES",
      500,
      "No pudimos completar la participación. Intenta de nuevo.",
    );
  }

  for (const item of eligible) {
    cursor -= item.weight;
    if (cursor < 0) return item.premio;
  }

  return eligible[eligible.length - 1].premio;
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

/**
 * Nombre del socio que ve el panel: el campo «nombre» de su perfil en
 * usuariosApp, recortado. null si no hay perfil o si el nombre falta, no es
 * texto o queda vacío (el panel lo muestra como «No disponible»).
 */
export function nombreDeUsuario(data: unknown): string | null {
  if (data == null || typeof data !== "object") return null;
  const nombre = (data as { nombre?: unknown }).nombre;
  if (typeof nombre !== "string") return null;
  const recortado = nombre.trim();
  return recortado.length > 0 ? recortado : null;
}

export function toSpecialWinnersView(input: {
  premio: string;
  maxGanadores: number | null;
  ganadores: Array<{
    uid: string;
    nombre?: string | null;
    email: string;
    telefono: string;
  }>;
}) {
  return {
    premio: input.premio,
    maxGanadores: input.maxGanadores,
    totalGanadores: input.ganadores.length,
    ganadores: input.ganadores.map((ganador) => ({
      uid: ganador.uid,
      nombre: ganador.nombre ?? null,
      email: ganador.email,
      telefono: ganador.telefono,
    })),
  };
}

/**
 * Sectores de la ruleta: solo los premios que pueden salir (mismo criterio
 * que el sorteo: sin agotados ni 0 %). Se conserva el premio de la jugada
 * pendiente si sigue entre los premios, para que la ruleta pueda caer en él.
 */
export function rouletteSegments<T extends { id: string } & DrawablePrize>(
  premios: T[],
  keepPrizeId?: string,
): T[] {
  const weights = prizeDrawWeights(premios);
  return premios.filter((premio, index) => {
    if (keepPrizeId && premio.id === keepPrizeId) return true;
    return isEligibleDraw(premio.stock, weights[index] ?? 0);
  });
}

/**
 * Carta coleccionable que queda guardada en un premio al crear o editar.
 * - Solo el premio especial tiene carta.
 * - requested undefined (no se envió): se conserva la del mismo premio si ya
 *   era especial; al crear no hay anterior, así que queda sin carta.
 * - null o '': sin carta.
 * - string: esa URL (el servicio ya la validó).
 */
export function resolveCartaImagenUrl(input: {
  especial?: boolean;
  requested?: string | null;
  previous?: { especial?: unknown; cartaImagenUrl?: unknown } | null;
}): string | undefined {
  if (input.especial !== true) return undefined;
  if (input.requested === undefined) {
    const previous = input.previous;
    if (
      previous?.especial === true &&
      typeof previous.cartaImagenUrl === "string" &&
      previous.cartaImagenUrl.trim()
    ) {
      return previous.cartaImagenUrl.trim();
    }
    return undefined;
  }
  return input.requested ? input.requested : undefined;
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

  if (input.premios.length > MAX_PREMIOS_MINIJUEGO) {
    throw new MinijuegoError(
      "MINIGAME_TOO_MANY_PRIZES",
      400,
      `Un minijuego puede tener máximo ${MAX_PREMIOS_MINIJUEGO} premios.`,
    );
  }

  const premios = input.premios.map((premio, index) =>
    preparePremio(premio, index),
  );
  const positionById = new Map<string, number>();
  premios.forEach((premio, index) => {
    if (!premio.id) return;
    const first = positionById.get(premio.id);
    if (first != null) {
      throw new MinijuegoError(
        "MINIGAME_INVALID_PRIZE",
        400,
        `El premio ${index + 1} repite el id del premio ${first + 1}. Recarga el panel e inténtalo de nuevo.`,
      );
    }
    positionById.set(premio.id, index);
  });
  if (premios.filter((premio) => premio.especial).length > 1) {
    throw new MinijuegoError(
      "MINIGAME_INVALID_PRIZE",
      400,
      "El minijuego solo puede tener un premio especial.",
    );
  }

  const totalUnits = premios.reduce((sum, premio) => sum + premio.weight, 0);
  if (totalUnits !== PROBABILITY_TOTAL_UNITS) {
    throw new MinijuegoError(
      "MINIGAME_INVALID_PROBABILITY_TOTAL",
      400,
      describeProbabilityTotal(totalUnits).message,
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

  // El peso relativo antiguo ya no se acepta como configuración: el
  // porcentaje es la única fuente de verdad.
  if (premio.probabilidad == null) {
    throw new MinijuegoError(
      "MINIGAME_PROBABILITY_REQUIRED",
      400,
      "Falta la probabilidad (%) de un premio. Recarga el panel e inténtalo de nuevo.",
    );
  }
  // 0 % es válido: el premio queda guardado pero deshabilitado (nunca sale ni
  // aparece como sector). Vacío ya se rechazó arriba; aquí se rechaza lo no
  // numérico, negativo, mayor a 100 o con más de 3 decimales.
  const units = percentToUnits(premio.probabilidad);
  if (units == null) {
    throw new MinijuegoError(
      "MINIGAME_INVALID_PROBABILITY",
      400,
      "La probabilidad de cada premio debe estar entre 0% y 100%, con máximo 3 decimales.",
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

  // Carta coleccionable, en tres estados (ver PreparedPremio). Una URL que no
  // sea del bucket propio se rechaza en el servicio, nunca se descarta.
  const rawCarta: unknown = premio.cartaImagenUrl;
  let cartaImagenUrl: string | null | undefined;
  if (rawCarta !== undefined && rawCarta !== null && typeof rawCarta !== "string") {
    throw new MinijuegoError(
      "MINIGAME_INVALID_PRIZE",
      400,
      "La imagen de la carta coleccionable no es válida.",
    );
  }
  if (typeof rawCarta === "string" && rawCarta.trim()) {
    if (premio.especial !== true) {
      throw new MinijuegoError(
        "MINIGAME_INVALID_PRIZE",
        400,
        "Solo el premio especial puede tener carta coleccionable.",
      );
    }
    if (rawCarta.trim().length > 2048) {
      throw new MinijuegoError(
        "MINIGAME_INVALID_PRIZE",
        400,
        "La imagen de la carta coleccionable no es válida.",
      );
    }
    cartaImagenUrl = rawCarta.trim();
  } else if (rawCarta !== undefined && premio.especial === true) {
    cartaImagenUrl = null;
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
    weight: units,
    probabilidad: unitsToPercent(units),
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
    ...(cartaImagenUrl !== undefined ? { cartaImagenUrl } : {}),
    ...(descripcion ? { descripcion } : {}),
    ...(terminos ? { terminos } : {}),
    ...(validoDesde ? { validoDesde } : {}),
    ...(caducaEl ? { caducaEl } : {}),
    ...(premio.especial === true ? { especial: true } : {}),
  };
}
