import {
  construirContextoActual,
  normalizarEventoNarracion,
  normalizarJugadorPlantilla,
  normalizarPartidoCalendario,
  partidoDentroDeVentanaEnVivo,
  seleccionarTemporadaActual,
} from "../src/services/liga-mx/liga-mx.mapper";
import { resolverIdTorneoActual } from "../src/config/liga-mx.config";

describe("liga-mx mapper", () => {
  it("selects the current season based on the current date", () => {
    const seasons = [
      { idTemporada: 75, nombre: "2024-2025" },
      { idTemporada: 76, nombre: "2025-2026" },
      { idTemporada: 77, nombre: "2026-2027" },
    ];

    expect(seleccionarTemporadaActual(seasons, new Date("2026-03-27T12:00:00Z"))).toEqual({
      id: 76,
      nombre: "2025-2026",
    });
    expect(seleccionarTemporadaActual(seasons, new Date("2026-08-01T12:00:00Z"))).toEqual({
      id: 77,
      nombre: "2026-2027",
    });
  });

  it("normalizes a match payload into frontend-friendly fields", () => {
    const match = normalizarPartidoCalendario(
      {
        idPartido: 151216,
        idDivision: 1,
        division: "LIGA MX",
        idTemporada: 76,
        temporada: "2025-2026",
        idTorneo: 2,
        torneo: "Clausura",
        idFase: 1,
        fase: "Calificación",
        idJornada: 1,
        jornada: "Jornada 1",
        jornadaAbreviada: "J-1",
        numeroJornada: 1,
        matchDate: "2026-01-10 19:00:00.000",
        fecha: "2026-01-10",
        hora: "19:00",
        idEstatusPartido: 2,
        idEstatusMinutoAMinuto: 7,
        estatusMinutoAMinuto: "Marcador Oficial",
        idEstatusPublicado: 1,
        idEstadio: 23,
        estadio: "Nou Camp",
        estadioUrl: "nou-camp",
        idCanaldeTV: 198,
        canaldeTV: "foxone",
        canaldeTVUSA: "ND",
        canalTvUrl: "foxone",
        idClubLocal: 9,
        clubLocal: "León",
        clubLocalLogo: "https://local.png",
        clubLocalUrl: "leon",
        golLocal: 2,
        penalLocal: 0,
        idClubVisita: 12566,
        clubVisita: "Cruz Azul",
        clubVisitaLogo: "https://visit.png",
        clubVisitaUrl: "cruz-azul",
        golVisita: 1,
        penalVisita: 0,
        arbitroCentral: "Árbitro Central",
        arbitroAsistente1: "Asistente 1",
        arbitroAsistente2: "Asistente 2",
        cuartoArbitro: "Cuarto Árbitro",
        mrcdFchaMdfc: "2026-01-11 00:39:06",
      },
      "varonil",
      "2026-03-27T12:00:00.000Z",
    );

    expect(match.id).toBe("151216");
    expect(match.local.nombre).toBe("León");
    expect(match.visita.nombre).toBe("Cruz Azul");
    expect(match.jornada.nombreCorto).toBe("J-1");
    expect(match.fechaHoraPartido).toBe("2026-01-11T01:00:00.000Z");
    expect(match.hashFuente).toBeTruthy();
  });

  it("builds normalized context and live window checks", () => {
    const payload = construirContextoActual(
      [
        { idTemporada: 76, nombre: "2025-2026" },
        { idTemporada: 77, nombre: "2026-2027" },
      ],
      resolverIdTorneoActual(new Date("2026-03-27T12:00:00Z")),
      "2026-03-27T12:00:00.000Z",
      new Date("2026-03-27T12:00:00Z"),
    );

    expect(payload.temporadaActual.nombre).toBe("2025-2026");
    expect(payload.torneoActual.nombre).toBe("Clausura");
    expect(
      partidoDentroDeVentanaEnVivo(
        "2026-03-27T12:30:00.000Z",
        90 * 60 * 1000,
        3 * 60 * 60 * 1000,
        new Date("2026-03-27T12:00:00.000Z").getTime(),
      ),
    ).toBe(true);
  });

  it("normalizes player and narration records", () => {
    const player = normalizarJugadorPlantilla({
      idJugador: 189479,
      idClub: 9,
      nombreCompletojugador: "Jordan Javier García Bonett",
      nombreJugador: "Jordan Javier",
      paternoJugador: "García",
      maternoJugador: "Bonett",
      nacionalidad: "Colombiano",
      posicion: "Portero",
      idPosicion: 1,
      idPosicionPadre: 1,
      numeroCamiseta: 1,
      edad: 20,
      estatura: 1.86,
      foto: "https://foto.png",
      minutosJugados: 270,
      juegosJugados: 3,
      goles: 0,
      tarjetasAmarillas: 1,
      tarjetasRojas: 0,
      autogoles: 0,
    });
    const event = normalizarEventoNarracion({
      idEvento: 618968,
      min: 99,
      tipo: "Comentario",
      detalle: "-",
      fase: "Marcador Final",
      idClub: 0,
      idJugador: "-",
      x: 0,
      y: 0,
      comentario: "Final del Partido",
      esttVdeo: 0,
    });

    expect(player.estadisticas.minutosJugados).toBe(270);
    expect(player.posicion).toBe("Portero");
    expect(event.comentario).toBe("Final del Partido");
    expect(event.videoDisponible).toBe(false);
  });
});