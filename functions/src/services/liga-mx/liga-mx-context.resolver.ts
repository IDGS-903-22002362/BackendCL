import {
  configuracionLigaMx,
  ID_TORNEO_APERTURA,
  ID_TORNEO_CLAUSURA,
} from "../../config/liga-mx.config";
import { ResumenTemporada } from "./liga-mx.types";

const TEMPORADA_NOMBRE_RE = /^(\d{4})-(\d{4})$/;
const MIN_EQUIPOS_TABLA = 10;
const TEMPORADAS_A_PROBAR = 3;

export interface TemporadaLigaMxApi {
  idTemporada: number;
  nombre: string;
}

export interface TemporadaRecienteLigaMx extends TemporadaLigaMxApi {
  anioInicio: number;
}

export interface SenalesContextoLigaMx {
  idTemporada: number;
  nombreTemporada: string;
  idTorneo: number;
  equiposTabla: number;
  juegosJugadosTabla: number;
  partidosPublicados: number;
  fechasPartidoMs: number[];
}

export interface ContextoActivoResuelto {
  temporadaActual: ResumenTemporada;
  idTorneoActual: number;
}

export const parsearFechaPartidoApiMs = (value: unknown): number | null => {
  if (value === null || value === undefined) {
    return null;
  }

  const normalized = String(value).trim();

  if (!normalized) {
    return null;
  }

  const candidate = normalized.includes("T")
    ? normalized
    : normalized.replace(" ", "T");
  const date = new Date(candidate);

  return Number.isNaN(date.getTime()) ? null : date.getTime();
};

const obtenerAnioCalendario = (
  now = new Date(),
  timeZone = configuracionLigaMx.zonaHoraria,
): number => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
  }).formatToParts(now);

  return Number(parts.find((part) => part.type === "year")?.value);
};

export const filtrarTemporadasRecientes = (
  temporadas: TemporadaLigaMxApi[],
  now = new Date(),
  timeZone = configuracionLigaMx.zonaHoraria,
): TemporadaRecienteLigaMx[] => {
  const anioActual = obtenerAnioCalendario(now, timeZone);
  const parseadas = temporadas
    .map((temporada) => {
      const coincidencia = temporada.nombre.match(TEMPORADA_NOMBRE_RE);

      if (!coincidencia) {
        return null;
      }

      const anioInicio = Number(coincidencia[1]);

      if (anioInicio < 2000) {
        return null;
      }

      return {
        ...temporada,
        anioInicio,
      };
    })
    .filter((temporada): temporada is TemporadaRecienteLigaMx => temporada !== null);

  const enVentana = parseadas.filter(
    (temporada) =>
      temporada.anioInicio >= anioActual - 1 &&
      temporada.anioInicio <= anioActual + 1,
  );
  const candidatas = enVentana.length ? enVentana : parseadas;

  return candidatas.sort((left, right) => {
    const distanciaLeft = Math.abs(left.anioInicio - anioActual);
    const distanciaRight = Math.abs(right.anioInicio - anioActual);

    if (distanciaLeft !== distanciaRight) {
      return distanciaLeft - distanciaRight;
    }

    if (left.anioInicio !== right.anioInicio) {
      return right.anioInicio - left.anioInicio;
    }

    return right.idTemporada - left.idTemporada;
  });
};

export const obtenerCombinacionesContextoAProbar = (
  temporadas: TemporadaLigaMxApi[],
  now = new Date(),
  timeZone = configuracionLigaMx.zonaHoraria,
): Array<{ idTemporada: number; nombreTemporada: string; idTorneo: number }> => {
  const recientes = filtrarTemporadasRecientes(temporadas, now, timeZone).slice(
    0,
    TEMPORADAS_A_PROBAR,
  );

  return recientes.flatMap((temporada) =>
    [ID_TORNEO_APERTURA, ID_TORNEO_CLAUSURA].map((idTorneo) => ({
      idTemporada: temporada.idTemporada,
      nombreTemporada: temporada.nombre,
      idTorneo,
    })),
  );
};

const esCandidatoViable = (senales: SenalesContextoLigaMx): boolean => {
  return (
    senales.partidosPublicados > 0 ||
    senales.equiposTabla >= MIN_EQUIPOS_TABLA
  );
};

export const seleccionarContextoActivoDesdeSenales = (
  candidatos: SenalesContextoLigaMx[],
  nowMs = Date.now(),
): ContextoActivoResuelto | null => {
  const viables = candidatos.filter(esCandidatoViable);

  if (!viables.length) {
    return null;
  }

  const puntuados = viables.map((candidato) => {
    const distancias = candidato.fechasPartidoMs.map((fechaMs) =>
      Math.abs(fechaMs - nowMs),
    );
    const distanciaMinimaMs = distancias.length
      ? Math.min(...distancias)
      : Number.POSITIVE_INFINITY;

    return {
      candidato,
      distanciaMinimaMs,
    };
  });

  puntuados.sort((left, right) => {
    if (left.distanciaMinimaMs !== right.distanciaMinimaMs) {
      return left.distanciaMinimaMs - right.distanciaMinimaMs;
    }

    if (left.candidato.idTemporada !== right.candidato.idTemporada) {
      return right.candidato.idTemporada - left.candidato.idTemporada;
    }

    return right.candidato.idTorneo - left.candidato.idTorneo;
  });

  const elegido = puntuados[0].candidato;

  return {
    temporadaActual: {
      id: elegido.idTemporada,
      nombre: elegido.nombreTemporada,
    },
    idTorneoActual: elegido.idTorneo,
  };
};

export const contextoGuardadoCoincideConResuelto = (
  guardado: {
    temporadaActual: { id: number; nombre: string };
    torneoActual: { id: number };
  },
  resuelto: ContextoActivoResuelto,
): boolean => {
  return (
    guardado.temporadaActual.id === resuelto.temporadaActual.id &&
    guardado.temporadaActual.nombre === resuelto.temporadaActual.nombre &&
    guardado.torneoActual.id === resuelto.idTorneoActual
  );
};
