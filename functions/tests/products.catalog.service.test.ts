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
      porcentajeDescuento: 0,
      imagenPrincipal: "https://example.com/jersey.jpg",
      stockTotal: 5,
      disponible: true,
    });
    expect(result.items[0]).not.toHaveProperty("precioCompra");
    expect(result.items[0]).not.toHaveProperty("proveedorId");
    expect(result.items[0]).not.toHaveProperty("inventarioPorTalla");
  });

  it("applies an active offer dynamically over the current price, ignoring a stale frozen snapshot", async () => {
    // Snapshot congelado: el precio de oferta quedó en 300 (cuando el precio era
    // 600). Luego el admin subió el precio a 1200, pero la oferta del 50% sigue
    // activa y debe recalcularse sobre el precio ACTUAL (1200 -> 600).
    dbState.productos.prod_1.precioPublico = 1200;
    dbState.productos.prod_1.tieneOfertaActiva = true;
    dbState.productos.prod_1.precioOferta = 300;
    dbState.productos.prod_1.porcentajeDescuento = 50;
    dbState.productos.prod_1.ofertaAplicadaId = "of_1";
    dbState.productos.prod_1.ofertaTitulo = "Rebaja";

    dbState.ofertas = {
      of_1: {
        titulo: "Rebaja Club León",
        estado: true,
        tipoDescuento: "porcentaje",
        valorDescuento: 50,
        aplicaA: "categorias",
        productoIds: [],
        categoriaIds: ["jerseys"],
        lineaIds: [],
        tallaIds: [],
        fechaInicio: "2020-01-01T00:00:00.000Z",
        fechaFin: "2035-01-01T00:00:00.000Z",
        hastaAgotarExistencias: false,
        stockLimiteOferta: null,
        stockVendidoOferta: 0,
        prioridad: 1,
        combinable: false,
        mostrarBadge: true,
        createdAt: "2026-06-01T00:00:00.000Z",
        updatedAt: "2026-06-01T00:00:00.000Z",
        deletedAt: null,
      },
    };

    const result = await productService.listCatalogProducts({
      limit: 24,
      sort: "recientes",
      onlyOffers: false,
      onlyAvailable: false,
    });

    const card = result.items.find((item) => item.id === "prod_1");

    expect(card).toBeDefined();
    expect(card).toMatchObject({
      precioOriginal: 1200,
      precioFinal: 600,
      tieneOferta: true,
      porcentajeDescuento: 50,
      ofertaAplicadaId: "of_1",
    });
  });

  it("does not apply an inactive/expired offer even if the snapshot says so", async () => {
    dbState.productos.prod_1.precioPublico = 1200;
    dbState.productos.prod_1.tieneOfertaActiva = true;
    dbState.productos.prod_1.precioOferta = 600;
    dbState.productos.prod_1.porcentajeDescuento = 50;

    dbState.ofertas = {
      of_expired: {
        titulo: "Rebaja vencida",
        estado: true,
        tipoDescuento: "porcentaje",
        valorDescuento: 50,
        aplicaA: "categorias",
        productoIds: [],
        categoriaIds: ["jerseys"],
        lineaIds: [],
        tallaIds: [],
        fechaInicio: "2020-01-01T00:00:00.000Z",
        fechaFin: "2020-02-01T00:00:00.000Z",
        hastaAgotarExistencias: false,
        stockLimiteOferta: null,
        stockVendidoOferta: 0,
        prioridad: 1,
        combinable: false,
        mostrarBadge: true,
        createdAt: "2020-01-01T00:00:00.000Z",
        updatedAt: "2020-01-01T00:00:00.000Z",
        deletedAt: null,
      },
    };

    const result = await productService.listCatalogProducts({
      limit: 24,
      sort: "recientes",
      onlyOffers: false,
      onlyAvailable: false,
    });

    const card = result.items.find((item) => item.id === "prod_1");

    expect(card).toBeDefined();
    expect(card).toMatchObject({
      precioOriginal: 1200,
      precioFinal: 1200,
      tieneOferta: false,
      porcentajeDescuento: 0,
    });
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

  it("filters unavailable products from destacados when onlyAvailable is true", async () => {
    const availableOnly = await productService.listCatalogProducts({
      limit: 24,
      sort: "destacados",
      onlyOffers: false,
      onlyAvailable: true,
    });

    const includingUnavailable = await productService.listCatalogProducts({
      limit: 24,
      sort: "destacados",
      onlyOffers: false,
      onlyAvailable: false,
    });

    expect(availableOnly.items.map((item) => item.id)).toEqual(["prod_1"]);
    expect(includingUnavailable.items.map((item) => item.id)).toEqual([
      "prod_1",
      "prod_2",
    ]);
  });

  it("includes products with stock when stored disponible is stale", async () => {
    dbState.productos.prod_4 = {
      clave: "STK-001",
      descripcion: "Producto con stock y disponible desactualizado",
      searchText: "producto stock disponible desactualizado stk-001 jerseys hombre",
      lineaId: "hombre",
      categoriaId: "jerseys",
      precioPublico: 499,
      precioCompra: 200,
      existencias: 10,
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
      createdAt: ts("2026-05-01T00:00:00.000Z"),
      updatedAt: ts("2026-06-04T00:00:00.000Z"),
    };

    const result = await productService.listCatalogProducts({
      limit: 24,
      sort: "recientes",
      onlyOffers: false,
      onlyAvailable: true,
    });

    expect(result.items.map((item) => item.id)).toContain("prod_4");
    expect(
      result.items.find((item) => item.id === "prod_4"),
    ).toMatchObject({
      stockTotal: 10,
      disponible: true,
    });
  });

  it("maps onlyOffers=true to ofertas_populares ranking", async () => {
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

  describe("catalog search", () => {
    beforeEach(() => {
      dbState.categorias = {
        jerseys: { nombre: "Jerseys", activo: true },
        playera: { nombre: "Playera", activo: true },
      };
      dbState.lineas = {
        hombre: { nombre: "Hombre", activo: true },
        caballero: { nombre: "Caballero", activo: true },
      };
      dbState.productos.prod_playera = {
        clave: "APP 6215",
        descripcion: "Playera azul grisáceo",
        lineaId: "caballero",
        categoriaId: "playera",
        precioPublico: 499,
        precioCompra: 200,
        existencias: 2,
        disponible: true,
        proveedorId: "prov_1",
        tallaIds: ["m"],
        inventarioPorTalla: [{ tallaId: "m", cantidad: 2 }],
        stockMinimoGlobal: 5,
        stockMinimoPorTalla: [],
        imagenes: ["https://example.com/playera.jpg"],
        detalleIds: [],
        ratingSummary: { average: 0, count: 0 },
        activo: true,
        createdAt: ts("2026-06-04T00:00:00.000Z"),
        updatedAt: ts("2026-06-04T00:00:00.000Z"),
      };
    });

    it("finds products without searchText by description", async () => {
      const result = await productService.listCatalogProducts({
        limit: 24,
        sort: "recientes",
        q: "playera",
        onlyOffers: false,
        onlyAvailable: true,
      });

      expect(result.items.map((item) => item.id)).toContain("prod_playera");
    });

    it("finds products by partial clave", async () => {
      const result = await productService.listCatalogProducts({
        limit: 24,
        sort: "recientes",
        q: "6215",
        onlyOffers: false,
        onlyAvailable: true,
      });

      expect(result.items.map((item) => item.id)).toContain("prod_playera");
    });

    it("finds products by middle word in description", async () => {
      const result = await productService.listCatalogProducts({
        limit: 24,
        sort: "recientes",
        q: "grisaceo",
        onlyOffers: false,
        onlyAvailable: true,
      });

      expect(result.items.map((item) => item.id)).toContain("prod_playera");
    });

    it("finds products by category label", async () => {
      const result = await productService.listCatalogProducts({
        limit: 24,
        sort: "recientes",
        q: "playera",
        onlyOffers: false,
        onlyAvailable: true,
      });

      expect(result.items.map((item) => item.id)).toContain("prod_playera");
    });

    it("excludes inactive products from search", async () => {
      dbState.productos.prod_playera.activo = false;

      const result = await productService.listCatalogProducts({
        limit: 24,
        sort: "recientes",
        q: "playera azul grisaceo",
        onlyOffers: false,
        onlyAvailable: true,
      });

      expect(result.items.map((item) => item.id)).not.toContain("prod_playera");
    });

    it("excludes unavailable products when onlyAvailable is true", async () => {
      dbState.productos.prod_playera.existencias = 0;
      dbState.productos.prod_playera.inventarioPorTalla = [
        { tallaId: "m", cantidad: 0 },
      ];
      dbState.productos.prod_playera.disponible = false;

      const result = await productService.listCatalogProducts({
        limit: 24,
        sort: "recientes",
        q: "playera",
        onlyOffers: false,
        onlyAvailable: true,
      });

      expect(result.items.map((item) => item.id)).not.toContain("prod_playera");
    });

    it("uses prefix search when searchText matches at start", async () => {
      dbState.productos.prod_playera.searchText =
        "playera azul grisaceo app 6215 playera caballero";

      const result = await productService.listCatalogProducts({
        limit: 24,
        sort: "recientes",
        q: "playera azul",
        onlyOffers: false,
        onlyAvailable: true,
      });

      expect(result.items.map((item) => item.id)).toContain("prod_playera");
    });
  });
});
