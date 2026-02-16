type DocData = Record<string, unknown>;

let fakeFirestore: ReturnType<typeof createFakeFirestore>;

jest.mock("../src/config/firebase", () => ({
  firestoreTienda: {
    collection: (name: string) => fakeFirestore.collection(name),
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

jest.mock("../src/services/stock-alert.service", () => ({
  __esModule: true,
  default: {
    notifyRealtime: jest.fn(),
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
  });

  const queryFactory = (
    collectionName: string,
    filters: Array<{ field: string; op: string; value: unknown }>,
  ) => ({
    where(field: string, op: string, value: unknown) {
      return queryFactory(collectionName, [...filters, { field, op, value }]);
    },
    async get() {
      const collection = getCollection(collectionName);
      const docs = Array.from(collection.entries())
        .filter(([, data]) =>
          filters.every((filter) => {
            if (filter.op !== "==") {
              throw new Error(`Unsupported operation: ${filter.op}`);
            }

            return data[filter.field] === filter.value;
          }),
        )
        .map(([id, data]) => ({
          id,
          data: () => ({ ...data }),
        }));

      return {
        docs,
        empty: docs.length === 0,
      };
    },
  });

  return {
    collection(name: string) {
      return {
        doc(id: string) {
          return docRefFactory(name, id);
        },
        where(field: string, op: string, value: unknown) {
          return queryFactory(name, [{ field, op, value }]);
        },
      };
    },
  };
}

describe("TASK-066 - Alertas de stock bajo", () => {
  beforeEach(() => {
    fakeFirestore = createFakeFirestore({
      productos: {
        prod_critical: {
          clave: "JER-001",
          descripcion: "Jersey Local",
          lineaId: "jersey",
          categoriaId: "hombre",
          existencias: 3,
          inventarioPorTalla: [],
          stockMinimoGlobal: 10,
          stockMinimoPorTalla: [],
          activo: true,
        },
        prod_size_low: {
          clave: "JER-002",
          descripcion: "Jersey Visitante",
          lineaId: "jersey",
          categoriaId: "hombre",
          existencias: 20,
          inventarioPorTalla: [
            { tallaId: "m", cantidad: 1 },
            { tallaId: "l", cantidad: 9 },
          ],
          stockMinimoGlobal: 5,
          stockMinimoPorTalla: [
            { tallaId: "m", minimo: 5 },
            { tallaId: "l", minimo: 8 },
          ],
          activo: true,
        },
        prod_ok: {
          clave: "JER-003",
          descripcion: "Jersey Entrenamiento",
          lineaId: "entrenamiento",
          categoriaId: "hombre",
          existencias: 50,
          inventarioPorTalla: [],
          stockMinimoGlobal: 10,
          stockMinimoPorTalla: [],
          activo: true,
        },
      },
    });
  });

  it("lista productos con stock bajo global y por talla", async () => {
    const alerts = await productService.listLowStockProducts({
      limit: 50,
      soloCriticas: false,
    });

    expect(alerts).toHaveLength(2);
    expect(alerts[0].productoId).toBe("prod_critical");
    expect(alerts[0].globalBajoStock).toBe(true);
    expect(alerts[0].maxDeficit).toBe(7);

    const sizeAlert = alerts.find(
      (item) => item.productoId === "prod_size_low",
    );
    expect(sizeAlert).toBeDefined();
    expect(sizeAlert?.tallasBajoStock).toHaveLength(1);
    expect(sizeAlert?.tallasBajoStock[0]).toMatchObject({
      tallaId: "m",
      cantidadActual: 1,
      minimo: 5,
      deficit: 4,
    });
  });

  it("filtra alertas críticas correctamente", async () => {
    const criticalAlerts = await productService.listLowStockProducts({
      limit: 50,
      soloCriticas: true,
    });

    expect(criticalAlerts).toHaveLength(1);
    expect(criticalAlerts[0].productoId).toBe("prod_critical");
  });

  it("obtiene alerta por producto ID", async () => {
    const alert =
      await productService.getLowStockAlertByProductId("prod_size_low");

    expect(alert).not.toBeNull();
    expect(alert?.productoId).toBe("prod_size_low");
    expect(alert?.totalAlertas).toBe(1);
  });
});
