import { Timestamp } from "firebase-admin/firestore";
import {
  ResumenPuntosAnual,
  TipoMovimientoPuntos,
} from "../models/usuario.model";

const MS_POR_DIA = 24 * 60 * 60 * 1000;

export interface CicloPuntosAnual {
  numero: number;
  etiqueta: string;
  fechaInicio: Timestamp;
  fechaFinProgramada: Timestamp;
}

interface MovimientoResumen {
  tipo: TipoMovimientoPuntos;
  puntos: number;
  saldoAnterior: number;
  saldoNuevo: number;
  fechaMovimiento: Timestamp;
}

export const crearEtiquetaCiclo = (numeroCiclo: number): string => {
  return `anio${numeroCiclo}`;
};

const sumarDias = (fecha: Date, dias: number): Date => {
  return new Date(fecha.getTime() + dias * MS_POR_DIA);
};

export const calcularCiclosCompletados = (
  fechaRegistro: Date,
  fechaReferencia: Date,
  diasExpiracion: number,
): number => {
  const diferenciaMs = fechaReferencia.getTime() - fechaRegistro.getTime();

  if (diferenciaMs <= 0) {
    return 0;
  }

  return Math.floor(diferenciaMs / (diasExpiracion * MS_POR_DIA));
};

export const obtenerCicloPorNumero = (
  fechaRegistro: Date,
  numeroCiclo: number,
  diasExpiracion: number,
): CicloPuntosAnual => {
  const fechaInicio = sumarDias(fechaRegistro, (numeroCiclo - 1) * diasExpiracion);
  const fechaFinProgramada = sumarDias(fechaRegistro, numeroCiclo * diasExpiracion);

  return {
    numero: numeroCiclo,
    etiqueta: crearEtiquetaCiclo(numeroCiclo),
    fechaInicio: Timestamp.fromDate(fechaInicio),
    fechaFinProgramada: Timestamp.fromDate(fechaFinProgramada),
  };
};

export const obtenerCicloActual = (
  fechaRegistro: Date,
  fechaReferencia: Date,
  diasExpiracion: number,
): CicloPuntosAnual => {
  const ciclosCompletados = calcularCiclosCompletados(
    fechaRegistro,
    fechaReferencia,
    diasExpiracion,
  );

  return obtenerCicloPorNumero(fechaRegistro, ciclosCompletados + 1, diasExpiracion);
};

export const construirResumenPuntosAnual = (
  ciclo: CicloPuntosAnual,
  saldoInicial: number,
): ResumenPuntosAnual => ({
  ciclo: ciclo.numero,
  etiqueta: ciclo.etiqueta,
  fechaInicio: ciclo.fechaInicio,
  fechaFinProgramada: ciclo.fechaFinProgramada,
  fechaExpiracionAplicada: null,
  saldoInicial,
  puntosGanados: 0,
  puntosCanjeados: 0,
  puntosBonificados: 0,
  puntosAjustados: 0,
  puntosExpirados: 0,
  saldoAntesDeExpirar: saldoInicial,
  saldoFinal: saldoInicial,
  totalMovimientos: 0,
  ultimoMovimientoAt: null,
});

export const aplicarMovimientoAResumen = (
  resumen: ResumenPuntosAnual,
  movimiento: MovimientoResumen,
): ResumenPuntosAnual => {
  const siguiente: ResumenPuntosAnual = {
    ...resumen,
    saldoAntesDeExpirar: movimiento.saldoNuevo,
    saldoFinal: movimiento.saldoNuevo,
    totalMovimientos: resumen.totalMovimientos + 1,
    ultimoMovimientoAt: movimiento.fechaMovimiento,
  };

  switch (movimiento.tipo) {
  case TipoMovimientoPuntos.ACUMULACION:
    siguiente.puntosGanados += Math.max(movimiento.puntos, 0);
    break;
  case TipoMovimientoPuntos.CANJE:
    siguiente.puntosCanjeados += Math.abs(movimiento.puntos);
    break;
  case TipoMovimientoPuntos.BONIFICACION:
    siguiente.puntosBonificados += Math.max(movimiento.puntos, 0);
    break;
  case TipoMovimientoPuntos.EXPIRACION:
    siguiente.puntosExpirados += Math.abs(movimiento.puntos);
    siguiente.saldoAntesDeExpirar = movimiento.saldoAnterior;
    siguiente.saldoFinal = movimiento.saldoNuevo;
    siguiente.fechaExpiracionAplicada = movimiento.fechaMovimiento;
    break;
  case TipoMovimientoPuntos.AJUSTE:
  case TipoMovimientoPuntos.DEVOLUCION:
    siguiente.puntosAjustados += movimiento.puntos;
    break;
  }

  return siguiente;
};