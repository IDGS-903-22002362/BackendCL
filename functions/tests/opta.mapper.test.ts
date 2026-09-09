import { describe, expect, it } from "@jest/globals";
import {
  aplanarCalendariosOpta,
  construirComparativa,
  esClubLeon,
  nombresClubCoinciden,
  normalizarFixture,
  normalizarMatchStats,
  normalizarNombreClub,
} from "../src/services/opta/opta.mapper";
import {
  estaEnVentanaDeSeguimientoStats,
  partidoDentroDeVentanaDeSilencio,
  puedePublicarseStats,
} from "../src/services/opta/opta.datetime";
import { seleccionarCalendarioActivo } from "../src/services/opta/opta.context.resolver";

describe("opta mapper", () => {
  it("normalizes club names so Club León matches León", () => {
    expect(normalizarNombreClub("Club León")).toBe("leon");
    expect(nombresClubCoinciden("Club León", "León")).toBe(true);
    expect(esClubLeon("León Femenil")).toBe(true);
    expect(esClubLeon("Atlante")).toBe(false);
    expect(nombresClubCoinciden("Rayadas", "Monterrey")).toBe(true);
    expect(nombresClubCoinciden("Rayados", "Monterrey")).toBe(true);
    expect(nombresClubCoinciden("Chivas", "Guadalajara")).toBe(true);
    expect(nombresClubCoinciden("Pumas", "UNAM")).toBe(true);
    expect(nombresClubCoinciden("Atlante", "Monterrey")).toBe(false);
  });

  it("builds a home vs away comparison from Opta stat types", () => {
    const local = new Map([
      ["possessionPercentage", "47.8"],
      ["totalScoringAtt", "17"],
      ["ontargetScoringAtt", "4"],
    ]);
    const visita = new Map([
      ["possessionPercentage", "52.2"],
      ["totalScoringAtt", "12"],
      ["ontargetScoringAtt", "5"],
    ]);
    const filas = construirComparativa(local, visita);

    expect(filas[0]).toEqual({
      clave: "possessionPercentage",
      etiqueta: "Posesión",
      local: "47.8",
      visita: "52.2",
    });
    expect(filas.find((fila) => fila.clave === "ontargetScoringAtt")?.visita).toBe("5");
  });

  it("keeps a single Córners row when Opta sends both corner types", () => {
    const local = new Map([
      ["wonCorners", "6"],
      ["cornerTaken", "6"],
    ]);
    const visita = new Map([
      ["wonCorners", "3"],
      ["cornerTaken", "3"],
    ]);
    const filas = construirComparativa(local, visita);

    expect(filas.filter((fila) => fila.etiqueta === "Córners")).toHaveLength(1);
    expect(filas[0]?.clave).toBe("wonCorners");
  });

  it("flattens OT2 competitions into tournament calendars", () => {
    const calendarios = aplanarCalendariosOpta({
      competition: [
        {
          id: "liga-mx",
          name: "Liga MX",
          tournamentCalendar: [
            {
              id: "apertura",
              name: "Apertura 2026",
              startDate: "2026-07-01Z",
              endDate: "2026-12-15Z",
            },
          ],
        },
        {
          id: "femenil",
          name: "Liga MX Femenil",
          tournamentCalendar: {
            id: "apertura-fem",
            name: "Apertura 2026",
            startDate: "2026-07-01Z",
            endDate: "2026-12-15Z",
          },
        },
      ],
    });

    expect(calendarios).toHaveLength(2);
    expect(calendarios[0]).toMatchObject({
      id: "apertura",
      competitionName: "Liga MX",
    });
    expect(calendarios[1]).toMatchObject({
      id: "apertura-fem",
      competitionName: "Liga MX Femenil",
    });
  });

  it("normalizes MA2 payload into a frontend-friendly document", () => {
    const fixture = normalizarFixture(
      {
        matchInfo: {
          id: "fx-atlante-leon",
          dateTime: "2026-08-29T02:00:00Z",
          localDate: "2026-08-28",
          contestant: [
            { id: "atlante", name: "Atlante", position: "home" },
            { id: "leon", name: "Club León", position: "away" },
          ],
        },
      },
      "varonil",
    );

    expect(fixture?.local.nombre).toBe("Atlante");
    expect(fixture?.visita.nombre).toBe("Club León");

    const stats = normalizarMatchStats({
      fixture: fixture!,
      raw: {
        matchStats: {
          liveData: {
            matchDetails: { matchStatus: "Played" },
            lineUp: [
              {
                contestantId: "atlante",
                stat: [
                  { type: "possessionPercentage", value: "47.8" },
                  { type: "totalScoringAtt", value: "17" },
                ],
              },
              {
                contestantId: "leon",
                stat: [
                  { type: "possessionPercentage", value: "52.2" },
                  { type: "totalScoringAtt", value: "12" },
                ],
              },
            ],
          },
        },
      },
      idPartidoLigaMx: 401876999,
      temporadaActual: { id: "cal-1", nombre: "Apertura 2026" },
      torneoActual: { id: "cal-1", nombre: "Liga MX" },
      sincronizadoEn: "2026-08-29T05:00:00.000Z",
    });

    expect(stats.id).toBe("401876999");
    expect(stats.comparativa).toHaveLength(2);
    expect(stats.local.nombre).toBe("Atlante");
  });
});

describe("opta datetime windows", () => {
  const kickoff = "2026-08-29T01:00:00.000Z";

  it("keeps the silence window until 2h 15m after kickoff", () => {
    expect(
      partidoDentroDeVentanaDeSilencio(kickoff, Date.parse("2026-08-29T02:00:00.000Z")),
    ).toBe(true);
    expect(
      puedePublicarseStats(kickoff, Date.parse("2026-08-29T03:14:00.000Z")),
    ).toBe(false);
    expect(
      puedePublicarseStats(kickoff, Date.parse("2026-08-29T03:15:00.000Z")),
    ).toBe(true);
    expect(
      partidoDentroDeVentanaDeSilencio(kickoff, Date.parse("2026-08-29T03:15:00.000Z")),
    ).toBe(false);
  });

  it("follows stats until 6 hours after kickoff", () => {
    expect(
      estaEnVentanaDeSeguimientoStats(kickoff, Date.parse("2026-08-29T05:00:00.000Z")),
    ).toBe(true);
    expect(
      estaEnVentanaDeSeguimientoStats(kickoff, Date.parse("2026-08-29T07:01:00.000Z")),
    ).toBe(false);
  });
});

describe("opta context resolver", () => {
  it("picks the current Liga MX calendar and ignores Femenil for varonil", () => {
    const elegido = seleccionarCalendarioActivo(
      [
        {
          id: "old",
          name: "Clausura 2026",
          startDate: "2026-01-01",
          endDate: "2026-05-31",
          competition: { name: "Liga MX" },
        },
        {
          id: "current",
          name: "Apertura 2026",
          startDate: "2026-07-01",
          endDate: "2026-12-15",
          competition: { name: "Liga MX" },
        },
        {
          id: "fem",
          name: "Apertura 2026 Femenil",
          startDate: "2026-07-01",
          endDate: "2026-12-15",
          competition: { name: "Liga MX Femenil" },
        },
      ],
      "varonil",
      Date.parse("2026-09-01T18:00:00.000Z"),
    );

    expect(elegido?.id).toBe("current");
    expect(
      seleccionarCalendarioActivo(
        [
          {
            id: "fem",
            name: "Apertura 2026 Femenil",
            startDate: "2026-07-01",
            endDate: "2026-12-15",
            competition: { name: "Liga MX Femenil" },
          },
        ],
        "femenil",
        Date.parse("2026-09-01T18:00:00.000Z"),
      )?.id,
    ).toBe("fem");
  });
});
