type CollectionData = Record<string, Record<string, unknown>>;

let dbState: CollectionData;

const createFakeFirestore = () => ({
  collection: (collectionName: string) => ({
    doc: (id: string) => ({
      get: async () => {
        const collection = dbState[collectionName] ?? {};
        const data = collection[id];

        return {
          exists: !!data,
          id,
          data: () => (data ? { ...data } : undefined),
        };
      },
      update: async (patch: Record<string, unknown>) => {
        const collection = dbState[collectionName] ?? {};
        const current = collection[id];

        if (!current) {
          throw new Error(`Documento ${collectionName}/${id} no encontrado`);
        }

        dbState[collectionName] = {
          ...collection,
          [id]: {
            ...current,
            ...patch,
          },
        };
      },
    }),
  }),
});

jest.mock("../src/config/firebase", () => ({
  firestoreTienda: createFakeFirestore(),
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

jest.mock("../src/services/orden.service", () => ({
  __esModule: true,
  default: {
    createOrden: jest.fn(),
  },
}));

import carritoService from "../src/services/carrito.service";
import productService from "../src/services/product.service";

describe("TASK-063 - Inventario por talla", () => {
  beforeEach(() => {
    dbState = {
      productos: {
        prod_1: {
          clave: "JER-001",
          descripcion: "Jersey Oficial",
          lineaId: "jersey",
          categoriaId: "hombre",
          precioPublico: 1299.99,
          precioCompra: 650,
          existencias: 8,
          proveedorId: "prov_1",
          tallaIds: ["s", "m"],
          inventarioPorTalla: [
            { tallaId: "s", cantidad: 3 },
            { tallaId: "m", cantidad: 5 },
          ],
          imagenes: [],
          activo: true,
          createdAt: new Date("2026-02-16T00:00:00.000Z"),
          updatedAt: new Date("2026-02-16T00:00:00.000Z"),
        },
      },
      carritos: {
        cart_1: {
          usuarioId: "user_1",
          items: [],
          subtotal: 0,
          total: 0,
          createdAt: new Date("2026-02-16T00:00:00.000Z"),
          updatedAt: new Date("2026-02-16T00:00:00.000Z"),
        },
      },
    };
  });

  it("retorna stock por talla con existencias derivadas", async () => {
    const stock = await productService.getStockBySize("prod_1");

    expect(stock).not.toBeNull();
    expect(stock).toEqual({
      productoId: "prod_1",
      existencias: 8,
      inventarioPorTalla: [
        { tallaId: "s", cantidad: 3 },
        { tallaId: "m", cantidad: 5 },
      ],
    });
  });

  it("rechaza agregar al carrito sin talla cuando el producto maneja inventario por talla", async () => {
    await expect(
      carritoService.addItem("cart_1", {
        productoId: "prod_1",
        cantidad: 1,
      }),
    ).rejects.toThrow("Se requiere seleccionar una talla");
  });

  it("rechaza agregar al carrito cuando la talla no tiene stock suficiente", async () => {
    await expect(
      carritoService.addItem("cart_1", {
        productoId: "prod_1",
        cantidad: 6,
        tallaId: "m",
      }),
    ).rejects.toThrow("Stock insuficiente");
  });

  it("agrega al carrito cuando la talla tiene stock disponible", async () => {
    const carrito = await carritoService.addItem("cart_1", {
      productoId: "prod_1",
      cantidad: 2,
      tallaId: "m",
    });

    expect(carrito.items).toHaveLength(1);
    expect(carrito.items[0]).toMatchObject({
      productoId: "prod_1",
      tallaId: "m",
      cantidad: 2,
      precioUnitario: 1299.99,
    });
    expect(carrito.subtotal).toBe(2599.98);
    expect(carrito.total).toBe(2599.98);
  });
});
