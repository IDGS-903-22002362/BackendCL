import { describe, expect, it } from "@jest/globals";
import {
  contextoGuardadoCoincideConResuelto,
  filtrarTemporadasRecientes,
  obtenerCombinacionesContextoAProbar,
  seleccionarContextoActivoDesdeSenales,
  SenalesContextoLigaMx,
} from "../src/services/liga-mx/liga-mx-context.resolver";
import { ID_TORNEO_APERTURA, ID_TORNEO_CLAUSURA } from "../src/config/liga-mx.config";

const temporadas = [
  { idTemporada: 75, nombre: "2024-2025" },
  { idTemporada: 76, nombre: "2025-2026" },
  { idTemporada: 77, nombre: "2026-2027" },
  { idTemporada: 152, nombre: "1900-1901" },
];

const crearSenales = (
  idTemporada: number,
  nombreTemporada: string,
  idTorneo: number,
  fechasPartido: string[],
  overrides: Partial<SenalesContextoLigaMx> = {},
): SenalesContextoLigaMx => ({
  idTemporada,
  nombreTemporada,
  idTorneo,
  equiposTabla: 18,
  juegosJugadosTabla: fechasPartido.length,
  partidosPublicados: fechasPartido.length,
  fechasPartidoMs: fechasPartido.map((fecha) => new Date(fecha).getTime()),
  ...overrides,
});

describe("liga-mx context resolver", () => {
  it("ignores legacy seasons and keeps the most recent football seasons", () => {
    expect(
      filtrarTemporadasRecientes(temporadas, new Date("2026-06-18T18:00:00.000Z")).map(
        (season) => season.nombre,
      ),
    ).toEqual(["2026-2027", "2025-2026"]);
  });

  it("ignores far-future placeholder seasons from the API", () => {
    const resueltos = filtrarTemporadasRecientes(
      [
        ...temporadas,
        { idTemporada: 102, nombre: "2051-2052" },
        { idTemporada: 101, nombre: "2050-2051" },
      ],
      new Date("2026-06-18T18:00:00.000Z"),
    ).map((season) => season.nombre);

    expect(resueltos).toEqual(["2026-2027", "2025-2026"]);
    expect(resueltos).not.toContain("2051-2052");
  });

  it("builds probe combinations for the latest seasons and both tournaments", () => {
    const combinaciones = obtenerCombinacionesContextoAProbar(
      temporadas,
      new Date("2026-06-18T18:00:00.000Z"),
    );

    expect(combinaciones).toEqual([
      { idTemporada: 77, nombreTemporada: "2026-2027", idTorneo: ID_TORNEO_APERTURA },
      { idTemporada: 77, nombreTemporada: "2026-2027", idTorneo: ID_TORNEO_CLAUSURA },
      { idTemporada: 76, nombreTemporada: "2025-2026", idTorneo: ID_TORNEO_APERTURA },
      { idTemporada: 76, nombreTemporada: "2025-2026", idTorneo: ID_TORNEO_CLAUSURA },
    ]);
  });

  it("selects Clausura while its calendar is closest to today", () => {
    const resuelto = seleccionarContextoActivoDesdeSenales(
      [
        crearSenales(76, "2025-2026", ID_TORNEO_CLAUSURA, [
          "2026-01-10T19:00:00.000Z",
          "2026-03-27T19:00:00.000Z",
          "2026-04-25T19:00:00.000Z",
        ]),
        crearSenales(77, "2026-2027", ID_TORNEO_APERTURA, [
          "2026-07-17T19:00:00.000Z",
          "2026-11-21T17:00:00.000Z",
        ]),
      ],
      new Date("2026-03-27T12:00:00.000Z").getTime(),
    );

    expect(resuelto).toEqual({
      temporadaActual: { id: 76, nombre: "2025-2026" },
      idTorneoActual: ID_TORNEO_CLAUSURA,
    });
  });

  it("switches to the next published tournament when the previous one ended", () => {
    const resuelto = seleccionarContextoActivoDesdeSenales(
      [
        crearSenales(76, "2025-2026", ID_TORNEO_CLAUSURA, [
          "2026-01-10T19:00:00.000Z",
          "2026-04-25T19:00:00.000Z",
        ]),
        crearSenales(77, "2026-2027", ID_TORNEO_APERTURA, [
          "2026-07-17T19:00:00.000Z",
          "2026-11-21T17:00:00.000Z",
        ]),
      ],
      new Date("2026-06-18T18:00:00.000Z").getTime(),
    );

    expect(resuelto).toEqual({
      temporadaActual: { id: 77, nombre: "2026-2027" },
      idTorneoActual: ID_TORNEO_APERTURA,
    });
  });

  it("compares stored context against the API-resolved context", () => {
    const resuelto = {
      temporadaActual: { id: 77, nombre: "2026-2027" },
      idTorneoActual: ID_TORNEO_APERTURA,
    };

    expect(
      contextoGuardadoCoincideConResuelto(
        {
          temporadaActual: { id: 77, nombre: "2026-2027" },
          torneoActual: { id: ID_TORNEO_APERTURA },
        },
        resuelto,
      ),
    ).toBe(true);

    expect(
      contextoGuardadoCoincideConResuelto(
        {
          temporadaActual: { id: 76, nombre: "2025-2026" },
          torneoActual: { id: ID_TORNEO_CLAUSURA },
        },
        resuelto,
      ),
    ).toBe(false);
  });
});
