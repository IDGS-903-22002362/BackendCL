import { configuracionLigaMx } from "../../config/liga-mx.config";

const FECHA_HORA_SIN_ZONA_RE =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.(\d{1,3}))?)?$/;
const TIENE_ZONA_EXPLICITA_RE = /(?:[zZ]|[+-]\d{2}:\d{2})$/;
const SUFIJO_Z_FALSO_RE = /[zZ]$/;
const TIENE_OFFSET_EXPLICITO_RE = /[+-]\d{2}:\d{2}$/;

interface ComponentesFechaHoraLocal {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  millisecond: number;
}

const aTextoNullable = (value: unknown): string | null => {
  if (value === null || value === undefined) {
    return null;
  }

  const trimmed = String(value).trim();
  return trimmed ? trimmed : null;
};

const normalizarCadenaFechaHora = (value: string): string => {
  return value.includes("T") ? value : value.replace(" ", "T");
};

const obtenerOffsetZonaHorariaMs = (date: Date, timeZone: string): number => {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts = formatter.formatToParts(date);
  const read = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);

  const asUtcMs = Date.UTC(
    read("year"),
    read("month") - 1,
    read("day"),
    read("hour"),
    read("minute"),
    read("second"),
  );

  return asUtcMs - date.getTime();
};

const convertirFechaHoraLocalAZonaUtc = (
  parts: ComponentesFechaHoraLocal,
  timeZone: string,
): Date | null => {
  const guessMs = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
    parts.millisecond,
  );
  const guess = new Date(guessMs);
  const offsetMs = obtenerOffsetZonaHorariaMs(guess, timeZone);

  return new Date(guessMs - offsetMs);
};

const parsearComponentesFechaHoraLocal = (
  value: string,
): ComponentesFechaHoraLocal | null => {
  const normalized = normalizarCadenaFechaHora(value);
  const match = normalized.match(FECHA_HORA_SIN_ZONA_RE);

  if (!match) {
    return null;
  }

  const [, year, month, day, hour = "0", minute = "0", second = "0", fractional = "0"] =
    match;

  return {
    year: Number(year),
    month: Number(month),
    day: Number(day),
    hour: Number(hour),
    minute: Number(minute),
    second: Number(second),
    millisecond: Number(fractional.padEnd(3, "0").slice(0, 3)),
  };
};

const esSufijoZUtcFalsoDeApi = (value: string): boolean => {
  return (
    SUFIJO_Z_FALSO_RE.test(value) &&
    !TIENE_OFFSET_EXPLICITO_RE.test(value) &&
    FECHA_HORA_SIN_ZONA_RE.test(value.replace(SUFIJO_Z_FALSO_RE, ""))
  );
};

const quitarSufijoZUtcFalso = (value: string): string => {
  return value.replace(SUFIJO_Z_FALSO_RE, "");
};

const DIAS_SEMANA_EN_US = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * Día de la semana (0 domingo … 6 sábado) y hora en la zona indicada.
 */
export const obtenerMomentoEnZona = (
  ahoraMs = Date.now(),
  timeZone = configuracionLigaMx.zonaHoraria,
): { diaSemana: number; hora: number } => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(ahoraMs));
  const weekday = parts.find((part) => part.type === "weekday")?.value ?? "";

  return {
    diaSemana: DIAS_SEMANA_EN_US.indexOf(weekday),
    hora: Number(parts.find((part) => part.type === "hour")?.value ?? -1),
  };
};

/**
 * Ventana semanal de clasificación: noches de miércoles y domingo (hora México),
 * para recoger los resultados del resto de la liga entre partidos del club.
 */
export const esVentanaSemanalClasificacion = (
  ahoraMs = Date.now(),
  timeZone = configuracionLigaMx.zonaHoraria,
): boolean => {
  const { diaSemana, hora } = obtenerMomentoEnZona(ahoraMs, timeZone);

  return (
    configuracionLigaMx.ventanasClasificacion.diasSemana.includes(diaSemana) &&
    hora === configuracionLigaMx.ventanasClasificacion.hora
  );
};

/**
 * Convierte fechas de la API de Liga MX (hora local MX sin offset) a epoch UTC.
 * Si la cadena trae offset real (+/-), se respeta. Un sufijo `Z` aislado se trata
 * como hora local de México mal etiquetada (no UTC real).
 */
export const parsearFechaPartidoApiMs = (
  value: unknown,
  timeZone = configuracionLigaMx.zonaHoraria,
): number | null => {
  const normalized = aTextoNullable(value);

  if (!normalized) {
    return null;
  }

  if (esSufijoZUtcFalsoDeApi(normalized)) {
    const componentes = parsearComponentesFechaHoraLocal(
      quitarSufijoZUtcFalso(normalized),
    );

    if (componentes) {
      const utcDate = convertirFechaHoraLocalAZonaUtc(componentes, timeZone);
      return utcDate && !Number.isNaN(utcDate.getTime()) ? utcDate.getTime() : null;
    }
  }

  if (TIENE_ZONA_EXPLICITA_RE.test(normalized)) {
    const date = new Date(normalized);
    return Number.isNaN(date.getTime()) ? null : date.getTime();
  }

  const componentes = parsearComponentesFechaHoraLocal(normalized);

  if (!componentes) {
    const date = new Date(normalizarCadenaFechaHora(normalized));
    return Number.isNaN(date.getTime()) ? null : date.getTime();
  }

  const utcDate = convertirFechaHoraLocalAZonaUtc(componentes, timeZone);
  return utcDate && !Number.isNaN(utcDate.getTime()) ? utcDate.getTime() : null;
};

/**
 * Igual que parsearFechaPartidoApiMs pero retorna ISO UTC para persistencia.
 */
export const fechaPartidoApiToIsoString = (
  value: unknown,
  timeZone = configuracionLigaMx.zonaHoraria,
): string | null => {
  const parsedMs = parsearFechaPartidoApiMs(value, timeZone);

  if (parsedMs === null) {
    return null;
  }

  return new Date(parsedMs).toISOString();
};
