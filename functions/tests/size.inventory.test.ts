type DocData = Record<string, unknown>;

let dbState: Record<string, Record<string, DocData>>;

const createFakeFirestore = () => ({
  collection: (collectionName: string) => ({
    where: (field: string, op: string, value: unknown) => ({
      where: (nestedField: string, nestedOp: string, nestedValue: unknown) => ({
        async get() {
          const collection = dbState[collectionName] ?? {};
          const docs = Object.entries(collection)
            .filter(([, data]) => {
              if (op !== "==" || nestedOp !== "array-contains") {
                throw new Error("Unsupported query operation");
              }

              const firstMatch = data[field] === value;
              const nestedValueArray = Array.isArray(data[nestedField])
                ? (data[nestedField] as unknown[])
                : [];
              const secondMatch = nestedValueArray.includes(nestedValue);

              return firstMatch && secondMatch;
            })
            .map(([id, data]) => ({ id, data: () => ({ ...data }) }));

          return { docs };
        },
      }),
    }),
    doc: (id: string) => ({
      async get() {
        const collection = dbState[collectionName] ?? {};
        const data = collection[id];
        return {
          exists: !!data,
          id,
          data: () => (data ? { ...data } : undefined),
        };
      },
      async delete() {
        const collection = dbState[collectionName] ?? {};
        if (!collection[id]) {
          return;
        }
        const updated = { ...collection };
        delete updated[id];
        dbState[collectionName] = updated;
      },
    }),
    async get() {
      const collection = dbState[collectionName] ?? {};
      const docs = Object.entries(collection).map(([id, data]) => ({
        id,
        data: () => ({ ...data }),
      }));

      return { docs };
    },
  }),
});

jest.mock("../src/config/firebase", () => ({
  firestoreTienda: createFakeFirestore(),
}));

import { deleteSize, getSizeInventory } from "../src/services/size.service";

describe("Size inventory service", () => {
  beforeEach(() => {
    dbState = {
      tallas: {
        m: { codigo: "M", descripcion: "Mediana", orden: 2 },
        l: { codigo: "L", descripcion: "Grande", orden: 3 },
      },
      productos: {
        prod_1: {
          activo: true,
          clave: "JER-001",
          descripcion: "Jersey Oficial",
          tallaIds: ["s", "m", "l"],
          inventarioPorTalla: [
            { tallaId: "s", cantidad: 2 },
            { tallaId: "m", cantidad: 4 },
            { tallaId: "l", cantidad: 1 },
          ],
        },
        prod_2: {
          activo: true,
          clave: "JER-002",
          descripcion: "Jersey Visitante",
          tallaIds: ["m", "l"],
          inventarioPorTalla: [{ tallaId: "l", cantidad: 5 }],
        },
      },
    };
  });

  it("retorna inventario agregado por talla", async () => {
    const result = await getSizeInventory("m");

    expect(result.talla.id).toBe("m");
    expect(result.resumen.totalProductos).toBe(2);
    expect(result.resumen.totalUnidades).toBe(4);
    expect(result.productos).toEqual([
      {
        productoId: "prod_1",
        clave: "JER-001",
        descripcion: "Jersey Oficial",
        cantidad: 4,
        existencias: 7,
      },
      {
        productoId: "prod_2",
        clave: "JER-002",
        descripcion: "Jersey Visitante",
        cantidad: 0,
        existencias: 5,
      },
    ]);
  });

  it("bloquea eliminar talla en uso", async () => {
    await expect(deleteSize("m")).rejects.toThrow("está en uso por");
  });

  it("elimina talla cuando no está en uso", async () => {
    await expect(deleteSize("l")).rejects.toThrow("está en uso por");

    dbState.productos = {};
    await deleteSize("l");

    expect(dbState.tallas.l).toBeUndefined();
  });
});
