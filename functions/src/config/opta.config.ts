const URL_BASE_POR_DEFECTO = "https://api.statsperform.com/sdapi/v1";
const URL_TOKEN_POR_DEFECTO =
  "https://api.statsperform.com/realms/apigw/protocol/openid-connect/token";
const ZONA_HORARIA_POR_DEFECTO = "America/Mexico_City";
const PROGRAMACION_POR_DEFECTO = "*/5 * * * *";

const limpiarTexto = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

export const configuracionOpta = {
  urlBase: limpiarTexto(process.env.OPTA_API_BASE_URL) || URL_BASE_POR_DEFECTO,
  urlToken: limpiarTexto(process.env.OPTA_TOKEN_URL) || URL_TOKEN_POR_DEFECTO,
  apiKey: limpiarTexto(process.env.OPTA_API_KEY),
  clientId: limpiarTexto(process.env.OPTA_CLIENT_ID),
  clientSecret: limpiarTexto(process.env.OPTA_CLIENT_SECRET),
  zonaHoraria: limpiarTexto(process.env.OPTA_TIMEZONE) || ZONA_HORARIA_POR_DEFECTO,
  programacion:
    limpiarTexto(process.env.OPTA_SCHEDULE) || PROGRAMACION_POR_DEFECTO,
  ttlMs: {
    contexto: 24 * 60 * 60 * 1000,
    fixtures: 7 * 24 * 60 * 60 * 1000,
    statsPublicadas: 30 * 24 * 60 * 60 * 1000,
    seguimientoResultado: 10 * 60 * 1000,
  },
  /**
   * Mismo corte que Liga MX: no publicar stats hasta 2 h 15 min después
   * de la hora programada, para no mostrar un recuadro parcial.
   */
  ventanaPublicacionInicioMs: (2 * 60 + 15) * 60 * 1000,
  ventanaPublicacionFinMs: 6 * 60 * 60 * 1000,
  presupuestoSincronizacion: {
    statsPorCorrida: 2,
  },
};

export const tieneCredencialesOpta = (): boolean => {
  return Boolean(
    configuracionOpta.apiKey &&
      configuracionOpta.clientId &&
      configuracionOpta.clientSecret,
  );
};

export const validarConfiguracionOpta = (): void => {
  if (!tieneCredencialesOpta()) {
    throw new Error(
      "Faltan OPTA_API_KEY, OPTA_CLIENT_ID y OPTA_CLIENT_SECRET (API Gateway de Stats Perform, no el login de docs ni una outlet key antigua)",
    );
  }
};
