/// <reference types="jest" />

type DocData = Record<string, any>;

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
        now: () => new Date("2026-02-17T12:00:00.000Z"),
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

  return {
    collection(name: string) {
      return {
        doc(id: string) {
          return {
            id,
            async get() {
              const collection = getCollection(name);
              const data = collection.get(id);
              return {
                exists: !!data,
                id,
                data: () => (data ? { ...data } : undefined),
              };
            },
            async set(data: DocData) {
              const collection = getCollection(name);
              collection.set(id, { ...data });
            },
          };
        },
      };
    },
  };
}

describe("TASK-067 - Ajustes de inventario", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    fakeFirestore = createFakeFirestore({
      inventarioAjustesIdempotency: {},
    });
  });

  it("registra ajuste desde cantidadFisica y calcula diferencia", async () => {
    getStockBySizeMock.mockResolvedValue({
      productoId: "prod_1",
      existencias: 12,
      inventarioPorTalla: [],
    });

    updateStockMock.mockResolvedValue({
      productoId: "prod_1",
      tallaId: null,
      cantidadAnterior: 12,
      cantidadNueva: 9,
      diferencia: -3,
      existencias: 9,
      inventarioPorTalla: [],
      movimientoId: "mov_adj_1",
      createdAt: new Date("2026-02-17T10:00:00.000Z"),
    });

    const result = await inventoryService.registerAdjustment({
      productoId: "prod_1",
      cantidadFisica: 9,
      motivo: "Conteo físico semanal",
      usuarioId: "admin_1",
    });

    expect(result.reused).toBe(false);
    expect(updateStockMock).toHaveBeenCalledWith("prod_1", {
      cantidadNueva: 9,
      tallaId: undefined,
      tipo: TipoMovimientoInventario.AJUSTE,
      motivo: "Conteo físico semanal",
      referencia: undefined,
      usuarioId: "admin_1",
    });

    expect(result.movimiento).toMatchObject({
      id: "mov_adj_1",
      tipo: "ajuste",
      productoId: "prod_1",
      cantidadAnterior: 12,
      cantidadNueva: 9,
      diferencia: -3,
      motivo: "Conteo físico semanal",
    });
  });

  it("exige tallaId cuando el producto maneja inventario por talla", async () => {
    getStockBySizeMock.mockResolvedValue({
      productoId: "prod_2",
      existencias: 20,
      inventarioPorTalla: [{ tallaId: "m", cantidad: 10 }],
    });

    await expect(
      inventoryService.registerAdjustment({
        productoId: "prod_2",
        cantidadFisica: 8,
        motivo: "Conteo físico por talla",
      }),
    ).rejects.toThrow(
      "Se requiere tallaId para registrar movimiento en productos con inventario por talla",
    );

    expect(updateStockMock).not.toHaveBeenCalled();
  });

  it("reutiliza el ajuste cuando se repite idempotencyKey", async () => {
    getStockBySizeMock.mockResolvedValue({
      productoId: "prod_3",
      existencias: 6,
      inventarioPorTalla: [],
    });

    updateStockMock.mockResolvedValue({
      productoId: "prod_3",
      tallaId: null,
      cantidadAnterior: 6,
      cantidadNueva: 7,
      diferencia: 1,
      existencias: 7,
      inventarioPorTalla: [],
      movimientoId: "mov_adj_2",
      createdAt: new Date("2026-02-17T11:00:00.000Z"),
    });

    const first = await inventoryService.registerAdjustment({
      productoId: "prod_3",
      cantidadFisica: 7,
      motivo: "Ajuste por auditoría",
      idempotencyKey: "adj-2026-02-17-001",
      usuarioId: "admin_2",
    });

    const second = await inventoryService.registerAdjustment({
      productoId: "prod_3",
      cantidadFisica: 7,
      motivo: "Ajuste por auditoría",
      idempotencyKey: "adj-2026-02-17-001",
      usuarioId: "admin_2",
    });

    expect(first.reused).toBe(false);
    expect(second.reused).toBe(true);
    expect(updateStockMock).toHaveBeenCalledTimes(1);
    expect(second.movimiento).toMatchObject({
      id: "mov_adj_2",
      tipo: "ajuste",
      productoId: "prod_3",
      cantidadNueva: 7,
    });
  });
});
