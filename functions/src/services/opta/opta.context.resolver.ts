import { DivisionKey, ResumenCalendarioOpta } from "./opta.types";

interface CalendarioCrudo {
  id?: unknown;
  name?: unknown;
  startDate?: unknown;
  endDate?: unknown;
  competition?: { name?: unknown; id?: unknown } | unknown;
  competitionName?: unknown;
}

const aTexto = (value: unknown): string => {
  if (value === null || value === undefined) {
    return "";
  }

  return String(value).trim();
};

export const extraerNombreCompetencia = (raw: CalendarioCrudo): string => {
  if (raw.competition && typeof raw.competition === "object") {
    return aTexto((raw.competition as { name?: unknown }).name);
  }

  return aTexto(raw.competitionName);
};

export const esCalendarioLigaMx = (
  nombreCompetencia: string,
  clave: DivisionKey,
): boolean => {
  const nombre = nombreCompetencia.toLowerCase();
  const esFemenil =
    nombre.includes("femenil") ||
    nombre.includes("femenino") ||
    nombre.includes("women");
  const esLigaMx =
    nombre.includes("liga mx") ||
    nombre.includes("ligamx") ||
    nombre.includes("mexican primera") ||
    (nombre.includes("mexico") && nombre.includes("primera"));

  if (!esLigaMx && !nombre.includes("liga bbva mx")) {
    return false;
  }

  return clave === "femenil" ? esFemenil : !esFemenil;
};

export const seleccionarCalendarioActivo = (
  calendarios: CalendarioCrudo[],
  clave: DivisionKey,
  ahoraMs = Date.now(),
): ResumenCalendarioOpta | null => {
  const candidatos = calendarios
    .map((raw) => {
      const nombreCompetencia = extraerNombreCompetencia(raw);

      if (!esCalendarioLigaMx(nombreCompetencia, clave)) {
        return null;
      }

      const fechaInicio = aTexto(raw.startDate) || null;
      const fechaFin = aTexto(raw.endDate) || null;

      return {
        id: aTexto(raw.id),
        nombre: aTexto(raw.name) || nombreCompetencia,
        nombreCompetencia,
        fechaInicio,
        fechaFin,
        inicioMs: fechaInicio ? Date.parse(fechaInicio) : Number.NaN,
        finMs: fechaFin ? Date.parse(fechaFin) : Number.NaN,
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item?.id));

  const vigentes = candidatos.filter((item) => {
    if (Number.isNaN(item.inicioMs) && Number.isNaN(item.finMs)) {
      return true;
    }

    const despuesDeInicio =
      Number.isNaN(item.inicioMs) || ahoraMs >= item.inicioMs;
    const antesDeFin = Number.isNaN(item.finMs) || ahoraMs <= item.finMs;
    return despuesDeInicio && antesDeFin;
  });

  const pool = vigentes.length ? vigentes : candidatos;
  pool.sort((left, right) => {
    const leftMs = Number.isNaN(left.inicioMs) ? 0 : left.inicioMs;
    const rightMs = Number.isNaN(right.inicioMs) ? 0 : right.inicioMs;
    return rightMs - leftMs;
  });

  const elegido = pool[0];

  if (!elegido) {
    return null;
  }

  return {
    id: elegido.id,
    nombre: elegido.nombre,
    nombreCompetencia: elegido.nombreCompetencia,
    fechaInicio: elegido.fechaInicio,
    fechaFin: elegido.fechaFin,
  };
};
