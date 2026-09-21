import { configuracionOpta } from "../../config/opta.config";

export const partidoDentroDeVentanaDeSilencio = (
  fechaHoraPartido: string | null,
  ahoraMs = Date.now(),
): boolean => {
  if (!fechaHoraPartido) {
    return false;
  }

  const inicioMs = new Date(fechaHoraPartido).getTime();

  if (Number.isNaN(inicioMs)) {
    return false;
  }

  return (
    ahoraMs >= inicioMs &&
    ahoraMs < inicioMs + configuracionOpta.ventanaPublicacionInicioMs
  );
};

export const puedePublicarseStats = (
  fechaHoraPartido: string | null,
  ahoraMs = Date.now(),
): boolean => {
  if (!fechaHoraPartido) {
    return false;
  }

  const inicioMs = new Date(fechaHoraPartido).getTime();

  if (Number.isNaN(inicioMs)) {
    return false;
  }

  return ahoraMs >= inicioMs + configuracionOpta.ventanaPublicacionInicioMs;
};

export const estaEnVentanaDeSeguimientoStats = (
  fechaHoraPartido: string | null,
  ahoraMs = Date.now(),
): boolean => {
  if (!puedePublicarseStats(fechaHoraPartido, ahoraMs)) {
    return false;
  }

  const inicioMs = new Date(fechaHoraPartido as string).getTime();

  return ahoraMs < inicioMs + configuracionOpta.ventanaPublicacionFinMs;
};
