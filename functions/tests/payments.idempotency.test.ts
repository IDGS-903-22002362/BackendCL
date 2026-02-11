import { EstadoOrden, MetodoPago } from "../src/models/orden.model";
import { EstadoPago, ProveedorPago } from "../src/models/pago.model";

type QueryFilter = { field: string; op: string; value: unknown };

type DocData = Record<string, any>;

let fakeFirestore: ReturnType<typeof createFakeFirestore>;

const stripeMocks = {
  createPaymentIntent: jest.fn(),
  retrievePaymentIntent: jest.fn(),
  constructWebhookEvent: jest.fn(),
  createRefund: jest.fn(),
};

jest.mock("stripe", () => {
  return {
    __esModule: true,
    default: class StripeMock {
      paymentIntents = {
        create: stripeMocks.createPaymentIntent,
        retrieve: stripeMocks.retrievePaymentIntent,
      };
      refunds = {
        create: stripeMocks.createRefund,
      };
      webhooks = {
        constructEvent: stripeMocks.constructWebhookEvent,
      };
      constructor(_secret: string) {}
    },
  };
});

const arrayUnion = (...values: unknown[]) => ({
  __op: "arrayUnion" as const,
  values,
});

const fieldDelete = () => ({ __op: "delete" as const });

jest.mock("../src/config/firebase.admin", () => ({
  admin: {
    firestore: {
      Timestamp: {
        now: () => new Date("2026-02-11T00:00:00.000Z"),
      },
      FieldValue: {
        arrayUnion,
        delete: fieldDelete,
      },
    },
  },
}));

jest.mock("../src/config/firebase", () => ({
  firestoreTienda: {
    collection: (name: string) => fakeFirestore.collection(name),
    runTransaction: (cb: any) => fakeFirestore.runTransaction(cb),
  },
}));

import pagoService from "../src/services/pago.service";

function createFakeFirestore(initial: Record<string, Record<string, DocData>>) {
  const collections = new Map<string, Map<string, DocData>>();
  Object.entries(initial).forEach(([name, docs]) => {
    collections.set(
      name,
      new Map(
        Object.entries(docs).map(([id, data]) => [id, { ...data } as DocData]),
      ),
    );
  });

  let idCounter = 0;

  const getCollection = (name: string): Map<string, DocData> => {
    if (!collections.has(name)) {
      collections.set(name, new Map());
    }
    return collections.get(name)!;
  };

  const applyFieldValueOps = (current: DocData, patch: DocData): DocData => {
    const next = { ...current };
    Object.entries(patch).forEach(([key, value]) => {
      if (value && typeof value === "object" && (value as any).__op === "arrayUnion") {
        const existing = Array.isArray(next[key]) ? next[key] : [];
        const merged = [...existing];
        (value as any).values.forEach((v: unknown) => {
          if (!merged.includes(v)) {
            merged.push(v);
          }
        });
        next[key] = merged;
        return;
      }

      if (value && typeof value === "object" && (value as any).__op === "delete") {
        delete next[key];
        return;
      }

      next[key] = value;
    });
    return next;
  };

  const docRefFactory = (collectionName: string, id: string) => ({
    id,
    get: async () => {
      const col = getCollection(collectionName);
      const data = col.get(id);
      return {
        exists: !!data,
        id,
        data: () => (data ? { ...data } : undefined),
        ref: docRefFactory(collectionName, id),
      };
    },
    update: async (patch: DocData) => {
      const col = getCollection(collectionName);
      const existing = col.get(id);
      if (!existing) {
        throw new Error(`Doc ${collectionName}/${id} not found`);
      }
      col.set(id, applyFieldValueOps(existing, patch));
    },
    set: async (data: DocData, opts?: { merge?: boolean }) => {
      const col = getCollection(collectionName);
      const existing = col.get(id);
      if (opts?.merge && existing) {
        col.set(id, applyFieldValueOps(existing, data));
        return;
      }
      col.set(id, { ...data });
    },
    create: async (data: DocData) => {
      const col = getCollection(collectionName);
      if (col.has(id)) {
        const err = new Error("already exists") as Error & { code?: string };
        err.code = "already-exists";
        throw err;
      }
      col.set(id, { ...data });
    },
  });

  const queryFactory = (
    collectionName: string,
    filters: QueryFilter[] = [],
    orderByField?: string,
    orderByDirection: "asc" | "desc" = "asc",
    limitCount?: number,
  ) => ({
    where: (field: string, op: string, value: unknown) =>
      queryFactory(
        collectionName,
        [...filters, { field, op, value }],
        orderByField,
        orderByDirection,
        limitCount,
      ),
    orderBy: (field: string, direction: "asc" | "desc" = "asc") =>
      queryFactory(collectionName, filters, field, direction, limitCount),
    limit: (count: number) =>
      queryFactory(collectionName, filters, orderByField, orderByDirection, count),
    get: async () => {
      const col = getCollection(collectionName);
      let docs = [...col.entries()].map(([id, data]) => ({ id, data }));

      docs = docs.filter((entry) =>
        filters.every((filter) => {
          const left = entry.data[filter.field];
          if (filter.op === "==") {
            return left === filter.value;
          }
          if (filter.op === "in") {
            return Array.isArray(filter.value) && filter.value.includes(left);
          }
          return false;
        }),
      );

      if (orderByField) {
        docs.sort((a, b) => {
          const av = a.data[orderByField];
          const bv = b.data[orderByField];
          if (av === bv) return 0;
          if (orderByDirection === "desc") {
            return av > bv ? -1 : 1;
          }
          return av > bv ? 1 : -1;
        });
      }

      if (typeof limitCount === "number") {
        docs = docs.slice(0, limitCount);
      }

      return {
        empty: docs.length === 0,
        size: docs.length,
        docs: docs.map((entry) => ({
          id: entry.id,
          data: () => ({ ...entry.data }),
          ref: docRefFactory(collectionName, entry.id),
        })),
      };
    },
  });

  return {
    collection: (name: string) => ({
      doc: (id: string) => docRefFactory(name, id),
      add: async (data: DocData) => {
        const id = `doc_${++idCounter}`;
        const col = getCollection(name);
        col.set(id, { ...data });
        return docRefFactory(name, id);
      },
      where: (field: string, op: string, value: unknown) =>
        queryFactory(name, [{ field, op, value }]),
    }),
    runTransaction: async (cb: (tx: any) => Promise<void>) => {
      const tx = {
        get: async (docRef: any) => docRef.get(),
        update: async (docRef: any, data: DocData) => docRef.update(data),
      };
      await cb(tx);
    },
    getDoc: (collectionName: string, id: string) => {
      const col = getCollection(collectionName);
      return col.get(id);
    },
    countDocs: (collectionName: string) => {
      return getCollection(collectionName).size;
    },
  };
}

describe("TASK-063 idempotency and dedupe", () => {
  beforeEach(() => {
    process.env.STRIPE_SECRET_KEY = "sk_test_123";
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_123";

    stripeMocks.createPaymentIntent.mockReset();
    stripeMocks.retrievePaymentIntent.mockReset();
    stripeMocks.constructWebhookEvent.mockReset();
    stripeMocks.createRefund.mockReset();
  });

  it("reuses active payment on two consecutive iniciar calls without header key", async () => {
    fakeFirestore = createFakeFirestore({
      ordenes: {
        orden_1: {
          usuarioId: "user_1",
          estado: EstadoOrden.PENDIENTE,
          metodoPago: MetodoPago.TARJETA,
          total: 1200,
        },
      },
      pagos: {},
    });

    stripeMocks.createPaymentIntent.mockResolvedValue({
      id: "pi_1",
      client_secret: "secret_1",
      status: "requires_payment_method",
    });
    stripeMocks.retrievePaymentIntent.mockResolvedValue({
      id: "pi_1",
      client_secret: "secret_1",
      status: "requires_action",
    });

    const first = await pagoService.iniciarPago({
      ordenId: "orden_1",
      userId: "user_1",
      metodoPago: MetodoPago.TARJETA,
      idempotencyKey: undefined,
    });

    const second = await pagoService.iniciarPago({
      ordenId: "orden_1",
      userId: "user_1",
      metodoPago: MetodoPago.TARJETA,
      idempotencyKey: undefined,
    });

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(stripeMocks.createPaymentIntent).toHaveBeenCalledTimes(1);
    expect(stripeMocks.retrievePaymentIntent).toHaveBeenCalledTimes(1);
    expect(fakeFirestore.countDocs("pagos")).toBe(1);
  });

  it("deduplicates webhook retry by event.id and does not duplicate state changes", async () => {
    fakeFirestore = createFakeFirestore({
      pagos: {
        pago_1: {
          ordenId: "orden_1",
          userId: "user_1",
          provider: ProveedorPago.STRIPE,
          metodoPago: MetodoPago.TARJETA,
          monto: 1200,
          currency: "mxn",
          estado: EstadoPago.PENDIENTE,
          idempotencyKey: "pay_orden_1_user_1_1",
          paymentIntentId: "pi_1",
          createdAt: new Date("2026-02-10T10:00:00.000Z"),
          updatedAt: new Date("2026-02-10T10:00:00.000Z"),
        },
      },
      ordenes: {
        orden_1: {
          usuarioId: "user_1",
          estado: EstadoOrden.PENDIENTE,
          total: 1200,
        },
      },
      stripe_webhook_events: {},
    });

    stripeMocks.constructWebhookEvent.mockReturnValue({
      id: "evt_1",
      type: "payment_intent.succeeded",
      livemode: false,
      data: {
        object: {
          id: "pi_1",
          status: "succeeded",
          metadata: {},
        },
      },
    });

    const first = await pagoService.procesarWebhookStripe(
      Buffer.from("{}"),
      "sig_1",
    );
    const second = await pagoService.procesarWebhookStripe(
      Buffer.from("{}"),
      "sig_1",
    );

    expect(first.outcome).toBe("processed");
    expect(second.outcome).toBe("duplicate");

    const pago = fakeFirestore.getDoc("pagos", "pago_1");
    const orden = fakeFirestore.getDoc("ordenes", "orden_1");
    expect(pago).toBeDefined();
    expect(orden).toBeDefined();
    expect(pago!.estado).toBe(EstadoPago.COMPLETADO);
    expect(orden!.estado).toBe(EstadoOrden.CONFIRMADA);
    expect(pago!.webhookEventIdsProcesados).toEqual(["evt_1"]);
  });
});
