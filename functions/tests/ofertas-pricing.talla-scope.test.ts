import {
  ProductoOfertaBase,
  seleccionarMejorOferta,
  esOfertaAplicableATallaProducto,
} from "../src/utils/ofertas-pricing.util";
import { Oferta } from "../src/models/ofertas.model";

function buildOferta(overrides: Partial<Oferta> = {}): Oferta {
  return {
    id: "of-1",
    titulo: "OFERTYAS VERANO",
    estado: true,
    tipoDescuento: "porcentaje",
    valorDescuento: 50,
    aplicaA: "productos",
    productoIds: ["prod-1"],
    categoriaIds: [],
    lineaIds: [],
    tallaIds: ["adjustable", "xxs"],
    fechaInicio: new Date(Date.now() - 24 * 60 * 60 * 1000),
    fechaFin: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    hastaAgotarExistencias: true,
    stockLimiteOferta: null,
    stockVendidoOferta: 0,
    prioridad: 1,
    combinable: false,
    mostrarBadge: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function buildProducto(
  overrides: Partial<ProductoOfertaBase> = {},
): ProductoOfertaBase {
  return {
    id: "prod-1",
    precioPublico: 20,
    categoriaId: "accesorios",
    lineaId: "accesorios",
    tallaIds: ["adjustable"],
    ...overrides,
  };
}

describe("ofertas talla-scope (catalogo/ficha sin talla especifica)", () => {
  it("aplica oferta por talla cuando alguna talla del producto califica, sin pasar tallaId", () => {
    const mejor = seleccionarMejorOferta([buildOferta()], buildProducto());
    expect(mejor).not.toBeNull();
    expect(mejor?.precioFinal).toBe(10);
    expect(mejor?.oferta.id).toBe("of-1");
  });

  it("calcula la oferta sobre el precio ACTUAL del producto", () => {
    const mejor = seleccionarMejorOferta(
      [buildOferta()],
      buildProducto({ precioPublico: 20 }),
    );
    expect(mejor?.precioFinal).toBe(10);
  });

  it("es estricto por talla cuando se pasa una talla concreta (carrito/checkout)", () => {
    const producto = buildProducto({ tallaIds: ["adjustable"] });
    expect(
      seleccionarMejorOferta([buildOferta({ tallaIds: ["xxs"] })], producto, "adjustable"),
    ).toBeNull();
    expect(
      seleccionarMejorOferta(
        [buildOferta({ tallaIds: ["adjustable"] })],
        producto,
        "adjustable",
      )?.precioFinal,
    ).toBe(10);
  });

  it("no aplica oferta por talla a producto sin tallas cuando no hay talla en contexto", () => {
    const oferta = buildOferta({ tallaIds: ["adjustable"] });
    expect(seleccionarMejorOferta([oferta], buildProducto({ tallaIds: [] }))).toBeNull();
  });

  it("una oferta sin restriccion de talla aplica siempre", () => {
    const oferta = buildOferta({ tallaIds: [] });
    expect(
      seleccionarMejorOferta([oferta], buildProducto({ tallaIds: [] }))?.precioFinal,
    ).toBe(10);
  });

  describe("esOfertaAplicableATallaProducto", () => {
    it("intersecta tallas de producto cuando no hay tallaId", () => {
      const oferta = buildOferta({ tallaIds: ["adjustable", "xxs"] });
      expect(
        esOfertaAplicableATallaProducto(oferta, buildProducto({ tallaIds: ["adjustable"] })),
      ).toBe(true);
      expect(
        esOfertaAplicableATallaProducto(oferta, buildProducto({ tallaIds: ["xl"] })),
      ).toBe(false);
    });

    it("es estricto cuando se pasa tallaId", () => {
      const oferta = buildOferta({ tallaIds: ["adjustable"] });
      const producto = buildProducto({ tallaIds: ["adjustable", "xl"] });
      expect(esOfertaAplicableATallaProducto(oferta, producto, "adjustable")).toBe(true);
      expect(esOfertaAplicableATallaProducto(oferta, producto, "xl")).toBe(false);
    });
  });
});
