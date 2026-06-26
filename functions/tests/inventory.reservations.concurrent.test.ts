/// <reference types="jest" />

type DocData = Record<string, unknown>;

let fakeFirestore: ReturnType<typeof createFakeFirestore>;

jest.mock("../src/config/inventory.config", () => ({
  INVENTORY_RESERVATION_TTL_MINUTES: 30,
  INVENTORY_EMPLOYEE_ADJUSTMENT_LIMIT: 5,
}));

jest.mock("../src/config/firebase", () => ({
  firestoreTienda: {
    collection: (name: string) => fakeFirestore.collection(name),
    runTransaction: (cb: (tx: FakeTransaction) => Promise<unknown>) =>
      fakeFirestore.runTransaction(cb),
    batch: () => fakeFirestore.batch(),
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

jest.mock("../src/services/inventory.service", () => ({
  __esModule: true,
  default: {
    orderHasSaleMovements: jest.fn().mockResolvedValue(false),
    registerMovement: jest.fn(),
  },
}));

jest.mock("../src/services/checkout/checkout-attempt.service", () => ({
  __esModule: true,
  default: {
    reconcileStripeBeforeRelease: jest.fn().mockResolvedValue({
      action: "release",
    }),
  },
}));

type FakeTransaction = {
  get: (docRef: {
    get: () => Promise<{
      exists: boolean;
      data: () => DocData | undefined;
    }>;
  }) => Promise<{ exists: boolean; data: () => DocData | undefined }>;
  update: (
    docRef: { update: (patch: DocData) => Promise<void> },
    patch: DocData,
  ) => void;
  set: (
    docRef: { set: (data: DocData) => Promise<void> },
    data: DocData,
  ) => void;
};

function createFakeFirestore(initial: Record<string, Record<string, DocData>>) {
  const collections = new Map<string, Map<string, DocData>>();
  Object.entries(initial).forEach(([name, docs]) => {
    collections.set(
      name,
      new Map(Object.entries(docs).map(([id, data]) => [id, { ...data }])),
    );
  });

  let idCounter = 0;
  let lock = Promise.resolve();

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
        data: () => (data ? JSON.parse(JSON.stringify(data)) : undefined),
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
      getCollection(collectionName).set(id, JSON.parse(JSON.stringify(data)));
    },
  });

  return {
    collection(name: string) {
      return {
        doc(id?: string) {
          const docId = id ?? `auto_${++idCounter}`;
          return docRefFactory(name, docId);
        },
        where(field: string, op: string, value: unknown) {
          const filters = [{ field, op, value }];
          const query = {
            where(f: string, o: string, v: unknown) {
              filters.push({ field: f, op: o, value: v });
              return query;
            },
            limit(_count: number) {
              return query;
            },
            async get() {
              const col = getCollection(name);
              const docs = Array.from(col.entries())
                .filter(([, data]) =>
                  filters.every((filter) =>
                    filter.op === "=="
                      ? data[filter.field] === filter.value
                      : true,
                  ),
                )
                .map(([docId, data]) => ({
                  id: docId,
                  data: () => ({ ...data }),
                  ref: docRefFactory(name, docId),
                }));
              return { docs, empty: docs.length === 0 };
            },
          };
          return query;
        },
      };
    },
    async runTransaction(cb: (tx: FakeTransaction) => Promise<unknown>) {
      const snapshotBefore = () =>
        JSON.stringify(
          Object.fromEntries(
            Array.from(collections.entries()).map(([name, docs]) => [
              name,
              Object.fromEntries(
                Array.from(docs.entries()).map(([id, data]) => [id, { ...data }]),
              ),
            ]),
          ),
        );

      const restoreSnapshot = (snapshot: string) => {
        const restored = JSON.parse(snapshot) as Record<
          string,
          Record<string, DocData>
        >;
        collections.clear();
        Object.entries(restored).forEach(([name, docs]) => {
          collections.set(
            name,
            new Map(
              Object.entries(docs).map(([id, data]) => [id, { ...data }]),
            ),
          );
        });
      };

      const run = async () => {
        const before = snapshotBefore();
        const tx: FakeTransaction = {
          get: async (docRef) => docRef.get(),
          update: (docRef, patch) => {
            void docRef.update(patch);
          },
          set: (docRef, data) => {
            void docRef.set(data);
          },
        };

        try {
          return await cb(tx);
        } catch (error) {
          restoreSnapshot(before);
          throw error;
        }
      };

      const result = lock.then(run, run);
      lock = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    },
    batch() {
      const ops: Array<() => Promise<void>> = [];
      return {
        update(
          docRef: { update: (patch: DocData) => Promise<void> },
          patch: DocData,
        ) {
          ops.push(() => docRef.update(patch));
        },
        async commit() {
          for (const op of ops) {
            await op();
          }
        },
      };
    },
    getCollectionData(name: string): Record<string, DocData> {
      return Object.fromEntries(getCollection(name).entries());
    },
  };
}

import inventoryReservationService, {
  InventoryStockUnavailableError,
} from "../src/services/inventory-reservation.service";
import { EstadoReservaInventario } from "../src/models/inventario.model";

describe("Reservas concurrentes de inventario", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    fakeFirestore = createFakeFirestore({
      ordenes: {
        orden_a: {
          usuarioId: "user_a",
          items: [{ productoId: "prod_last", cantidad: 1 }],
        },
        orden_b: {
          usuarioId: "user_b",
          items: [{ productoId: "prod_last", cantidad: 1 }],
        },
      },
      productos: {
        prod_last: {
          existencias: 1,
          tallaIds: [],
          inventarioPorTalla: [],
          inventarioGlobal: {
            fisica: 1,
            reservada: 0,
            noDisponible: 0,
            entrante: 0,
            disponible: 1,
          },
        },
      },
      reservasInventario: {},
      movimientosInventario: {},
    });
  });

  it("22 reservas concurrentes de checkout obtienen exactamente 1 unidad", async () => {
    const concurrency = 22;
    const attempts = Array.from({ length: concurrency }, (_, index) => {
      return inventoryReservationService.reserveForCheckoutAttempt({
        checkoutAttemptId: `attempt_${index}`,
        usuarioId: `user_${index}`,
        idempotencyPrefix: "checkout-attempt",
        items: [{ productoId: "prod_last", cantidad: 1 }],
      });
    });

    const results = await Promise.allSettled(attempts);
    const fulfilled = results.filter((item) => item.status === "fulfilled");
    const rejected = results.filter((item) => item.status === "rejected");

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(concurrency - 1);
    rejected.forEach((item) => {
      const reason = (item as PromiseRejectedResult).reason;
      expect(reason).toBeInstanceOf(InventoryStockUnavailableError);
    });

    const reservas = Object.values(
      fakeFirestore.getCollectionData("reservasInventario"),
    ).filter((item) => item.estado === EstadoReservaInventario.ACTIVA);
    expect(reservas).toHaveLength(1);

    const producto = fakeFirestore.getCollectionData("productos").prod_last as {
      inventarioGlobal: { fisica: number; reservada: number; disponible: number };
    };
    expect(producto.inventarioGlobal).toMatchObject({
      fisica: 1,
      reservada: 1,
      disponible: 0,
    });

    const ordenes = fakeFirestore.getCollectionData("ordenes");
    expect(Object.keys(ordenes)).toHaveLength(2);
  });

  it("tras confirmar pago simulado: fisica=0 y reservada=0", async () => {
    fakeFirestore = createFakeFirestore({
      ordenes: {
        orden_webhook: {
          usuarioId: "user_webhook",
          items: [{ productoId: "prod_last", cantidad: 1 }],
        },
      },
      productos: {
        prod_last: {
          existencias: 1,
          tallaIds: [],
          inventarioPorTalla: [],
          inventarioGlobal: {
            fisica: 1,
            reservada: 0,
            noDisponible: 0,
            entrante: 0,
            disponible: 1,
          },
        },
      },
      reservasInventario: {},
      movimientosInventario: {},
    });

    await inventoryReservationService.reserveForCheckoutAttempt({
      checkoutAttemptId: "attempt_webhook",
      usuarioId: "user_webhook",
      idempotencyPrefix: "checkout-attempt",
      items: [{ productoId: "prod_last", cantidad: 1 }],
    });

    const reservaEntries = Object.entries(
      fakeFirestore.getCollectionData("reservasInventario"),
    );
    expect(reservaEntries).toHaveLength(1);
    await fakeFirestore
      .collection("reservasInventario")
      .doc(reservaEntries[0][0])
      .update({ ordenId: "orden_webhook" });

    await inventoryReservationService.confirmOrderReservations(
      "orden_webhook",
      "user_webhook",
    );

    const producto = fakeFirestore.getCollectionData("productos").prod_last as {
      inventarioGlobal: { fisica: number; reservada: number; disponible: number };
    };
    expect(producto.inventarioGlobal).toMatchObject({
      fisica: 0,
      reservada: 0,
      disponible: 0,
    });

    const ventas = Object.values(
      fakeFirestore.getCollectionData("movimientosInventario"),
    ).filter((item) => item.tipo === "venta");
    expect(ventas).toHaveLength(1);
  });

  it("cancelación del ganador libera reserva sin crear pedido", async () => {
    fakeFirestore = createFakeFirestore({
      productos: {
        prod_last: {
          existencias: 1,
          tallaIds: [],
          inventarioPorTalla: [],
          inventarioGlobal: {
            fisica: 1,
            reservada: 0,
            noDisponible: 0,
            entrante: 0,
            disponible: 1,
          },
        },
      },
      reservasInventario: {},
      movimientosInventario: {},
      ordenes: {},
    });

    await inventoryReservationService.reserveForCheckoutAttempt({
      checkoutAttemptId: "attempt_cancel",
      usuarioId: "user_cancel",
      idempotencyPrefix: "checkout-attempt",
      items: [{ productoId: "prod_last", cantidad: 1 }],
    });

    await inventoryReservationService.releaseCheckoutAttemptReservations({
      checkoutAttemptId: "attempt_cancel",
      motivo: "Checkout abandonado",
      usuarioId: "user_cancel",
    });

    const producto = fakeFirestore.getCollectionData("productos").prod_last as {
      inventarioGlobal: { fisica: number; reservada: number; disponible: number };
    };
    expect(producto.inventarioGlobal).toMatchObject({
      fisica: 1,
      reservada: 0,
      disponible: 1,
    });

    const ordenes = fakeFirestore.getCollectionData("ordenes");
    expect(Object.keys(ordenes)).toHaveLength(0);

    const ventas = Object.values(
      fakeFirestore.getCollectionData("movimientosInventario"),
    ).filter((item) => item.tipo === "venta");
    expect(ventas).toHaveLength(0);
  });

  it("solo una reserva concurrente obtiene la última unidad", async () => {
    const results = await Promise.allSettled([
      inventoryReservationService.reserveForOrder({
        ordenId: "orden_a",
        usuarioId: "user_a",
        paymentAttemptId: "pay_a",
        idempotencyPrefix: "pay_a",
      }),
      inventoryReservationService.reserveForOrder({
        ordenId: "orden_b",
        usuarioId: "user_b",
        paymentAttemptId: "pay_b",
        idempotencyPrefix: "pay_b",
      }),
    ]);

    const fulfilled = results.filter((item) => item.status === "fulfilled");
    const rejected = results.filter((item) => item.status === "rejected");

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason.message).toMatch(
      /Stock insuficiente/i,
    );

    const reservas = fakeFirestore.getCollectionData("reservasInventario");
    const activas = Object.values(reservas).filter(
      (item) => item.estado === EstadoReservaInventario.ACTIVA,
    );
    expect(activas).toHaveLength(1);

    const producto = fakeFirestore.getCollectionData("productos").prod_last as {
      inventarioGlobal: { reservada: number; disponible: number };
    };
    expect(producto.inventarioGlobal.reservada).toBe(1);
    expect(producto.inventarioGlobal.disponible).toBe(0);
  });

  it("webhook duplicado no duplica movimiento de venta al confirmar reservas", async () => {
    fakeFirestore = createFakeFirestore({
      ordenes: {
        orden_paid: {
          usuarioId: "user_paid",
          items: [{ productoId: "prod_last", cantidad: 1 }],
        },
      },
      productos: {
        prod_last: {
          existencias: 1,
          tallaIds: [],
          inventarioPorTalla: [],
          inventarioGlobal: {
            fisica: 1,
            reservada: 1,
            noDisponible: 0,
            entrante: 0,
            disponible: 0,
          },
        },
      },
      reservasInventario: {
        reserva_1: {
          ordenId: "orden_paid",
          productoId: "prod_last",
          tallaId: null,
          cantidad: 1,
          estado: EstadoReservaInventario.ACTIVA,
          expiraEn: new Date("2026-06-22T13:00:00.000Z"),
          createdAt: new Date("2026-06-22T12:00:00.000Z"),
        },
      },
      movimientosInventario: {},
    });

    await inventoryReservationService.confirmOrderReservations(
      "orden_paid",
      "user_paid",
    );
    await inventoryReservationService.confirmOrderReservations(
      "orden_paid",
      "user_paid",
    );

    const movimientos = Object.values(
      fakeFirestore.getCollectionData("movimientosInventario"),
    ).filter((item) => item.tipo === "venta");

    expect(movimientos).toHaveLength(1);

    const reserva = fakeFirestore.getCollectionData("reservasInventario")
      .reserva_1;
    expect(reserva.estado).toBe(EstadoReservaInventario.CONFIRMADA);
  });

  it("libera reservas activas sin registrar venta cuando el pago no procede", async () => {
    fakeFirestore = createFakeFirestore({
      ordenes: {
        orden_release: {
          usuarioId: "user_release",
          items: [{ productoId: "prod_last", cantidad: 1 }],
        },
      },
      productos: {
        prod_last: {
          existencias: 4,
          tallaIds: [],
          inventarioPorTalla: [],
          inventarioGlobal: {
            fisica: 5,
            reservada: 1,
            noDisponible: 0,
            entrante: 0,
            disponible: 4,
          },
        },
      },
      reservasInventario: {
        reserva_release: {
          ordenId: "orden_release",
          productoId: "prod_last",
          tallaId: null,
          cantidad: 1,
          estado: EstadoReservaInventario.ACTIVA,
        },
      },
      movimientosInventario: {},
    });

    await inventoryReservationService.releaseOrderReservations({
      ordenId: "orden_release",
      motivo: "Pago fallido o cancelado",
    });

    const producto = fakeFirestore.getCollectionData("productos").prod_last as {
      inventarioGlobal: { fisica: number; reservada: number; disponible: number };
    };
    expect(producto.inventarioGlobal).toMatchObject({
      fisica: 5,
      reservada: 0,
      disponible: 5,
    });

    const ventas = Object.values(
      fakeFirestore.getCollectionData("movimientosInventario"),
    ).filter((item) => item.tipo === "venta");
    expect(ventas).toHaveLength(0);

    const reserva = fakeFirestore.getCollectionData("reservasInventario")
      .reserva_release;
    expect(reserva.estado).toBe(EstadoReservaInventario.LIBERADA);
  });

  it("reserva checkout multi-ítem es atómica: falla si un ítem no tiene stock", async () => {
    fakeFirestore = createFakeFirestore({
      productos: {
        prod_ok: {
          existencias: 5,
          tallaIds: [],
          inventarioPorTalla: [],
          inventarioGlobal: {
            fisica: 5,
            reservada: 0,
            noDisponible: 0,
            entrante: 0,
            disponible: 5,
          },
        },
        prod_fail: {
          existencias: 0,
          tallaIds: [],
          inventarioPorTalla: [],
          inventarioGlobal: {
            fisica: 0,
            reservada: 0,
            noDisponible: 0,
            entrante: 0,
            disponible: 0,
          },
        },
      },
      reservasInventario: {},
      movimientosInventario: {},
    });

    await expect(
      inventoryReservationService.reserveForCheckoutAttempt({
        checkoutAttemptId: "attempt_multi",
        usuarioId: "user_multi",
        idempotencyPrefix: "checkout-attempt",
        items: [
          { productoId: "prod_ok", cantidad: 2 },
          { productoId: "prod_fail", cantidad: 1 },
        ],
      }),
    ).rejects.toBeInstanceOf(InventoryStockUnavailableError);

    const reservas = Object.values(
      fakeFirestore.getCollectionData("reservasInventario"),
    ).filter((item) => item.estado === EstadoReservaInventario.ACTIVA);
    expect(reservas).toHaveLength(0);

    const productoOk = fakeFirestore.getCollectionData("productos")
      .prod_ok as {
      inventarioGlobal: { reservada: number; disponible: number };
    };
    expect(productoOk.inventarioGlobal).toMatchObject({
      reservada: 0,
      disponible: 5,
    });
  });

  it("expira reservas vencidas ligadas a checkoutAttemptId", async () => {
    fakeFirestore = createFakeFirestore({
      productos: {
        prod_checkout: {
          existencias: 3,
          tallaIds: [],
          inventarioPorTalla: [],
          inventarioGlobal: {
            fisica: 3,
            reservada: 1,
            noDisponible: 0,
            entrante: 0,
            disponible: 2,
          },
        },
      },
      reservasInventario: {
        reserva_checkout: {
          checkoutAttemptId: "attempt_expired",
          productoId: "prod_checkout",
          tallaId: null,
          cantidad: 1,
          estado: EstadoReservaInventario.ACTIVA,
          expiraEn: new Date("2026-06-22T11:00:00.000Z"),
        },
      },
      movimientosInventario: {},
    });

    const result = await inventoryReservationService.expireDueReservations(50);

    expect(result).toMatchObject({
      checkoutAttempts: 1,
      orders: 0,
      reservations: 1,
    });

    const producto = fakeFirestore.getCollectionData("productos")
      .prod_checkout as {
      inventarioGlobal: { reservada: number; disponible: number };
    };
    expect(producto.inventarioGlobal).toMatchObject({
      reservada: 0,
      disponible: 3,
    });

    const reserva = fakeFirestore.getCollectionData("reservasInventario")
      .reserva_checkout;
    expect(reserva.estado).toBe(EstadoReservaInventario.EXPIRADA);
  });
});
