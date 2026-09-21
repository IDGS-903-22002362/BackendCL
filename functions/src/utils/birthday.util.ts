import { toDayKey } from "./day-key.util";

export const BIRTHDAY_TIMEZONE = "America/Mexico_City";

export type CalendarDate = {
  year: number;
  month: number;
  day: number;
};

const SPANISH_MONTHS: Record<string, number> = {
  enero: 1,
  febrero: 2,
  marzo: 3,
  abril: 4,
  mayo: 5,
  junio: 6,
  julio: 7,
  agosto: 8,
  septiembre: 9,
  setiembre: 9,
  octubre: 10,
  noviembre: 11,
  diciembre: 12,
};

const pad2 = (value: number): string => String(value).padStart(2, "0");

export const toCalendarDateKey = (date: CalendarDate): string =>
  `${date.year}-${pad2(date.month)}-${pad2(date.day)}`;

export const isLeapYear = (year: number): boolean =>
  year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);

export const isValidCalendarDate = (
  year: number,
  month: number,
  day: number,
): boolean => {
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day)
  ) {
    return false;
  }

  if (year < 1900 || year > 2100 || month < 1 || month > 12 || day < 1) {
    return false;
  }

  const check = new Date(Date.UTC(year, month - 1, day));
  return (
    check.getUTCFullYear() === year &&
    check.getUTCMonth() + 1 === month &&
    check.getUTCDate() === day
  );
};

export const getCalendarDateInTimezone = (
  now: Date,
  timeZone = BIRTHDAY_TIMEZONE,
): CalendarDate => {
  const [year, month, day] = toDayKey(now, timeZone).split("-").map(Number);
  return { year, month, day };
};

const fromUtcDate = (date: Date): CalendarDate | null => {
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();
  return isValidCalendarDate(year, month, day) ? { year, month, day } : null;
};

const fromParts = (
  year: number,
  month: number,
  day: number,
): CalendarDate | null =>
  isValidCalendarDate(year, month, day) ? { year, month, day } : null;

const parseNumericTimestamp = (value: number): CalendarDate | null => {
  if (!Number.isFinite(value) || value <= 0) {
    return null;
  }

  const millis = value >= 100_000_000_000 ? value : value * 1000;
  return fromUtcDate(new Date(millis));
};

const parseObjectTimestamp = (raw: Record<string, unknown>): CalendarDate | null => {
  if (typeof (raw as { toDate?: unknown }).toDate === "function") {
    const date = (raw as { toDate: () => Date }).toDate();
    return fromUtcDate(date);
  }

  const seconds =
    typeof raw._seconds === "number"
      ? raw._seconds
      : typeof raw.seconds === "number"
        ? raw.seconds
        : undefined;

  if (typeof seconds === "number") {
    return parseNumericTimestamp(seconds);
  }

  return null;
};

const parseSpanishDate = (value: string): CalendarDate | null => {
  const match = value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .match(/^(\d{1,2})\s+de\s+([a-z]+)\s+de\s+(\d{4})$/);

  if (!match) {
    return null;
  }

  const month = SPANISH_MONTHS[match[2]];
  if (!month) {
    return null;
  }

  return fromParts(Number(match[3]), month, Number(match[1]));
};

const parseDayMonthYear = (value: string): CalendarDate | null => {
  const match = value.trim().match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/);
  if (!match) {
    return null;
  }

  const first = Number(match[1]);
  const second = Number(match[2]);
  const year = Number(match[3]);

  // México: DD/MM/YYYY. Si el segundo valor no puede ser mes, no es un formato válido.
  if (second >= 1 && second <= 12) {
    return fromParts(year, second, first);
  }

  return null;
};

/**
 * Interpreta `fechaNacimiento` como fecha de calendario, nunca como instante local.
 * Timestamps legacy se leen en UTC; las cadenas usan el día literal para no correr
 * la fecha al final del mes o al cruzar medianoche en México.
 */
export function parseFechaNacimiento(raw: unknown): CalendarDate | null {
  if (raw === null || raw === undefined || raw === "") {
    return null;
  }

  if (raw instanceof Date) {
    return fromUtcDate(raw);
  }

  if (typeof raw === "number") {
    return parseNumericTimestamp(raw);
  }

  if (typeof raw === "object") {
    return parseObjectTimestamp(raw as Record<string, unknown>);
  }

  if (typeof raw !== "string") {
    return null;
  }

  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }

  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    return fromParts(
      Number(isoMatch[1]),
      Number(isoMatch[2]),
      Number(isoMatch[3]),
    );
  }

  const compactMatch = trimmed.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (compactMatch) {
    return fromParts(
      Number(compactMatch[1]),
      Number(compactMatch[2]),
      Number(compactMatch[3]),
    );
  }

  return parseDayMonthYear(trimmed) || parseSpanishDate(trimmed);
}

export function isBirthdayToday(
  birthDate: CalendarDate,
  today: CalendarDate,
): boolean {
  if (birthDate.month === today.month && birthDate.day === today.day) {
    return true;
  }

  // 29 de febrero: en años no bisiestos se celebra el 28.
  return (
    birthDate.month === 2 &&
    birthDate.day === 29 &&
    today.month === 2 &&
    today.day === 28 &&
    !isLeapYear(today.year)
  );
}

export function evaluateBirthdayToday(
  rawFechaNacimiento: unknown,
  timeZone = BIRTHDAY_TIMEZONE,
  now = new Date(),
): {
  isBirthday: boolean;
  today: CalendarDate;
  birthDate: CalendarDate | null;
} {
  const today = getCalendarDateInTimezone(now, timeZone);
  const birthDate = parseFechaNacimiento(rawFechaNacimiento);

  return {
    isBirthday: birthDate ? isBirthdayToday(birthDate, today) : false,
    today,
    birthDate,
  };
}
