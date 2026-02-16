type DocData = Record<string, any>;

type QueryFilter = { field: string; op: string; value: unknown };

let fakeFirestore: ReturnType<typeof createFakeFirestore>;

jest.mock("../src/config/firebase", () => ({
  firestoreTienda: {
    collection: (name: string) => fakeFirestore.collection(name),
    runTransaction: (cb: any) => fakeFirestore.runTransaction(cb),
  },
}));

jest.mock("../src/config/firebase.admin", () => ({
  admin: {
    firestore: {
      Timestamp: {
        now: () => new Date("2026-02-16T00:00:00.000Z"),
      },
    },
  },
}));

import productService from "../src/services/product.service";

function createFakeFirestore(initial: Record<string, Record<string, DocData>>) {
  const collections = new Map<string, Map<string, DocData>>();
  Object.entries(initial).forEach(([name, docs]) => {
    collections.set(
      name,
      new Map(Object.entries(docs).map(([id, data]) => [id, { ...data }])),
    );
  });

  let idCounter = 0;

  const getCollection = (name: string): Map<string, DocData> => {
    if (!collections.has(name)) {
      collections.set(name, new Map());
    }
    return collections.get(name)!;
  };

  const docRefFactory = (collectionName: string, id: string) => ({
    id,
    async get() {
      const col = getCollection(collectionName);
      const data = col.get(id);
      return {
        exists: !!data,
        id,
        data: () => (data ? { ...data } : undefined),
        ref: docRefFactory(collectionName, id),
      };
    },
    update(patch: DocData) {
      const col = getCollection(collectionName);
      const existing = col.get(id);
      if (!existing) {
        throw new Error(`Doc ${collectionName}/${id} not found`);
      }
      col.set(id, { ...existing, ...patch });
    },
    set(data: DocData) {
      const col = getCollection(collectionName);
      col.set(id, { ...data });
    },
  });

  const queryFactory = (collectionName: string, filters: QueryFilter[]) => ({
    where(field: string, op: string, value: unknown) {
      return queryFactory(collectionName, [...filters, { field, op, value }]);
    },
    async get() {
      const col = getCollection(collectionName);
      const docs = Array.from(col.entries())
        .filter(([, data]) =>
          filters.every((f) => {
            if (f.op !== "==") {
              throw new Error(`Unsupported op ${f.op}`);
            }
            return data[f.field] === f.value;
          }),
        )
        .map(([id, data]) => ({
          id,
          data: () => ({ ...data }),
          ref: docRefFactory(collectionName, id),
        }));

      return {
        empty: docs.length === 0,
        size: docs.length,
        docs,
      };
    },
    limit(_count: number) {
      return this;
    },
  });

  return {
    collection(name: string) {
      return {
        doc(id?: string) {
          const docId = id || `auto_${++idCounter}`;
          return docRefFactory(name, docId);
        },
        where(field: string, op: string, value: unknown) {
          return queryFactory(name, [{ field, op, value }]);
        },
      };
    },
    async runTransaction(cb: any) {
      const transaction = {
        get: async (docRef: any) => docRef.get(),
        update: (docRef: any, patch: DocData) => docRef.update(patch),
        set: (docRef: any, data: DocData) => docRef.set(data),
      };
      return cb(transaction);
    },
    getCollectionData(name: string): Record<string, DocData> {
      const col = getCollection(name);
      return Object.fromEntries(col.entries());
    },
  };
}

describe("TASK-064 - Actualizar stock de producto", () => {
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    fakeFirestore = createFakeFirestore({
      productos: {
        prod_general: {
          clave: "GEN-001",
          descripcion: "Producto General",
          existencias: 10,
          tallaIds: [],
          inventarioPorTalla: [],
          activo: true,
        },
        prod_tallas: {
          clave: "TAL-001",
          descripcion: "Producto con Tallas",
          existencias: 8,
          tallaIds: ["s", "m"],
          inventarioPorTalla: [
            { tallaId: "s", cantidad: 3 },
            { tallaId: "m", cantidad: 5 },
          ],
          activo: true,
        },
      },
      movimientosInventario: {},
    });
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it("actualiza stock general y registra movimiento", async () => {
    const result = await productService.updateStock("prod_general", {
      cantidadNueva: 15,
      tipo: "ajuste",
      motivo: "Conteo físico",
      usuarioId: "admin_1",
    });

    expect(result).toMatchObject({
      productoId: "prod_general",
      tallaId: null,
      cantidadAnterior: 10,
      cantidadNueva: 15,
      diferencia: 5,
      existencias: 15,
    });

    const productos = fakeFirestore.getCollectionData("productos");
    expect(productos.prod_general.existencias).toBe(15);

    const movimientos = Object.values(
      fakeFirestore.getCollectionData("movimientosInventario"),
    );
    expect(movimientos).toHaveLength(1);
    expect(movimientos[0]).toMatchObject({
      productoId: "prod_general",
      tallaId: null,
      cantidadAnterior: 10,
      cantidadNueva: 15,
      diferencia: 5,
      tipo: "ajuste",
      motivo: "Conteo físico",
      usuarioId: "admin_1",
    });
  });

  it("actualiza stock por talla y recalcula existencias", async () => {
    const result = await productService.updateStock("prod_tallas", {
      tallaId: "m",
      cantidadNueva: 7,
      tipo: "entrada",
    });

    expect(result).toMatchObject({
      productoId: "prod_tallas",
      tallaId: "m",
      cantidadAnterior: 5,
      cantidadNueva: 7,
      diferencia: 2,
      existencias: 10,
    });

    const productos = fakeFirestore.getCollectionData("productos");
    expect(productos.prod_tallas.existencias).toBe(10);
    expect(productos.prod_tallas.inventarioPorTalla).toEqual([
      { tallaId: "s", cantidad: 3 },
      { tallaId: "m", cantidad: 7 },
    ]);
  });

  it("falla cuando falta tallaId en producto con inventario por talla", async () => {
    await expect(
      productService.updateStock("prod_tallas", {
        cantidadNueva: 9,
      }),
    ).rejects.toThrow("Se requiere tallaId");
  });

  it("falla cuando la cantidad es negativa", async () => {
    await expect(
      productService.updateStock("prod_general", {
        cantidadNueva: -1,
      }),
    ).rejects.toThrow("no puede ser negativa");
  });
});
