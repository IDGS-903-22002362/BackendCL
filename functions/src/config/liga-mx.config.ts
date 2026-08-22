import { DivisionKey, PerfilDivision } from "../services/liga-mx/liga-mx.types";

const URL_BASE_POR_DEFECTO = "https://clubes.apilmx.com";
const ZONA_HORARIA_POR_DEFECTO = "America/Mexico_City";
// Cada 5 min revisa si algún partido (varonil/femenil) cumplió el corte de
// publicación (+2 h 15 min desde su hora programada) para no retrasar el cierre.
const PROGRAMACION_POR_PARTIDO_POR_DEFECTO = "*/5 * * * *";
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
    limpiarTexto(process.env.LMX_SCHEDULE) || PROGRAMACION_POR_PARTIDO_POR_DEFECTO,
  ttlMs: {
    contexto: 24 * 60 * 60 * 1000,
    /** Solo carga inicial o cambio de torneo: el refresco normal es al cierre del partido. */
    calendario: 7 * 24 * 60 * 60 * 1000,
    /** Guarda contra refrescos repetidos dentro de la misma ventana semanal. */
    clasificacion: 12 * 60 * 60 * 1000,
    /** Solo carga inicial o cambio de torneo: el refresco normal es al cierre del partido. */
    plantilla: 24 * 60 * 60 * 1000,
    perfilJugador: 30 * 24 * 60 * 60 * 1000,
    detalleEnVivo: 60 * 1000,
    detalleProgramado: 24 * 60 * 60 * 1000,
    detalleFinalizado: 30 * 24 * 60 * 60 * 1000,
    seguimientoResultado: 10 * 60 * 1000,
  },
  ventanaEnVivoAntesMs: 90 * 60 * 1000,
  ventanaEnVivoDespuesMs: 3 * 60 * 60 * 1000,
  /**
   * Corte de publicación: 2 h 15 min después de la hora programada del partido
   * (zona México). Antes de ese momento el marcador no se publica, para que la
   * app nunca muestre un resultado parcial como definitivo.
   */
  ventanaSeguimientoResultadoInicioMs: (2 * 60 + 15) * 60 * 1000,
  ventanaSeguimientoResultadoFinMs: 6 * 60 * 60 * 1000,
  /**
   * La clasificación es el único dato que además se refresca en horario fijo,
   * porque cambia cuando juega cualquier equipo de la liga y no solo el club:
   * noches de miércoles y domingo (hora México).
   */
  ventanasClasificacion: {
    diasSemana: [0, 3] as number[],
    hora: 23,
  },
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