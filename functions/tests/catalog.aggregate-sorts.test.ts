/**
 * Home rails and /products aggregate sorts share backend ranking
 * (popularidad, mas_vendidos + listCatalogProductsByAggregateRanking).
 */

jest.mock("../src/services/recomendaciones/aggregates.service", () => ({
  __esModule: true,
  default: {
    getDestacadosRankedProductIds: jest.fn(async () => ["prod_2", "prod_1"]),
    getPopularesRankedProductIds: jest.fn(async () => ["prod_1", "prod_2"]),
    getMasCompradosRankedProductIds: jest.fn(async () => ["prod_2", "prod_1"]),
    getOfertasPopularesRankedProductIds: jest.fn(async () => ["prod_1"]),
    getOfertasMasCompradasRankedProductIds: jest.fn(async () => ["prod_2"]),
    getOfertasRecientesRankedProductIds: jest.fn(async () => ["prod_1", "prod_2"]),
  },
}));

type DocData = Record<string, unknown>;
type Filter = { field: string; op: string; value: unknown };
type Order = { field: string; direction: "asc" | "desc" };

class FakeTimestamp {
  constructor(private readonly millis: number) {}

  static now() {
    return new FakeTimestamp(Date.parse("2026-06-05T00:00:00.000Z"));
  }

  static fromMillis(millis: number) {
    return new FakeTimestamp(millis);
  }

  toMillis() {
    return this.millis;
  }
}

let dbState: Record<string, Record<string, DocData>>;

const clone = (value: DocData): DocData => ({ ...value });

const createSnapshotDoc = (id: string, data: DocData) => ({
  id,
  data: () => clone(data),
});

const createQuery = (
  collectionName: string,
  filters: Filter[] = [],
  orders: Order[] = [],
  limitCount?: number,
) => ({
  where(field: string, op: string, value: unknown) {
    return createQuery(collectionName, [...filters, { field, op, value }], orders, limitCount);
  },
  orderBy(field: string, direction: "asc" | "desc" = "asc") {
    return createQuery(collectionName, filters, [...orders, { field, direction }], limitCount);
  },
  limit(count: number) {
    return createQuery(collectionName, filters, orders, count);
  },
  async get() {
    let docs = Object.entries(dbState[collectionName] || {}).map(([id, data]) => ({
      id,
      data,
    }));

    docs = docs.filter((doc) =>
      filters.every((filter) => {
        const value = filter.field === "__name__" ? doc.id : doc.data[filter.field];
        if (filter.op === "==") {
          return value === filter.value;
        }
        return false;
      }),
    );

    if (limitCount !== undefined) {
      docs = docs.slice(0, limitCount);
    }

    return {
      empty: docs.length === 0,
      docs: docs.map((doc) => createSnapshotDoc(doc.id, doc.data)),
    };
  },
});

jest.mock("../src/config/firebase", () => ({
  firestoreTienda: {
    collection: (name: string) => ({
      ...createQuery(name),
      doc: (id: string) => ({
        id,
        get: async () => ({
          exists: Boolean(dbState[name]?.[id]),
          id,
          data: () => (dbState[name]?.[id] ? clone(dbState[name][id]) : undefined),
        }),
      }),
    }),
    getAll: async (...refs: Array<{ id: string }>) =>
      refs.map((ref) => ({
        exists: Boolean(dbState.productos?.[ref.id]),
        id: ref.id,
        data: () =>
          dbState.productos?.[ref.id] ? clone(dbState.productos[ref.id]) : undefined,
      })),
  },
}));

jest.mock("../src/config/firebase.admin", () => ({
  admin: {
    firestore: {
      FieldPath: {
        documentId: () => "__name__",
      },
      Timestamp: FakeTimestamp,
    },
  },
}));

jest.mock("../src/services/stock-alert.service", () => ({
  __esModule: true,
  default: {
    notifyRealtime: jest.fn(),
  },
}));

import productService from "../src/services/product.service";

const ts = (iso: string) => new FakeTimestamp(Date.parse(iso));

const baseProducts = {
  prod_1: {
    clave: "JER-001",
    descripcion: "Jersey Local",
    slug: "jersey-local",
    lineaId: "hombre",
    categoriaId: "jerseys",
    precioPublico: 1200,
    existencias: 5,
    disponible: true,
    activo: true,
    imagenes: ["https://example.com/jersey.jpg"],
    tallaIds: [],
    inventarioPorTalla: [],
    createdAt: ts("2026-06-02T00:00:00.000Z"),
    updatedAt: ts("2026-06-02T00:00:00.000Z"),
  },
  prod_2: {
    clave: "GOR-001",
    descripcion: "Gorra",
    slug: "gorra",
    lineaId: "hombre",
    categoriaId: "jerseys",
    precioPublico: 350,
    existencias: 3,
    disponible: true,
    activo: true,
    imagenes: [],
    tallaIds: [],
    inventarioPorTalla: [],
    createdAt: ts("2026-06-01T00:00:00.000Z"),
    updatedAt: ts("2026-06-01T00:00:00.000Z"),
  },
};

describe("Aggregate catalog sorts (populares + mas_comprados)", () => {
  beforeEach(() => {
    dbState = {
      categorias: {
        jerseys: { nombre: "Jerseys", activo: true },
      },
      lineas: {
        hombre: { nombre: "Hombre", activo: true },
      },
      productos: { ...baseProducts },
    };
  });

  it("returns popularity-ranked IDs for sort=populares", async () => {
    const result = await productService.listCatalogProducts({
      sort: "populares",
      limit: 24,
      onlyAvailable: true,
      onlyOffers: false,
    });

    expect(result.items.map((item) => item.id)).toEqual(["prod_1", "prod_2"]);
  });

  it("returns best-seller-ranked IDs for sort=mas_comprados", async () => {
    const result = await productService.listCatalogProducts({
      sort: "mas_comprados",
      limit: 24,
      onlyAvailable: true,
      onlyOffers: false,
    });

    expect(result.items.map((item) => item.id)).toEqual(["prod_2", "prod_1"]);
  });

  it("paginates mas_comprados without reordering", async () => {
    const firstPage = await productService.listCatalogProducts({
      sort: "mas_comprados",
      limit: 1,
      onlyAvailable: true,
      onlyOffers: false,
    });

    const secondPage = await productService.listCatalogProducts({
      sort: "mas_comprados",
      limit: 1,
      cursor: firstPage.nextCursor || undefined,
      onlyAvailable: true,
      onlyOffers: false,
    });

    expect(firstPage.items[0]?.id).toBe("prod_2");
    expect(secondPage.items[0]?.id).toBe("prod_1");
  });

  it("returns offer-ranked IDs for sort=ofertas_populares", async () => {
    const result = await productService.listCatalogProducts({
      sort: "ofertas_populares",
      limit: 24,
      onlyAvailable: true,
      onlyOffers: false,
    });

    expect(result.items.map((item) => item.id)).toEqual(["prod_1"]);
  });

  it("returns offer best-seller IDs for sort=ofertas_mas_compradas", async () => {
    const result = await productService.listCatalogProducts({
      sort: "ofertas_mas_compradas",
      limit: 24,
      onlyAvailable: true,
      onlyOffers: false,
    });

    expect(result.items.map((item) => item.id)).toEqual(["prod_2"]);
  });

  it("returns recent offer IDs for sort=ofertas_recientes", async () => {
    const result = await productService.listCatalogProducts({
      sort: "ofertas_recientes",
      limit: 24,
      onlyAvailable: true,
      onlyOffers: false,
    });

    expect(result.items.map((item) => item.id)).toEqual(["prod_1", "prod_2"]);
  });

  it("maps onlyOffers=true to ofertas_populares ranking", async () => {
    const result = await productService.listCatalogProducts({
      sort: "destacados",
      limit: 24,
      onlyAvailable: true,
      onlyOffers: true,
    });

    expect(result.items.map((item) => item.id)).toEqual(["prod_1"]);
  });
});
