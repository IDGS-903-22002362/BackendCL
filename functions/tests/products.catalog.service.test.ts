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

const compareValue = (value: unknown): string | number | boolean | null => {
  if (value instanceof FakeTimestamp) {
    return value.toMillis();
  }
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  return null;
};

const createSnapshotDoc = (id: string, data: DocData) => ({
  id,
  data: () => clone(data),
});

const createQuery = (
  collectionName: string,
  filters: Filter[] = [],
  orders: Order[] = [],
  limitCount?: number,
  startAfterValues?: unknown[],
) => ({
  where(field: string, op: string, value: unknown) {
    return createQuery(collectionName, [...filters, { field, op, value }], orders, limitCount, startAfterValues);
  },
  orderBy(field: string, direction: "asc" | "desc" = "asc") {
    return createQuery(collectionName, filters, [...orders, { field, direction }], limitCount, startAfterValues);
  },
  limit(count: number) {
    return createQuery(collectionName, filters, orders, count, startAfterValues);
  },
  startAfter(...values: unknown[]) {
    return createQuery(collectionName, filters, orders, limitCount, values);
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
        if (filter.op === ">=") {
          return String(value) >= String(filter.value);
        }
        if (filter.op === "<=") {
          return String(value) <= String(filter.value);
        }
        if (filter.op === "array-contains") {
          return Array.isArray(value) && value.includes(filter.value);
        }
        return false;
      }),
    );

    docs.sort((a, b) => {
      for (const order of orders) {
        const aRaw = order.field === "__name__" ? a.id : a.data[order.field];
        const bRaw = order.field === "__name__" ? b.id : b.data[order.field];
        const aValue = compareValue(aRaw);
        const bValue = compareValue(bRaw);
        if (aValue === bValue) {
          continue;
        }
        if (aValue === null) {
          return 1;
        }
        if (bValue === null) {
          return -1;
        }
        const result = aValue < bValue ? -1 : 1;
        return order.direction === "asc" ? result : -result;
      }
      return 0;
    });

    if (startAfterValues && orders.length > 0) {
      const cursorIndex = docs.findIndex((doc) =>
        orders.every((order, index) => {
          const raw = order.field === "__name__" ? doc.id : doc.data[order.field];
          return compareValue(raw) === compareValue(startAfterValues[index]);
        }),
      );
      if (cursorIndex >= 0) {
        docs = docs.slice(cursorIndex + 1);
      }
    }

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
        get: async () => ({
          exists: Boolean(dbState[name]?.[id]),
          id,
          data: () => (dbState[name]?.[id] ? clone(dbState[name][id]) : undefined),
        }),
      }),
    }),
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

import productService, { CatalogQueryError } from "../src/services/product.service";

const ts = (iso: string) => new FakeTimestamp(Date.parse(iso));

describe("ProductService.listCatalogProducts", () => {
  beforeEach(() => {
    dbState = {
      categorias: {
        jerseys: { nombre: "Jerseys", activo: true },
      },
      lineas: {
        hombre: { nombre: "Hombre", activo: true },
      },
      productos: {
        prod_1: {
          clave: "JER-001",
          descripcion: "Jersey Local",
          slug: "jersey-local",
          searchText: "jersey local jer-001 jerseys hombre",
          lineaId: "hombre",
          categoriaId: "jerseys",
          precioPublico: 1200,
          precioCompra: 600,
          existencias: 5,
          disponible: true,
          destacado: true,
          proveedorId: "prov_1",
          tallaIds: ["m"],
          inventarioPorTalla: [{ tallaId: "m", cantidad: 5 }],
          stockMinimoGlobal: 5,
          stockMinimoPorTalla: [],
          imagenes: ["https://example.com/jersey.jpg"],
          detalleIds: [],
          ratingSummary: { average: 0, count: 0 },
          activo: true,
          createdAt: ts("2026-06-02T00:00:00.000Z"),
          updatedAt: ts("2026-06-02T00:00:00.000Z"),
        },
        prod_2: {
          clave: "GOR-001",
          descripcion: "Gorra",
          searchText: "gorra gor-001 jerseys hombre",
          lineaId: "hombre",
          categoriaId: "jerseys",
          precioPublico: 350,
          precioCompra: 100,
          existencias: 0,
          disponible: false,
          proveedorId: "prov_1",
          tallaIds: [],
          inventarioPorTalla: [],
          stockMinimoGlobal: 5,
          stockMinimoPorTalla: [],
          imagenes: [],
          detalleIds: [],
          ratingSummary: { average: 0, count: 0 },
          activo: true,
          createdAt: ts("2026-06-01T00:00:00.000Z"),
          updatedAt: ts("2026-06-01T00:00:00.000Z"),
        },
        prod_3: {
          clave: "LIC-001",
          descripcion: "Producto Licencia Pendiente",
          searchText: "producto licencia pendiente lic-001 jerseys hombre",
          lineaId: "hombre",
          categoriaId: "jerseys",
          precioPublico: 999,
          precioCompra: 500,
          existencias: 8,
          disponible: true,
          proveedorId: "prov_1",
          tallaIds: [],
          inventarioPorTalla: [],
          stockMinimoGlobal: 5,
          stockMinimoPorTalla: [],
          imagenes: [],
          detalleIds: [],
          ratingSummary: { average: 0, count: 0 },
          activo: false,
          createdAt: ts("2026-06-03T00:00:00.000Z"),
          updatedAt: ts("2026-06-03T00:00:00.000Z"),
        },
      },
    };
  });

  it("returns a lightweight catalog page and hides sensitive fields", async () => {
    const result = await productService.listCatalogProducts({
      limit: 24,
      sort: "destacados",
      onlyOffers: false,
      onlyAvailable: false,
    });

    expect(result.items).toHaveLength(2);
    expect(result.items.map((item) => item.id)).not.toContain("prod_3");
    expect(result.items[0]).toMatchObject({
      id: "prod_1",
      slug: "jersey-local",
      nombre: "Jersey Local",
      categoriaLabel: "Jerseys",
      lineaLabel: "Hombre",
      precioOriginal: 1200,
      precioFinal: 1200,
      tieneOferta: false,
      imagenPrincipal: "https://example.com/jersey.jpg",
      stockTotal: 5,
      disponible: true,
    });
    expect(result.items[0]).not.toHaveProperty("precioCompra");
    expect(result.items[0]).not.toHaveProperty("proveedorId");
    expect(result.items[0]).not.toHaveProperty("inventarioPorTalla");
  });

  it("uses cursor pagination", async () => {
    const first = await productService.listCatalogProducts({
      limit: 1,
      sort: "destacados",
      onlyOffers: false,
      onlyAvailable: false,
    });

    expect(first.hasMore).toBe(true);
    expect(first.nextCursor).toEqual(expect.any(String));

    const second = await productService.listCatalogProducts({
      limit: 1,
      cursor: first.nextCursor || undefined,
      sort: "destacados",
      onlyOffers: false,
      onlyAvailable: false,
    });

    expect(second.items).toHaveLength(1);
    expect(second.items[0].id).toBe("prod_2");
    expect(second.hasMore).toBe(false);
  });

  it("filters by category, price and availability", async () => {
    const result = await productService.listCatalogProducts({
      limit: 24,
      category: "jerseys",
      minPrice: 1000,
      maxPrice: 1300,
      sort: "precio_asc",
      onlyOffers: false,
      onlyAvailable: true,
    });

    expect(result.items.map((item) => item.id)).toEqual(["prod_1"]);
  });

  it("returns an empty page for onlyOffers without applying side effects", async () => {
    const result = await productService.listCatalogProducts({
      limit: 24,
      sort: "precio_asc",
      onlyOffers: true,
      onlyAvailable: false,
    });

    expect(result).toEqual({ items: [], nextCursor: null, hasMore: false });
  });

  it("rejects cursor reuse with different filters", async () => {
    const first = await productService.listCatalogProducts({
      limit: 1,
      sort: "destacados",
      onlyOffers: false,
      onlyAvailable: false,
    });

    await expect(
      productService.listCatalogProducts({
        limit: 1,
        cursor: first.nextCursor || undefined,
        category: "otra",
        sort: "destacados",
        onlyOffers: false,
        onlyAvailable: false,
      }),
    ).rejects.toBeInstanceOf(CatalogQueryError);
  });

  it("returns active and inactive products for admin listings", async () => {
    const result = await productService.getAdminProducts({ estado: "todos" });

    expect(result.map((item) => item.id)).toEqual(["prod_3", "prod_1", "prod_2"]);
    expect(result[0]).toMatchObject({
      id: "prod_3",
      activo: false,
      imagenPrincipal: null,
    });
  });

  it("filters inactive products for admin listings", async () => {
    const result = await productService.getAdminProducts({ estado: "inactivo" });

    expect(result.map((item) => item.id)).toEqual(["prod_3"]);
    expect(result[0].activo).toBe(false);
  });
});
