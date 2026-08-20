/**
 * Resolucion centralizada de periodos para el Asistente Administrativo.
 *
 * Todas las tools del agente deben resolver sus rangos aqui para que
 * "hoy", "esta semana" o "el mes pasado" signifiquen exactamente lo mismo
 * en cada consulta. La zona horaria es la que ya usa el proyecto
 * (crons, day-key.util, notification.config): America/Mexico_City.
 */

export const ANALYTICS_TIMEZONE = "America/Mexico_City";

export const ANALYTICS_PERIOD_KEYS = [
  "today",
  "yesterday",
  "this_week",
  "last_week",
  "this_month",
  "last_month",
  "last_7_days",
  "last_30_days",
  "last_90_days",
  "this_year",
  "custom",
] as const;

export type AnalyticsPeriodKey = (typeof ANALYTICS_PERIOD_KEYS)[number];

export interface AnalyticsPeriodInput {
  period?: AnalyticsPeriodKey;
  /** Solo para period="custom". Formato YYYY-MM-DD (inclusivo). */
  from?: string;
  /** Solo para period="custom". Formato YYYY-MM-DD (inclusivo). */
  to?: string;
}

export interface ResolvedPeriod {
  /** Identificador solicitado. */
  key: AnalyticsPeriodKey;
  /** Etiqueta legible en espanol para que el modelo cite el periodo real. */
  label: string;
  /** Primer dia incluido (YYYY-MM-DD, hora local MX). */
  fromDayKey: string;
  /** Ultimo dia incluido (YYYY-MM-DD, hora local MX). */
  toDayKey: string;
  /** Inicio inclusivo del rango en UTC. */
  start: Date;
  /** Fin exclusivo del rango en UTC. */
  endExclusive: Date;
  /** Numero de dias calendario cubiertos. */
  days: number;
  timeZone: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const DAY_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const MONTH_LABELS = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];

const dayKeyFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: ANALYTICS_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const offsetFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: ANALYTICS_TIMEZONE,
  hour12: false,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

/** Devuelve el "YYYY-MM-DD" local (MX) de un instante dado. */
export const toAnalyticsDayKey = (date: Date): string =>
  dayKeyFormatter.format(date);

const hourFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: ANALYTICS_TIMEZONE,
  hour12: false,
  hour: "2-digit",
});

/** Hora local del negocio (0-23) de un instante dado. */
export const toAnalyticsHour = (date: Date): number => {
  const parsed = Number(hourFormatter.format(date));
  return Number.isFinite(parsed) ? parsed % 24 : 0;
};

const WEEKDAY_LABELS = [
  "lunes",
  "martes",
  "miercoles",
  "jueves",
  "viernes",
  "sabado",
  "domingo",
];

/** Nombre del dia de la semana de un dayKey (para analisis de trafico). */
export const describeWeekday = (dayKey: string): string =>
  WEEKDAY_LABELS[isoWeekday(dayKey) - 1] || "desconocido";

const getTimeZoneOffsetMs = (date: Date): number => {
  const parts = offsetFormatter.formatToParts(date);
  const read = (type: string): number =>
    Number(parts.find((part) => part.type === type)?.value || "0");

  // Intl usa 24 para medianoche en algunos runtimes con hour12:false.
  const hour = read("hour") % 24;
  const asUtc = Date.UTC(
    read("year"),
    read("month") - 1,
    read("day"),
    hour,
    read("minute"),
    read("second"),
  );

  return asUtc - date.getTime();
};

/** Convierte una hora local de Mexico a su instante UTC equivalente. */
const zonedDayStartToUtc = (dayKey: string): Date => {
  const [year, month, day] = dayKey.split("-").map(Number);
  const naive = Date.UTC(year, month - 1, day, 0, 0, 0);
  // Doble pasada: la primera estima el offset, la segunda lo corrige si el
  // instante estimado cae en otro tramo de offset (cambios de horario).
  const firstGuess = naive - getTimeZoneOffsetMs(new Date(naive));
  const corrected = naive - getTimeZoneOffsetMs(new Date(firstGuess));
  return new Date(corrected);
};

const shiftDayKey = (dayKey: string, deltaDays: number): string => {
  const [year, month, day] = dayKey.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day) + deltaDays * DAY_MS);
  return shifted.toISOString().slice(0, 10);
};

const buildDayKey = (year: number, month: number, day: number): string =>
  `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

const parseDayKey = (dayKey: string): { year: number; month: number; day: number } => {
  const [year, month, day] = dayKey.split("-").map(Number);
  return { year, month, day };
};

/** Dia de la semana (1 = lunes ... 7 = domingo) para un dayKey. */
const isoWeekday = (dayKey: string): number => {
  const { year, month, day } = parseDayKey(dayKey);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return weekday === 0 ? 7 : weekday;
};

const lastDayOfMonth = (year: number, month: number): number =>
  new Date(Date.UTC(year, month, 0)).getUTCDate();

const describeRange = (fromDayKey: string, toDayKey: string): string => {
  const from = parseDayKey(fromDayKey);
  const to = parseDayKey(toDayKey);

  if (fromDayKey === toDayKey) {
    return `${from.day} de ${MONTH_LABELS[from.month - 1]} ${from.year}`;
  }

  if (from.year === to.year && from.month === to.month) {
    return `${from.day} al ${to.day} de ${MONTH_LABELS[from.month - 1]} ${from.year}`;
  }

  if (from.year === to.year) {
    return `${from.day} de ${MONTH_LABELS[from.month - 1]} al ${to.day} de ${MONTH_LABELS[to.month - 1]} ${from.year}`;
  }

  return `${from.day} de ${MONTH_LABELS[from.month - 1]} ${from.year} al ${to.day} de ${MONTH_LABELS[to.month - 1]} ${to.year}`;
};

export class AnalyticsPeriodError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AnalyticsPeriodError";
  }
}

const assertDayKey = (value: string, field: string): string => {
  if (!DAY_KEY_PATTERN.test(value)) {
    throw new AnalyticsPeriodError(
      `El campo "${field}" debe tener formato YYYY-MM-DD`,
    );
  }

  const { year, month, day } = parseDayKey(value);
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > lastDayOfMonth(year, month)
  ) {
    throw new AnalyticsPeriodError(`El campo "${field}" no es una fecha valida`);
  }

  return value;
};

const buildPeriod = (
  key: AnalyticsPeriodKey,
  label: string,
  fromDayKey: string,
  toDayKey: string,
): ResolvedPeriod => {
  const start = zonedDayStartToUtc(fromDayKey);
  const endExclusive = zonedDayStartToUtc(shiftDayKey(toDayKey, 1));

  return {
    key,
    label,
    fromDayKey,
    toDayKey,
    start,
    endExclusive,
    days: Math.max(1, Math.round((endExclusive.getTime() - start.getTime()) / DAY_MS)),
    timeZone: ANALYTICS_TIMEZONE,
  };
};

/**
 * Resuelve un periodo relativo a "ahora" usando la zona horaria del negocio.
 * Los rangos relativos nunca incluyen dias futuros.
 */
export const resolvePeriod = (
  input: AnalyticsPeriodInput = {},
  now: Date = new Date(),
): ResolvedPeriod => {
  const key = input.period || "last_30_days";
  const todayKey = toAnalyticsDayKey(now);
  const today = parseDayKey(todayKey);

  switch (key) {
    case "today":
      return buildPeriod("today", `hoy (${todayKey})`, todayKey, todayKey);

    case "yesterday": {
      const yesterday = shiftDayKey(todayKey, -1);
      return buildPeriod("yesterday", `ayer (${yesterday})`, yesterday, yesterday);
    }

    case "this_week": {
      const start = shiftDayKey(todayKey, -(isoWeekday(todayKey) - 1));
      return buildPeriod(
        "this_week",
        `esta semana (${describeRange(start, todayKey)})`,
        start,
        todayKey,
      );
    }

    case "last_week": {
      const thisWeekStart = shiftDayKey(todayKey, -(isoWeekday(todayKey) - 1));
      const start = shiftDayKey(thisWeekStart, -7);
      const end = shiftDayKey(thisWeekStart, -1);
      return buildPeriod(
        "last_week",
        `semana pasada (${describeRange(start, end)})`,
        start,
        end,
      );
    }

    case "this_month": {
      const start = buildDayKey(today.year, today.month, 1);
      return buildPeriod(
        "this_month",
        `${MONTH_LABELS[today.month - 1]} ${today.year} (del 1 al ${today.day})`,
        start,
        todayKey,
      );
    }

    case "last_month": {
      const month = today.month === 1 ? 12 : today.month - 1;
      const year = today.month === 1 ? today.year - 1 : today.year;
      const start = buildDayKey(year, month, 1);
      const end = buildDayKey(year, month, lastDayOfMonth(year, month));
      return buildPeriod(
        "last_month",
        `${MONTH_LABELS[month - 1]} ${year} (mes completo)`,
        start,
        end,
      );
    }

    case "last_7_days": {
      const start = shiftDayKey(todayKey, -6);
      return buildPeriod(
        "last_7_days",
        `ultimos 7 dias (${describeRange(start, todayKey)})`,
        start,
        todayKey,
      );
    }

    case "last_30_days": {
      const start = shiftDayKey(todayKey, -29);
      return buildPeriod(
        "last_30_days",
        `ultimos 30 dias (${describeRange(start, todayKey)})`,
        start,
        todayKey,
      );
    }

    case "last_90_days": {
      const start = shiftDayKey(todayKey, -89);
      return buildPeriod(
        "last_90_days",
        `ultimos 90 dias (${describeRange(start, todayKey)})`,
        start,
        todayKey,
      );
    }

    case "this_year": {
      const start = buildDayKey(today.year, 1, 1);
      return buildPeriod(
        "this_year",
        `${today.year} (del 1 de enero al ${todayKey})`,
        start,
        todayKey,
      );
    }

    case "custom": {
      if (!input.from || !input.to) {
        throw new AnalyticsPeriodError(
          'El periodo "custom" requiere "from" y "to" en formato YYYY-MM-DD',
        );
      }

      const from = assertDayKey(input.from, "from");
      const to = assertDayKey(input.to, "to");

      if (from > to) {
        throw new AnalyticsPeriodError(
          'El campo "from" no puede ser posterior a "to"',
        );
      }

      return buildPeriod("custom", describeRange(from, to), from, to);
    }

    default:
      throw new AnalyticsPeriodError(`Periodo no soportado: ${String(key)}`);
  }
};

/**
 * Periodo inmediatamente anterior del mismo tamano.
 * Se usa para comparaciones cuando el usuario no especifica el periodo base.
 */
export const resolvePreviousPeriod = (period: ResolvedPeriod): ResolvedPeriod => {
  if (period.key === "this_month") {
    const { year, month } = parseDayKey(period.fromDayKey);
    const prevMonth = month === 1 ? 12 : month - 1;
    const prevYear = month === 1 ? year - 1 : year;
    const dayOfMonth = parseDayKey(period.toDayKey).day;
    const start = buildDayKey(prevYear, prevMonth, 1);
    const end = buildDayKey(
      prevYear,
      prevMonth,
      Math.min(dayOfMonth, lastDayOfMonth(prevYear, prevMonth)),
    );
    return buildPeriod(
      "custom",
      `mismo tramo de ${MONTH_LABELS[prevMonth - 1]} ${prevYear} (${describeRange(start, end)})`,
      start,
      end,
    );
  }

  const end = shiftDayKey(period.fromDayKey, -1);
  const start = shiftDayKey(end, -(period.days - 1));

  return buildPeriod(
    "custom",
    `periodo previo comparable (${describeRange(start, end)})`,
    start,
    end,
  );
};

/** Lista de dayKeys incluidos en el periodo, util para series temporales. */
export const listDayKeys = (period: ResolvedPeriod): string[] => {
  const keys: string[] = [];
  let cursor = period.fromDayKey;

  while (cursor <= period.toDayKey) {
    keys.push(cursor);
    cursor = shiftDayKey(cursor, 1);
  }

  return keys;
};

/** Serializacion compacta del periodo para enviarla al modelo. */
export const describePeriodForModel = (period: ResolvedPeriod) => ({
  key: period.key,
  label: period.label,
  from: period.fromDayKey,
  to: period.toDayKey,
  days: period.days,
  timeZone: period.timeZone,
});
