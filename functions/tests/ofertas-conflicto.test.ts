import { encontrarOfertaActivaEnConflicto } from "../src/utils/ofertas-pricing.util";
import type { Oferta } from "../src/models/ofertas.model";

function buildOferta(overrides: Partial<Oferta> = {}): Oferta {
  const ahora = Date.now();

  return {
    id: "of-1",
    titulo: "Oferta de prueba",
    estado: true,
    tallaIds: [],
    tipoDescuento: "porcentaje",
    valorDescuento: 10,
    aplicaA: "productos",
    productoIds: ["prod-1"],
    categoriaIds: [],
    lineaIds: [],
    fechaInicio: new Date(ahora - 24 * 60 * 60 * 1000),
    fechaFin: new Date(ahora + 7 * 24 * 60 * 60 * 1000),
    hastaAgotarExistencias: true,
    stockLimiteOferta: null,
    stockVendidoOferta: 0,
    prioridad: 1,
    combinable: false,
    mostrarBadge: true,
    createdAt: new Date(ahora),
    updatedAt: new Date(ahora),
    deletedAt: null,
    ...overrides,
  };
}

describe("encontrarOfertaActivaEnConflicto", () => {
  it("detecta un conflicto cuando el producto ya tiene una oferta activa vigente", () => {
    const existente = buildOferta({ id: "of-existente", productoIds: ["prod-1"] });

    const conflicto = encontrarOfertaActivaEnConflicto("prod-1", [existente]);

    expect(conflicto?.id).toBe("of-existente");
  });

  it("no marca conflicto contra la propia oferta al editar", () => {
    const propia = buildOferta({ id: "of-propia", productoIds: ["prod-1"] });

    const conflicto = encontrarOfertaActivaEnConflicto("prod-1", [propia], {
      ofertaIdActual: "of-propia",
    });

    expect(conflicto).toBeNull();
  });

  it("ignora ofertas inactivas (estado=false)", () => {
    const inactiva = buildOferta({
      id: "of-inactiva",
      estado: false,
      productoIds: ["prod-1"],
    });

    const conflicto = encontrarOfertaActivaEnConflicto("prod-1", [inactiva]);

    expect(conflicto).toBeNull();
  });

  it("ignora ofertas vencidas (fuera de vigencia)", () => {
    const vencida = buildOferta({
      id: "of-vencida",
      productoIds: ["prod-1"],
      fechaInicio: new Date("2020-01-01T00:00:00Z"),
      fechaFin: new Date("2020-02-01T00:00:00Z"),
    });

    const conflicto = encontrarOfertaActivaEnConflicto("prod-1", [vencida]);

    expect(conflicto).toBeNull();
  });

  it("ignora ofertas eliminadas (soft-delete)", () => {
    const eliminada = buildOferta({
      id: "of-eliminada",
      productoIds: ["prod-1"],
      deletedAt: new Date(),
    });

    const conflicto = encontrarOfertaActivaEnConflicto("prod-1", [eliminada]);

    expect(conflicto).toBeNull();
  });

  it("ignora ofertas de otro alcance (categorias/lineas/todo)", () => {
    const porCategoria = buildOferta({
      id: "of-categoria",
      aplicaA: "categorias",
      productoIds: [],
      categoriaIds: ["cat-1"],
    });

    const conflicto = encontrarOfertaActivaEnConflicto("prod-1", [porCategoria]);

    expect(conflicto).toBeNull();
  });

  it("no marca conflicto cuando la oferta no incluye al producto", () => {
    const otra = buildOferta({ id: "of-otra", productoIds: ["prod-2"] });

    const conflicto = encontrarOfertaActivaEnConflicto("prod-1", [otra]);

    expect(conflicto).toBeNull();
  });
});
