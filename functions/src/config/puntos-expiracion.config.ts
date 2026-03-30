const ZONA_HORARIA_POR_DEFECTO = "America/Mexico_City";
const PROGRAMACION_POR_DEFECTO = "0 0 * * *";
const DIAS_EXPIRACION_POR_DEFECTO = 365;

const limpiarTexto = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

const leerNumeroPositivo = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

export const configuracionExpiracionPuntos = {
  zonaHoraria:
    limpiarTexto(process.env.PUNTOS_EXPIRACION_TIMEZONE) || ZONA_HORARIA_POR_DEFECTO,
  programacion:
    limpiarTexto(process.env.PUNTOS_EXPIRACION_SCHEDULE) || PROGRAMACION_POR_DEFECTO,
  diasExpiracionPorDefecto: leerNumeroPositivo(
    process.env.PUNTOS_EXPIRACION_DIAS_DEFAULT,
    DIAS_EXPIRACION_POR_DEFECTO,
  ),
};