import { DivisionKey, PerfilDivision } from "../services/liga-mx/liga-mx.types";

const URL_BASE_POR_DEFECTO = "https://clubes.apilmx.com";
const ZONA_HORARIA_POR_DEFECTO = "America/Mexico_City";
const PROGRAMACION_SEMANAL_POR_DEFECTO = "0 0 * * 1";
export const ID_TORNEO_APERTURA = 1;
export const ID_TORNEO_CLAUSURA = 2;

const limpiarTexto = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

export const perfilesDivision: Record<DivisionKey, PerfilDivision> = {
  varonil: {
    clave: "varonil",
    idDivision: 1,
    idClub: 9,
    nombreClub: "León",
    etiqueta: "Liga MX Varonil",
  },
  femenil: {
    clave: "femenil",
    idDivision: 14,
    idClub: 11243,
    nombreClub: "León Femenil",
    etiqueta: "Liga MX Femenil",
  },
};

export const configuracionLigaMx = {
  urlBase: limpiarTexto(process.env.LMX_API_BASE_URL) || URL_BASE_POR_DEFECTO,
  apiKey: limpiarTexto(process.env.LMX_API_KEY),
  zonaHoraria: limpiarTexto(process.env.LMX_TIMEZONE) || ZONA_HORARIA_POR_DEFECTO,
  programacion:
    limpiarTexto(process.env.LMX_SCHEDULE) || PROGRAMACION_SEMANAL_POR_DEFECTO,
  ttlMs: {
    contexto: 24 * 60 * 60 * 1000,
    calendario: 4 * 60 * 60 * 1000,
    clasificacion: 12 * 60 * 60 * 1000,
    plantilla: 24 * 60 * 60 * 1000,
    perfilJugador: 30 * 24 * 60 * 60 * 1000,
    detalleEnVivo: 60 * 1000,
    detalleProgramado: 24 * 60 * 60 * 1000,
    detalleFinalizado: 30 * 24 * 60 * 60 * 1000,
    seguimientoResultado: 10 * 60 * 1000,
  },
  ventanaEnVivoAntesMs: 90 * 60 * 1000,
  ventanaEnVivoDespuesMs: 3 * 60 * 60 * 1000,
  ventanaSeguimientoResultadoInicioMs: 105 * 60 * 1000,
  ventanaSeguimientoResultadoFinMs: 225 * 60 * 1000,
  presupuestoSincronizacion: {
    perfilesJugadorPorCorrida: 4,
    detallesPartidoPorCorrida: 2,
  },
};

export const validarConfiguracionLigaMx = (): void => {
  if (!configuracionLigaMx.apiKey) {
    throw new Error("Falta configurar LMX_API_KEY para sincronizar Liga MX");
  }
};

export const obtenerPerfilDivision = (divisionKey: DivisionKey): PerfilDivision => {
  return perfilesDivision[divisionKey];
};

export const obtenerNombreTorneo = (id: number): string => {
  return id === ID_TORNEO_APERTURA ? "Apertura" : "Clausura";
};

export const resolverIdTorneoActual = (date = new Date()): number => {
  return date.getMonth() >= 6 ? ID_TORNEO_APERTURA : ID_TORNEO_CLAUSURA;
};

export const resolverNombreTemporadaActual = (date = new Date()): string => {
  const year = date.getFullYear();

  if (date.getMonth() >= 6) {
    return `${year}-${year + 1}`;
  }

  return `${year - 1}-${year}`;
};