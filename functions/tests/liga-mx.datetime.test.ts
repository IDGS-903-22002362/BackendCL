import { describe, expect, it } from "@jest/globals";
import {
  fechaPartidoApiToIsoString,
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
});
