/// <reference types="jest" />

type DocData = Record<string, unknown>;

const getStockBySizeMock = jest.fn();
const registerRecepcionMovementMock = jest.fn();

jest.mock("../src/services/product.service", () => ({
  __esModule: true,
  default: {
    getStockBySize: (...args: unknown[]) => getStockBySizeMock(...args),
  },
}));

jest.mock("../src/services/inventory.service", () => ({
  __esModule: true,
  default: {
    registerRecepcionMovement: (...args: unknown[]) =>
      registerRecepcionMovementMock(...args),
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
        now: () => new Date("2026-06-22T12:00:00.000Z"),
        fromDate: (date: Date) => date,
      },
    },
  },
}));

import inventoryReceptionService from "../src/services/inventory-reception.service";
import { EstadoRecepcionMercancia } from "../src/models/inventario.model";

let fakeFirestore: ReturnType<typeof createFakeFirestore>;

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
      };
    },
    async update(patch: DocData) {
      const col = getCollection(collectionName);
      const existing = col.get(id);
      if (!existing) {
        throw new Error(`Doc ${collectionName}/${id} not found`);
      }
      col.set(id, { ...existing, ...patch });
    },
    async set(data: DocData) {
      getCollection(collectionName).set(id, { ...data });
    },
  });

  return {
    collection(name: string) {
      return {
        doc(id?: string) {
          const docId = id ?? `auto_${++idCounter}`;
          return docRefFactory(name, docId);
        },
        orderBy(field: string, direction: "asc" | "desc") {
          return {
            limit: (_count: number) => ({
              async get() {
                const col = getCollection(name);
                const docs = Array.from(col.entries())
                  .sort(([, a], [, b]) => {
                    const va = a[field] as string | Date;
                    const vb = b[field] as string | Date;
                    if (va < vb) return direction === "asc" ? -1 : 1;
                    if (va > vb) return direction === "asc" ? 1 : -1;
                    return 0;
                  })
                  .map(([docId, data]) => ({
                    id: docId,
                    data: () => ({ ...data }),
                  }));
                return { docs, empty: docs.length === 0 };
              },
            }),
            startAfter: (_doc: { id: string }) => ({
              limit: (_count: number) => ({
                async get() {
                  return { docs: [], empty: true };
                },
              }),
            }),
          };
        },
        where(field: string, op: string, value: unknown) {
          return {
            orderBy: (orderField: string, direction: "asc" | "desc") => ({
              limit: (_count: number) => ({
                async get() {
                  const col = getCollection(name);
                  const docs = Array.from(col.entries())
                    .filter(([, data]) =>
                      op === "==" ? data[field] === value : true,
                    )
                    .sort(([, a], [, b]) => {
                      const va = a[orderField] as string | Date;
                      const vb = b[orderField] as string | Date;
                      if (va < vb) return direction === "asc" ? -1 : 1;
                      if (va > vb) return direction === "asc" ? 1 : -1;
                      return 0;
                    })
                    .map(([docId, data]) => ({
                      id: docId,
                      data: () => ({ ...data }),
                    }));
                  return { docs, empty: docs.length === 0 };
                },
              }),
            }),
          };
        },
      };
    },
    getCollectionData(name: string): Record<string, DocData> {
      return Object.fromEntries(getCollection(name).entries());
    },
  };
}

describe("Recepciones de mercancía", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getStockBySizeMock.mockResolvedValue({
      productoId: "prod_1",
      tallaIds: [],
      existencias: 5,
      inventarioPorTalla: [],
    });
    registerRecepcionMovementMock.mockResolvedValue({
      id: "mov_recepcion_1",
      tipo: "recepcion",
      productoId: "prod_1",
      cantidadAnterior: 5,
      cantidadNueva: 8,
      diferencia: 3,
    });

    fakeFirestore = createFakeFirestore({
      recepcionesMercancia: {
        rec_1: {
          proveedorNombre: "Proveedor A",
          referencia: "PO-100",
          fechaRecepcion: new Date("2026-06-20T10:00:00.000Z"),
          responsableId: "admin_1",
          estado: EstadoRecepcionMercancia.BORRADOR,
          lineas: [
            {
              productoId: "prod_1",
              tallaId: null,
              cantidadEsperada: 10,
              cantidadAceptada: 0,
              cantidadRechazada: 0,
              cantidadPendiente: 10,
            },
          ],
          createdAt: new Date("2026-06-20T10:00:00.000Z"),
          updatedAt: new Date("2026-06-20T10:00:00.000Z"),
        },
        rec_cerrada: {
          referencia: "PO-200",
          fechaRecepcion: new Date("2026-06-18T10:00:00.000Z"),
          responsableId: "admin_1",
          estado: EstadoRecepcionMercancia.CERRADA,
          lineas: [
            {
              productoId: "prod_1",
              tallaId: null,
              cantidadEsperada: 5,
              cantidadAceptada: 5,
              cantidadRechazada: 0,
              cantidadPendiente: 0,
            },
          ],
          createdAt: new Date("2026-06-18T10:00:00.000Z"),
          updatedAt: new Date("2026-06-18T11:00:00.000Z"),
          cerradaEn: new Date("2026-06-18T11:00:00.000Z"),
        },
      },
      recepcionesConfirmacionIdempotency: {},
    });
  });

  it("confirma recepción parcial y actualiza stock vía movimiento recepcion", async () => {
    const result = await inventoryReceptionService.confirmRecepcion({
      recepcionId: "rec_1",
      responsableId: "admin_1",
      lineas: [
        {
          productoId: "prod_1",
          cantidadAceptada: 3,
          cantidadRechazada: 1,
        },
      ],
    });

    expect(registerRecepcionMovementMock).toHaveBeenCalledWith(
      expect.objectContaining({
        productoId: "prod_1",
        cantidad: 3,
        recepcionId: "rec_1",
      }),
    );

    expect(result.estado).toBe(EstadoRecepcionMercancia.PARCIAL);
    expect(result.lineas[0]).toMatchObject({
      cantidadAceptada: 3,
      cantidadRechazada: 1,
      cantidadPendiente: 6,
    });
  });

  it("bloquea confirmación en recepción cerrada", async () => {
    await expect(
      inventoryReceptionService.confirmRecepcion({
        recepcionId: "rec_cerrada",
        responsableId: "admin_1",
        lineas: [
          {
            productoId: "prod_1",
            cantidadAceptada: 1,
            cantidadRechazada: 0,
          },
        ],
      }),
    ).rejects.toThrow("cerrada");

    expect(registerRecepcionMovementMock).not.toHaveBeenCalled();
  });

  it("reutiliza confirmación con idempotency key", async () => {
    const first = await inventoryReceptionService.confirmRecepcion({
      recepcionId: "rec_1",
      responsableId: "admin_1",
      idempotencyKey: "confirm-batch-001",
      lineas: [
        {
          productoId: "prod_1",
          cantidadAceptada: 2,
          cantidadRechazada: 0,
        },
      ],
    });

    registerRecepcionMovementMock.mockClear();

    const second = await inventoryReceptionService.confirmRecepcion({
      recepcionId: "rec_1",
      responsableId: "admin_1",
      idempotencyKey: "confirm-batch-001",
      lineas: [
        {
          productoId: "prod_1",
          cantidadAceptada: 2,
          cantidadRechazada: 0,
        },
      ],
    });

    expect(registerRecepcionMovementMock).not.toHaveBeenCalled();
    expect(second.lineas[0].cantidadAceptada).toBe(first.lineas[0].cantidadAceptada);
  });
});
