/**
 * Fecha operativa del POS en `America/Mexico_City`.
 *
 * Estrategia de medianoche (DEC-09):
 *
 * 1. `operationalDateOf(date, cutoffHour)` resta `cutoffHour` horas antes de tomar la fecha
 *    civil de Ciudad de México. Con `cutoffHour = 0` la fecha operativa coincide con el día
 *    civil; con `cutoffHour = 4`, una venta a las 02:00 pertenece al día anterior.
 * 2. Toda operación asociada a una sesión de caja **hereda** el `operationalDate` de la
 *    sesión, no lo recalcula. Así un turno abierto a las 23:50 que vende a las 00:30 cuadra
 *    en el mismo corte y en el mismo cierre diario.
 *
 * No se usa la hora del cliente en ningún caso: la entrada es siempre un `Date` derivado de
 * un timestamp de servidor.
 */

import PosProblemError from "../errors/pos-problem.error";
import { POS_TIMEZONE } from "../constants/pos.constants";

export const OPERATIONAL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const dateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: POS_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const dateTimeFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: POS_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

function assertCutoffHour(cutoffHour: number): number {
  if (!Number.isInteger(cutoffHour) || cutoffHour < 0 || cutoffHour > 23) {
    throw new PosProblemError(
      "SETTINGS_INVALID",
      "operationalDayCutoffHour debe ser un entero entre 0 y 23.",
    );
  }
  return cutoffHour;
}

/** Fecha operativa `YYYY-MM-DD` para un instante dado. */
export function operationalDateOf(instant: Date, cutoffHour = 0): string {
  if (Number.isNaN(instant.getTime())) {
    throw new PosProblemError("POS_VALIDATION_ERROR", "Fecha inválida.");
  }
  const shifted = new Date(
    instant.getTime() - assertCutoffHour(cutoffHour) * 60 * 60 * 1000,
  );
  return dateFormatter.format(shifted);
}

/** Fecha y hora local de Ciudad de México en formato `YYYY-MM-DD HH:mm:ss`. */
export function localDateTimeOf(instant: Date): string {
  return dateTimeFormatter.format(instant).replace(",", "");
}

export function isValidOperationalDate(value: unknown): value is string {
  if (typeof value !== "string" || !OPERATIONAL_DATE_PATTERN.test(value)) {
    return false;
  }
  const [year, month, day] = value.split("-").map((part) => Number(part));
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return false;
  }
  const utc = new Date(Date.UTC(year, month - 1, day));
  return (
    utc.getUTCFullYear() === year &&
    utc.getUTCMonth() === month - 1 &&
    utc.getUTCDate() === day
  );
}

export function assertOperationalDate(value: unknown): string {
  if (!isValidOperationalDate(value)) {
    throw new PosProblemError(
      "POS_VALIDATION_ERROR",
      "La fecha operativa debe tener formato YYYY-MM-DD y ser una fecha real.",
    );
  }
  return value;
}

/** Suma (o resta con valores negativos) días a una fecha operativa. */
export function addDaysToOperationalDate(
  operationalDate: string,
  days: number,
): string {
  assertOperationalDate(operationalDate);
  if (!Number.isInteger(days)) {
    throw new PosProblemError("POS_VALIDATION_ERROR", "days debe ser un entero.");
  }
  const [year, month, day] = operationalDate.split("-").map(Number);
  const utc = new Date(Date.UTC(year, month - 1, day));
  utc.setUTCDate(utc.getUTCDate() + days);
  return [
    utc.getUTCFullYear(),
    String(utc.getUTCMonth() + 1).padStart(2, "0"),
    String(utc.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

/** Días transcurridos entre dos fechas operativas (`to - from`). */
export function operationalDateDiffInDays(from: string, to: string): number {
  assertOperationalDate(from);
  assertOperationalDate(to);
  const toUtc = (value: string): number => {
    const [year, month, day] = value.split("-").map(Number);
    return Date.UTC(year, month - 1, day);
  };
  return Math.round((toUtc(to) - toUtc(from)) / (24 * 60 * 60 * 1000));
}

export function compareOperationalDates(a: string, b: string): number {
  assertOperationalDate(a);
  assertOperationalDate(b);
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Rango `[startInclusive, endExclusive)` en instantes UTC para una fecha operativa.
 * Útil para consultas por rango sobre timestamps de servidor.
 */
export function operationalDateBounds(
  operationalDate: string,
  cutoffHour = 0,
): { start: Date; end: Date } {
  assertOperationalDate(operationalDate);
  assertCutoffHour(cutoffHour);

  // La fecha operativa D cubre desde el instante en que la fecha civil desplazada pasa a D
  // hasta que pasa a D+1. Se resuelve por búsqueda directa sobre el offset real del día,
  // lo que respeta el horario de verano sin depender de una tabla de offsets.
  const start = findBoundary(operationalDate, cutoffHour);
  const end = findBoundary(addDaysToOperationalDate(operationalDate, 1), cutoffHour);
  return { start, end };
}

function findBoundary(operationalDate: string, cutoffHour: number): Date {
  const [year, month, day] = operationalDate.split("-").map(Number);
  // Aproximación inicial: medianoche local asumiendo UTC-6, y se corrige con el offset real.
  let guess = new Date(
    Date.UTC(year, month - 1, day, 6 + cutoffHour, 0, 0, 0),
  );
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const offsetMinutes = timezoneOffsetMinutes(guess);
    const corrected = new Date(
      Date.UTC(year, month - 1, day, cutoffHour, 0, 0, 0) +
        offsetMinutes * 60 * 1000,
    );
    if (corrected.getTime() === guess.getTime()) {
      return corrected;
    }
    guess = corrected;
  }
  return guess;
}

/** Minutos que hay que sumar a la hora local para obtener UTC (positivo al oeste). */
function timezoneOffsetMinutes(instant: Date): number {
  const parts = dateTimeFormatter.formatToParts(instant);
  const lookup = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value ?? "0");
  const asUtc = Date.UTC(
    lookup("year"),
    lookup("month") - 1,
    lookup("day"),
    lookup("hour") % 24,
    lookup("minute"),
    lookup("second"),
  );
  return Math.round((instant.getTime() - asUtc) / 60000);
}
