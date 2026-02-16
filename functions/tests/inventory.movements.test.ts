/// <reference types="jest" />

type DocData = Record<string, any>;

type QueryFilter = { field: string; op: "==" | ">=" | "<="; value: unknown };

let fakeFirestore: ReturnType<typeof createFakeFirestore>;

const getStockBySizeMock = jest.fn();
const updateStockMock = jest.fn();

jest.mock("../src/services/product.service", () => ({
  __esModule: true,
  default: {
    getStockBySize: (...args: unknown[]) => getStockBySizeMock(...args),
    updateStock: (...args: unknown[]) => updateStockMock(...args),
  },
}));

jest.mock("../src/config/firebase", () => ({
  firestoreTienda: {
    collection: (name: string) => fakeFirestore.collection(name),
  },
}));

jest.mock("../src/config/firebase.admin", () => ({
  admin: {
    firestore: {
      Timestamp: {
        fromDate: (date: Date) => date,
      },
    },
  },
}));

import inventoryService from "../src/services/inventory.service";
import { TipoMovimientoInventario } from "../src/models/inventario.model";

function createFakeFirestore(initial: Record<string, Record<string, DocData>>) {
  const collections = new Map<string, Map<string, DocData>>();

  Object.entries(initial).forEach(([name, docs]) => {
    collections.set(
      name,
      new Map(Object.entries(docs).map(([id, data]) => [id, { ...data }])),
    );
  });

  const getCollection = (name: string): Map<string, DocData> => {
    if (!collections.has(name)) {
      collections.set(name, new Map());
    }
    return collections.get(name)!;
  };

  const docRefFactory = (collectionName: string, id: string) => ({
    id,
    async get() {
      const collection = getCollection(collectionName);
      const data = collection.get(id);
      return {
        exists: !!data,
        id,
        data: () => (data ? { ...data } : undefined),
      };
    },
    set(data: DocData) {
      const collection = getCollection(collectionName);
      collection.set(id, { ...data });
    },
  });

  const queryFactory = (
    collectionName: string,
    filters: QueryFilter[] = [],
    orderByField?: string,
    orderByDirection: "asc" | "desc" = "asc",
    afterDocId?: string,
    limitCount?: number,
  ) => ({
    where(field: string, op: "==" | ">=" | "<=", value: unknown) {
      return queryFactory(
        collectionName,
        [...filters, { field, op, value }],
        orderByField,
        orderByDirection,
        afterDocId,
        limitCount,
      );
    },
    orderBy(field: string, direction: "asc" | "desc") {
      return queryFactory(
        collectionName,
        filters,
        field,
        direction,
        afterDocId,
        limitCount,
      );
    },
    startAfter(doc: { id: string }) {
      return queryFactory(
        collectionName,
        filters,
        orderByField,
        orderByDirection,
        doc.id,
        limitCount,
      );
    },
    limit(count: number) {
      return queryFactory(
        collectionName,
        filters,
        orderByField,
        orderByDirection,
        afterDocId,
        count,
      );
    },
    async get() {
      const collection = getCollection(collectionName);

      let docs = Array.from(collection.entries())
        .filter(([, data]) =>
          filters.every((filter) => {
            const value = data[filter.field];
            if (filter.op === "==") {
              return value === filter.value;
            }
            if (filter.op === ">=") {
              return value >= (filter.value as any);
            }
            return value <= (filter.value as any);
          }),
        )
        .map(([id, data]) => ({
          id,
          data: () => ({ ...data }),
        }));

      if (orderByField) {
        docs = docs.sort((a, b) => {
          const va = a.data()[orderByField];
          const vb = b.data()[orderByField];

          if (va < vb) return orderByDirection === "asc" ? -1 : 1;
          if (va > vb) return orderByDirection === "asc" ? 1 : -1;
          return 0;
        });
      }

      if (afterDocId) {
        const index = docs.findIndex((doc) => doc.id === afterDocId);
        if (index >= 0) {
          docs = docs.slice(index + 1);
        }
      }

      if (typeof limitCount === "number") {
        docs = docs.slice(0, limitCount);
      }

      return { docs };
    },
  });

  return {
    collection(name: string) {
      return {
        doc(id: string) {
          return docRefFactory(name, id);
        },
        where(field: string, op: "==" | ">=" | "<=", value: unknown) {
          return queryFactory(name).where(field, op, value);
        },
        orderBy(field: string, direction: "asc" | "desc") {
          return queryFactory(name).orderBy(field, direction);
        },
      };
    },
  };
}

describe("TASK-065 - Movimientos de inventario", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    fakeFirestore = createFakeFirestore({
      ordenes: {
        orden_1: {
          usuarioId: "user_1",
        },
      },
      movimientosInventario: {
        mov_1: {
          tipo: "entrada",
          productoId: "prod_1",
          tallaId: null,
          cantidadAnterior: 2,
          cantidadNueva: 5,
          diferencia: 3,
          usuarioId: "user_1",
          createdAt: new Date("2026-02-10T10:00:00.000Z"),
        },
        mov_2: {
          tipo: "venta",
          productoId: "prod_2",
          tallaId: "m",
          cantidadAnterior: 8,
          cantidadNueva: 6,
          diferencia: -2,
          ordenId: "orden_1",
          usuarioId: "user_1",
          createdAt: new Date("2026-02-11T10:00:00.000Z"),
        },
        mov_3: {
          tipo: "devolucion",
          productoId: "prod_2",
          tallaId: "m",
          cantidadAnterior: 6,
          cantidadNueva: 8,
          diferencia: 2,
          ordenId: "orden_1",
          usuarioId: "user_2",
          createdAt: new Date("2026-02-12T10:00:00.000Z"),
        },
      },
    });
  });

  it("registra movimiento de entrada y calcula cantidadNueva", async () => {
    getStockBySizeMock.mockResolvedValue({
      productoId: "prod_1",
      existencias: 10,
      inventarioPorTalla: [],
    });

    updateStockMock.mockResolvedValue({
      productoId: "prod_1",
      tallaId: null,
      cantidadAnterior: 10,
      cantidadNueva: 15,
      diferencia: 5,
      existencias: 15,
      inventarioPorTalla: [],
      movimientoId: "mov_new_1",
      createdAt: new Date("2026-02-16T10:00:00.000Z"),
    });

    const result = await inventoryService.registerMovement({
      tipo: TipoMovimientoInventario.ENTRADA,
      productoId: "prod_1",
      cantidad: 5,
      motivo: "Recepción de proveedor",
      usuarioId: "admin_1",
    });

    expect(updateStockMock).toHaveBeenCalledWith("prod_1", {
      cantidadNueva: 15,
      tallaId: undefined,
      tipo: "entrada",
      motivo: "Recepción de proveedor",
      referencia: undefined,
      ordenId: undefined,
      usuarioId: "admin_1",
    });

    expect(result).toMatchObject({
      id: "mov_new_1",
      tipo: "entrada",
      productoId: "prod_1",
      cantidadAnterior: 10,
      cantidadNueva: 15,
      diferencia: 5,
    });
  });

  it("falla en venta cuando falta ordenId", async () => {
    await expect(
      inventoryService.registerMovement({
        tipo: TipoMovimientoInventario.VENTA,
        productoId: "prod_1",
        cantidad: 2,
      }),
    ).rejects.toThrow("ordenId es requerido");
  });

  it("registra venta relacionada con orden", async () => {
    getStockBySizeMock.mockResolvedValue({
      productoId: "prod_2",
      existencias: 8,
      inventarioPorTalla: [{ tallaId: "m", cantidad: 8 }],
    });

    updateStockMock.mockResolvedValue({
      productoId: "prod_2",
      tallaId: "m",
      cantidadAnterior: 8,
      cantidadNueva: 6,
      diferencia: -2,
      existencias: 6,
      inventarioPorTalla: [{ tallaId: "m", cantidad: 6 }],
      movimientoId: "mov_new_2",
      createdAt: new Date("2026-02-16T11:00:00.000Z"),
    });

    const result = await inventoryService.registerMovement({
      tipo: TipoMovimientoInventario.VENTA,
      productoId: "prod_2",
      tallaId: "m",
      cantidad: 2,
      ordenId: "orden_1",
      usuarioId: "user_1",
    });

    expect(updateStockMock).toHaveBeenCalledWith("prod_2", {
      cantidadNueva: 6,
      tallaId: "m",
      tipo: "venta",
      motivo: undefined,
      referencia: undefined,
      ordenId: "orden_1",
      usuarioId: "user_1",
    });

    expect(result.ordenId).toBe("orden_1");
    expect(result.tipo).toBe("venta");
  });

  it("lista historial con filtro de usuario y cursor", async () => {
    const firstPage = await inventoryService.listMovements({
      limit: 1,
      usuarioId: "user_1",
    });

    expect(firstPage.movimientos).toHaveLength(1);
    expect(firstPage.movimientos[0].id).toBe("mov_2");
    expect(firstPage.nextCursor).toBe("mov_2");

    const secondPage = await inventoryService.listMovements({
      limit: 1,
      usuarioId: "user_1",
      cursor: firstPage.nextCursor || undefined,
    });

    expect(secondPage.movimientos).toHaveLength(1);
    expect(secondPage.movimientos[0].id).toBe("mov_1");
    expect(secondPage.nextCursor).toBeNull();
  });
});
