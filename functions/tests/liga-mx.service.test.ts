import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("../src/config/app.firebase", () => ({
  firestoreApp: {
    collection: jest.fn(() => ({
      doc: jest.fn(() => ({
        get: jest.fn(),
        set: jest.fn(),
      })),
      where: jest.fn(() => ({
        get: jest.fn(),
      })),
      get: jest.fn(),
    })),
  },
}));

import ligaMxService from "../src/services/liga-mx/liga-mx.service";
import { ContextoLigaMxDoc, PartidoLigaMxDoc } from "../src/services/liga-mx/liga-mx.types";

const contextoBase: ContextoLigaMxDoc = {
  temporadaActual: { id: 76, nombre: "2025-2026" },
  torneoActual: { id: 2, nombre: "Clausura" },
  divisiones: [],
  hashFuente: "contexto",
  actualizadoEn: "2026-04-13T06:00:24.094Z",
};

const crearPartido = (
  id: string,
  claveDivision: "varonil" | "femenil",
  estadoEtiqueta: string | null,
): PartidoLigaMxDoc => ({
  id,
  idPartido: Number(id),
  claveDivision,
  idDivision: claveDivision === "varonil" ? 1 : 14,
  nombreDivision: claveDivision === "varonil" ? "Liga MX" : "Liga MX Femenil",
  temporadaActual: contextoBase.temporadaActual,
  torneoActual: contextoBase.torneoActual,
  fase: { id: 1, nombre: "Calificación" },
  jornada: { id: 1, nombre: "Jornada 1", nombreCorto: "J1", numero: 1 },
  fechaHoraPartido: "2026-04-05T19:06:00.000Z",
  fecha: "2026-04-05",
  hora: "19:06",
  estado: {
    id: estadoEtiqueta ? 2 : null,
    idMinutoAMinuto: estadoEtiqueta === "Marcador Oficial" ? 7 : 6,
    etiquetaMinutoAMinuto: estadoEtiqueta,
    idPublicado: 1,
  },
  estadio: { id: 1, nombre: "Estadio Hidalgo", slug: "estadio-hidalgo" },
  transmision: { id: 1, nombre: "TV", nombreEstadosUnidos: null, slug: "tv" },
  local: { id: 1, nombre: "Pachuca", logo: null, slug: "pachuca", goles: 5, penales: null },
  visita: { id: 11243, nombre: "León", logo: null, slug: "leon", goles: 4, penales: null },
  arbitraje: {
    central: null,
    asistente1: null,
    asistente2: null,
    cuartoArbitro: null,
  },
  hashFuente: `${id}-${estadoEtiqueta ?? "pendiente"}`,
  actualizadoFuente: null,
  sincronizadoEn: "2026-04-13T06:00:25.008Z",
});

describe("liga-mx service", () => {
  const service = ligaMxService as any;

  beforeEach(() => {
    jest.restoreAllMocks();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  /**
   * Deja el cron listo con todo mockeado y devuelve los espías de sincronización.
   * `partidosFemenil` permite simular un partido en curso.
   */
  const prepararCron = (partidosFemenil: PartidoLigaMxDoc[]) => {
    jest.spyOn(service, "limpiarColeccionesLegado").mockResolvedValue(undefined);
    jest
      .spyOn(service, "sincronizarContextoActual")
      .mockResolvedValue({ contexto: contextoBase, cambioContexto: false });
    jest.spyOn(service, "obtenerCalendarioActual").mockImplementation(async (...args: unknown[]) => {
      const divisionKey = args[0] as "varonil" | "femenil";
      if (divisionKey === "femenil") {
        return { partidos: partidosFemenil };
      }

      return { partidos: [crearPartido("200000", "varonil", "Marcador Oficial")] };
    });
    jest.spyOn(service, "obtenerClasificacionActual").mockResolvedValue({ posiciones: [] });
    jest.spyOn(service, "obtenerPlantillaActual").mockResolvedValue({ jugadores: [] });
    jest.spyOn(service, "debeConsultarResultadosDivision").mockResolvedValue(false);
    // Todo lo de femenil está vencido por TTL: antes eso bastaba para consultar.
    jest.spyOn(service, "debeSincronizar").mockImplementation(async (...args: unknown[]) => {
      const clave = args[0] as string;
      return clave.includes("-femenil");
    });

    return {
      sincronizarCalendarioActual: jest
        .spyOn(service, "sincronizarCalendarioActual")
        .mockImplementation(async (...args: unknown[]) => ({
          partidos: [
            crearPartido("151515", args[0] as "varonil" | "femenil", "Marcador Oficial"),
          ],
        })),
      sincronizarClasificacionActual: jest
        .spyOn(service, "sincronizarClasificacionActual")
        .mockResolvedValue({ posiciones: [] }),
      sincronizarPlantillaActual: jest
        .spyOn(service, "sincronizarPlantillaActual")
        .mockResolvedValue({ jugadores: [], cuerpoTecnico: [] }),
      sincronizarDetallePartido: jest
        .spyOn(service, "sincronizarDetallePartido")
        .mockResolvedValue({}),
    };
  };

  it("no consulta nada por antigüedad si no hay cierre de partido ni ventana de clasificación", async () => {
    // Viernes 21:00 en México.
    jest.spyOn(Date, "now").mockReturnValue(Date.parse("2026-08-22T03:00:00.000Z"));
    const espias = prepararCron([crearPartido("151513", "femenil", "Marcador Oficial")]);

    await ligaMxService.runScheduledSync();

    expect(espias.sincronizarCalendarioActual).not.toHaveBeenCalled();
    expect(espias.sincronizarClasificacionActual).not.toHaveBeenCalled();
    expect(espias.sincronizarPlantillaActual).not.toHaveBeenCalled();
  });

  it("refresca solo la clasificación en la ventana de miércoles por la noche", async () => {
    // Miércoles 23:30 en México.
    jest.spyOn(Date, "now").mockReturnValue(Date.parse("2026-08-27T05:30:00.000Z"));
    const espias = prepararCron([crearPartido("151513", "femenil", "Marcador Oficial")]);

    await ligaMxService.runScheduledSync();

    expect(espias.sincronizarClasificacionActual).toHaveBeenCalledWith(
      "femenil",
      contextoBase,
      true,
    );
    expect(espias.sincronizarCalendarioActual).not.toHaveBeenCalled();
    expect(espias.sincronizarPlantillaActual).not.toHaveBeenCalled();
  });

  it("se salta la división completa mientras el partido está en curso", async () => {
    // Miércoles 23:30 en México (ventana de clasificación abierta) con un
    // partido femenil que arrancó hace 30 min: el silencio manda.
    jest.spyOn(Date, "now").mockReturnValue(Date.parse("2026-08-27T05:30:00.000Z"));
    const espias = prepararCron([
      {
        ...crearPartido("151513", "femenil", "Primer Tiempo"),
        fechaHoraPartido: "2026-08-27T05:00:00.000Z",
      },
    ]);

    await ligaMxService.runScheduledSync();

    expect(espias.sincronizarCalendarioActual).not.toHaveBeenCalledWith(
      "femenil",
      expect.anything(),
      expect.anything(),
    );
    expect(espias.sincronizarClasificacionActual).not.toHaveBeenCalledWith(
      "femenil",
      expect.anything(),
      expect.anything(),
    );
    expect(espias.sincronizarPlantillaActual).not.toHaveBeenCalledWith(
      "femenil",
      expect.anything(),
      expect.anything(),
    );
    expect(espias.sincronizarDetallePartido).not.toHaveBeenCalled();
  });

  it("refreshes the roster when a match is newly finalized", async () => {
    const calendarioAnterior = {
      partidos: [crearPartido("151513", "femenil", "Segundo Tiempo")],
    };
    const calendarioActualizado = {
      partidos: [crearPartido("151513", "femenil", "Marcador Oficial")],
    };

    jest.spyOn(service, "limpiarColeccionesLegado").mockResolvedValue(undefined);
    jest
      .spyOn(service, "sincronizarContextoActual")
      .mockResolvedValue({ contexto: contextoBase, cambioContexto: false });
    jest.spyOn(service, "obtenerCalendarioActual").mockImplementation(async (...args: unknown[]) => {
      const divisionKey = args[0] as "varonil" | "femenil";
      if (divisionKey === "femenil") {
        return calendarioAnterior;
      }

      return { partidos: [crearPartido("200000", "varonil", "Marcador Oficial")] };
    });
    jest.spyOn(service, "obtenerClasificacionActual").mockResolvedValue({ posiciones: [] });
    jest.spyOn(service, "obtenerPlantillaActual").mockResolvedValue({ jugadores: [] });
    jest.spyOn(service, "obtenerPartidoPendienteDeCierre").mockImplementation((...args: unknown[]) => {
      const partidos = args[0] as PartidoLigaMxDoc[];
      return partidos.find((partido) => partido.id === "151513") ?? null;
    });
    jest.spyOn(service, "debeConsultarResultadosDivision").mockImplementation(async (...args: unknown[]) => {
      const divisionKey = args[0] as string;
      return divisionKey === "femenil";
    });
    jest.spyOn(service, "debeSincronizar").mockResolvedValue(false);
    jest
      .spyOn(service, "sincronizarCalendarioActual")
      .mockImplementation(async (...args: unknown[]) => {
        const divisionKey = args[0] as "varonil" | "femenil";
        return divisionKey === "femenil"
          ? calendarioActualizado
          : { partidos: [crearPartido("200000", "varonil", "Marcador Oficial")] };
      });
    const sincronizarClasificacionActual = jest
      .spyOn(service, "sincronizarClasificacionActual")
      .mockResolvedValue({ posiciones: [] });
    const sincronizarPlantillaActual = jest
      .spyOn(service, "sincronizarPlantillaActual")
      .mockResolvedValue({ jugadores: [], cuerpoTecnico: [] });
    const sincronizarDetallePartido = jest
      .spyOn(service, "sincronizarDetallePartido")
      .mockResolvedValue({});

    await ligaMxService.runScheduledSync();

    expect(sincronizarClasificacionActual).toHaveBeenCalledWith("femenil", contextoBase, true);
    expect(sincronizarPlantillaActual).toHaveBeenCalledWith("femenil", contextoBase, true);
    expect(sincronizarDetallePartido).toHaveBeenCalledWith(
      expect.objectContaining({ id: "151513", claveDivision: "femenil" }),
      true,
    );
  });
});