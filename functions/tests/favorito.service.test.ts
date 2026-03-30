type DocData = Record<string, unknown>;
type QueryFilter = { field: string; value: unknown };

let dbState: Record<string, Record<string, DocData>>;

const createDocSnapshot = (collectionName: string, id: string, data?: DocData) => ({
  exists: !!data,
  id,
  data: () => (data ? { ...data } : undefined),
  ref: {
    delete: async () => {
      const collection = dbState[collectionName] ?? {};
      const nextCollection = { ...collection };
      delete nextCollection[id];
      dbState[collectionName] = nextCollection;
    },
  },
});

const buildQuery = (
  collectionName: string,
  filters: QueryFilter[] = [],
  limitValue?: number,
  offsetValue = 0,
) => ({
  where(field: string, _op: string, value: unknown) {
    return buildQuery(collectionName, [...filters, { field, value }], limitValue, offsetValue);
  },
  orderBy() {
    return buildQuery(collectionName, filters, limitValue, offsetValue);
  },
  limit(nextLimit: number) {
    return buildQuery(collectionName, filters, nextLimit, offsetValue);
  },
  offset(nextOffset: number) {
    return buildQuery(collectionName, filters, limitValue, nextOffset);
  },
  async get() {
    const collection = dbState[collectionName] ?? {};
    let docs = Object.entries(collection)
      .filter(([, data]) =>
        filters.every((filter) => data[filter.field] === filter.value),
      )
      .map(([id, data]) => createDocSnapshot(collectionName, id, data));

    if (offsetValue > 0) {
      docs = docs.slice(offsetValue);
    }
    if (typeof limitValue === "number") {
      docs = docs.slice(0, limitValue);
    }

    return {
      empty: docs.length === 0,
      docs,
    };
  },
});

jest.mock("../src/config/firebase", () => ({
  firestoreTienda: {
    collection: (name: string) => ({
      doc: (id?: string) => {
        const resolvedId = id ?? `auto_${Date.now()}`;
        return {
          id: resolvedId,
          async get() {
            const collection = dbState[name] ?? {};
            return createDocSnapshot(name, resolvedId, collection[resolvedId]);
          },
          async set(data: DocData) {
            dbState[name] = {
              ...(dbState[name] ?? {}),
              [resolvedId]: { ...data },
            };
          },
          async delete() {
            const collection = dbState[name] ?? {};
            const nextCollection = { ...collection };
            delete nextCollection[resolvedId];
            dbState[name] = nextCollection;
          },
        };
      },
      where: (field: string, _op: string, value: unknown) =>
        buildQuery(name, [{ field, value }]),
      orderBy: () => buildQuery(name),
    }),
    runTransaction: async (
      callback: (transaction: {
        get: (ref: { get: () => Promise<unknown> }) => Promise<unknown>;
        set: (ref: { set: (data: DocData) => Promise<void> }, data: DocData) => Promise<void>;
      }) => Promise<unknown>,
    ) =>
      callback({
        get: async (ref) => ref.get(),
        set: async (ref, data) => ref.set(data),
      }),
  },
}));

jest.mock("../src/config/firebase.admin", () => ({
  admin: {
    firestore: {
      Timestamp: {
        now: () => "ts-now",
      },
    },
  },
}));

jest.mock("../src/services/product.service", () => ({
  __esModule: true,
  default: {
    getProductById: jest.fn(),
  },
}));

import favoritoService from "../src/services/favorito.service";
import productService from "../src/services/product.service";

const mockedProductService = productService as jest.Mocked<typeof productService>;

describe("favorito.service", () => {
  beforeEach(() => {
    dbState = {
      favoritos: {},
    };
    jest.clearAllMocks();
  });

  it("crea un favorito nuevo con id deterministico", async () => {
    mockedProductService.getProductById.mockResolvedValue({
      id: "prod_1",
      activo: true,
      clave: "JER-1",
      descripcion: "Jersey",
      precioPublico: 1000,
      imagenes: ["img-1"],
    } as never);

    const result = await favoritoService.createFavorito("uid_1", "prod_1");

    expect(result.created).toBe(true);
    expect(result.favorito).toEqual({
      id: "uid_1__prod_1",
      usuarioId: "uid_1",
      productoId: "prod_1",
      createdAt: "ts-now",
    });
  });

  it("reutiliza el favorito existente si ya existe", async () => {
    dbState.favoritos = {
      uid_1__prod_1: {
        usuarioId: "uid_1",
        productoId: "prod_1",
        createdAt: "older-ts",
      },
    };
    mockedProductService.getProductById.mockResolvedValue({
      id: "prod_1",
      activo: true,
      clave: "JER-1",
      descripcion: "Jersey",
      precioPublico: 1000,
      imagenes: ["img-1"],
    } as never);

    const result = await favoritoService.createFavorito("uid_1", "prod_1");

    expect(result.created).toBe(false);
    expect(Object.keys(dbState.favoritos)).toHaveLength(1);
    expect(result.favorito.createdAt).toBe("older-ts");
  });

  it("rechaza producto inexistente", async () => {
    mockedProductService.getProductById.mockResolvedValue(null as never);

    await expect(favoritoService.createFavorito("uid_1", "missing")).rejects.toEqual(
      expect.objectContaining({
        code: "NOT_FOUND",
      }),
    );
  });

  it("rechaza producto inactivo", async () => {
    mockedProductService.getProductById.mockResolvedValue({
      id: "prod_2",
      activo: false,
    } as never);

    await expect(favoritoService.createFavorito("uid_1", "prod_2")).rejects.toEqual(
      expect.objectContaining({
        code: "CONFLICT",
      }),
    );
  });

  it("omite productos invalidos al listar favoritos", async () => {
    dbState.favoritos = {
      uid_1__prod_1: {
        usuarioId: "uid_1",
        productoId: "prod_1",
        createdAt: "ts-1",
      },
      uid_1__prod_2: {
        usuarioId: "uid_1",
        productoId: "prod_2",
        createdAt: "ts-2",
      },
    };

    mockedProductService.getProductById.mockImplementation(async (productoId) => {
      if (productoId === "prod_1") {
        return {
          id: "prod_1",
          activo: true,
          clave: "JER-1",
          descripcion: "Jersey",
          precioPublico: 1000,
          imagenes: ["img-1", "img-2"],
        } as never;
      }

      return null as never;
    });

    const result = await favoritoService.getFavoritos("uid_1", 20, 0);

    expect(result).toEqual([
      {
        id: "uid_1__prod_1",
        usuarioId: "uid_1",
        createdAt: "ts-1",
        producto: {
          id: "prod_1",
          clave: "JER-1",
          descripcion: "Jersey",
          precioPublico: 1000,
          imagenes: ["img-1"],
        },
      },
    ]);
  });

  it("falla al eliminar un favorito inexistente", async () => {
    await expect(favoritoService.deleteFavorito("uid_1", "prod_9")).rejects.toEqual(
      expect.objectContaining({
        code: "NOT_FOUND",
      }),
    );
  });
});
