import { describe, expect, it } from "@jest/globals";
import {
  esVentanaSemanalClasificacion,
  fechaPartidoApiToIsoString,
  obtenerMomentoEnZona,
  parsearFechaPartidoApiMs,
} from "../src/services/liga-mx/liga-mx.datetime";

describe("liga-mx datetime", () => {
  it("converts API matchDate without timezone from Mexico City to UTC", () => {
    expect(fechaPartidoApiToIsoString("2026-01-10 19:00:00.000")).toBe(
      "2026-01-11T01:00:00.000Z",
    );
    expect(fechaPartidoApiToIsoString("2026-07-17 19:00:00.000")).toBe(
      "2026-07-18T01:00:00.000Z",
    );
    expect(fechaPartidoApiToIsoString("2026-09-06 12:00:00.000")).toBe(
      "2026-09-06T18:00:00.000Z",
    );
  });

  it("treats trailing Z on API matchDate as Mexico local, not UTC", () => {
    expect(fechaPartidoApiToIsoString("2026-08-17T19:00:00.000Z")).toBe(
      "2026-08-18T01:00:00.000Z",
    );
    expect(fechaPartidoApiToIsoString("2026-01-10 19:00:00.000Z")).toBe(
      "2026-01-11T01:00:00.000Z",
    );
  });

  it("keeps explicit offset timezone values unchanged", () => {
    expect(fechaPartidoApiToIsoString("2026-01-11T01:00:00.000+00:00")).toBe(
      "2026-01-11T01:00:00.000Z",
    );
  });

  it("parses date-only values at midnight in Mexico City", () => {
    expect(parsearFechaPartidoApiMs("2026-07-17")).toBe(
      Date.parse("2026-07-17T06:00:00.000Z"),
    );
  });

  it("returns null for empty values", () => {
    expect(parsearFechaPartidoApiMs(null)).toBeNull();
    expect(parsearFechaPartidoApiMs("")).toBeNull();
    expect(fechaPartidoApiToIsoString(undefined)).toBeNull();
  });

  it("reads weekday and hour in Mexico City", () => {
    // 2026-08-27T04:30:00Z = miércoles 26 de agosto, 22:30 en México.
    expect(obtenerMomentoEnZona(Date.parse("2026-08-27T04:30:00.000Z"))).toEqual({
      diaSemana: 3,
      hora: 22,
    });
  });

  it("only opens the standings window on Wednesday and Sunday nights", () => {
    const enVentana = (iso: string) =>
      esVentanaSemanalClasificacion(Date.parse(iso));

    // Miércoles 23:30 y domingo 23:05 (hora México).
    expect(enVentana("2026-08-27T05:30:00.000Z")).toBe(true);
    expect(enVentana("2026-08-31T05:05:00.000Z")).toBe(true);

    // Miércoles 22:30 (aún no) y jueves 23:30 (otro día).
    expect(enVentana("2026-08-27T04:30:00.000Z")).toBe(false);
    expect(enVentana("2026-08-28T05:30:00.000Z")).toBe(false);
  });
});
