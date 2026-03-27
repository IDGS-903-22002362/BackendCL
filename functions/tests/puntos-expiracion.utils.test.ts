import { describe, expect, it } from "@jest/globals";
import { Timestamp } from "firebase-admin/firestore";
import { TipoMovimientoPuntos } from "../src/models/usuario.model";
import {
  aplicarMovimientoAResumen,
  calcularCiclosCompletados,
  construirResumenPuntosAnual,
  crearEtiquetaCiclo,
  obtenerCicloActual,
  obtenerCicloPorNumero,
} from "../src/services/puntos-expiracion.utils";

describe("puntos-expiracion.utils", () => {
  it("crea etiquetas anuales consecutivas", () => {
    expect(crearEtiquetaCiclo(1)).toBe("anio1");
    expect(crearEtiquetaCiclo(2)).toBe("anio2");
  });

  it("calcula ciclos completos desde la fecha de registro", () => {
    const fechaRegistro = new Date("2024-03-27T10:00:00.000Z");
    const fechaReferencia = new Date("2026-03-27T10:00:00.000Z");

    expect(calcularCiclosCompletados(fechaRegistro, fechaReferencia, 365)).toBe(2);
  });

  it("obtiene el ciclo actual y el resumen inicial del ciclo", () => {
    const fechaRegistro = new Date("2024-03-27T10:00:00.000Z");
    const fechaReferencia = new Date("2025-05-01T10:00:00.000Z");
    const cicloActual = obtenerCicloActual(fechaRegistro, fechaReferencia, 365);

    expect(cicloActual.numero).toBe(2);
    expect(cicloActual.etiqueta).toBe("anio2");

    const resumen = construirResumenPuntosAnual(cicloActual, 120);
    expect(resumen.saldoInicial).toBe(120);
    expect(resumen.puntosExpirados).toBe(0);
  });

  it("aplica una expiración al resumen anual", () => {
    const ciclo = obtenerCicloPorNumero(new Date("2024-03-27T10:00:00.000Z"), 1, 365);
    const resumen = construirResumenPuntosAnual(ciclo, 80);
    const now = Timestamp.fromDate(new Date("2025-03-27T10:00:00.000Z"));

    const actualizado = aplicarMovimientoAResumen(resumen, {
      tipo: TipoMovimientoPuntos.EXPIRACION,
      puntos: -80,
      saldoAnterior: 80,
      saldoNuevo: 0,
      fechaMovimiento: now,
    });

    expect(actualizado.puntosExpirados).toBe(80);
    expect(actualizado.saldoAntesDeExpirar).toBe(80);
    expect(actualizado.saldoFinal).toBe(0);
    expect(actualizado.fechaExpiracionAplicada?.toMillis()).toBe(now.toMillis());
  });
});