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

  it("refreshes stale division snapshots even without a pending match close", async () => {
    const calendarioFemenil = {
      partidos: [crearPartido("151513", "femenil", "Marcador Oficial")],
    };

    jest.spyOn(service, "limpiarColeccionesLegado").mockResolvedValue(undefined);
    jest
      .spyOn(service, "sincronizarContextoActual")
      .mockResolvedValue({ contexto: contextoBase, cambioContexto: false });
    jest.spyOn(service, "obtenerCalendarioActual").mockImplementation(async (...args: unknown[]) => {
      const divisionKey = args[0] as "varonil" | "femenil";
      if (divisionKey === "femenil") {
        return calendarioFemenil;
      }

      return { partidos: [crearPartido("200000", "varonil", "Marcador Oficial")] };
    });
    jest.spyOn(service, "obtenerClasificacionActual").mockResolvedValue({ posiciones: [] });
    jest.spyOn(service, "obtenerPlantillaActual").mockResolvedValue({ jugadores: [] });
    jest.spyOn(service, "obtenerPartidoPendienteDeCierre").mockReturnValue(null);
    jest.spyOn(service, "debeConsultarResultadosDivision").mockResolvedValue(false);
    jest.spyOn(service, "debeSincronizar").mockImplementation(async (...args: unknown[]) => {
      const clave = args[0] as string;
      return clave.includes("-femenil");
    });
    const sincronizarCalendarioActual = jest
      .spyOn(service, "sincronizarCalendarioActual")
      .mockImplementation(async (...args: unknown[]) => {
        const divisionKey = args[0] as "varonil" | "femenil";
        return {
          partidos: [
            crearPartido(
              divisionKey === "femenil" ? "151515" : "200001",
              divisionKey,
              "Marcador Oficial",
            ),
          ],
        };
      });
    const sincronizarClasificacionActual = jest
      .spyOn(service, "sincronizarClasificacionActual")
      .mockResolvedValue({ posiciones: [] });
    const sincronizarPlantillaActual = jest
      .spyOn(service, "sincronizarPlantillaActual")
      .mockResolvedValue({ jugadores: [], cuerpoTecnico: [] });
    jest.spyOn(service, "sincronizarDetallePartido").mockResolvedValue({});

    await ligaMxService.runScheduledSync();

    expect(sincronizarCalendarioActual).toHaveBeenCalledWith("femenil", contextoBase, true);
    expect(sincronizarClasificacionActual).toHaveBeenCalledWith("femenil", contextoBase, true);
    expect(sincronizarPlantillaActual).toHaveBeenCalledWith("femenil", contextoBase, true);
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