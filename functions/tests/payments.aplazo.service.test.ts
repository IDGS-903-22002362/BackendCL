import { Timestamp } from "firebase-admin/firestore";
import { MetodoPago, EstadoOrden } from "../src/models/orden.model";
import {
  PaymentFlowType,
  PaymentStatus,
  ProveedorPago,
} from "../src/models/pago.model";
import { RolUsuario } from "../src/models/usuario.model";

type QueryFilter = { field: string; op: string; value: unknown };
type DocData = Record<string, any>;

let fakeFirestore = createFakeFirestore({});

const arrayUnion = (...values: unknown[]) => ({
  __op: "arrayUnion" as const,
  values,
});
const fieldDelete = () => ({ __op: "delete" as const });
const increment = (value: number) => ({ __op: "increment" as const, value });

const aplazoProviderMocks = {
  createOnline: jest.fn(),
  parseWebhook: jest.fn(),
  getStatus: jest.fn(),
  cancelOrVoid: jest.fn(),
  refund: jest.fn(),
  getRefundStatus: jest.fn(),
  mapProviderStatus: jest.fn(),
};

jest.mock("../src/config/firebase", () => ({
  firestoreTienda: {
    collection: (name: string) => fakeFirestore.collection(name),
    runTransaction: (cb: any) => fakeFirestore.runTransaction(cb),
  },
}));

jest.mock("../src/config/firebase.admin", () => {
  const { Timestamp: FirestoreTimestamp } = jest.requireActual(
    "firebase-admin/firestore",
  );

  return {
    admin: {
      firestore: {
        Timestamp: FirestoreTimestamp,
        FieldValue: {
          arrayUnion,
          delete: fieldDelete,
          increment,
        },
      },
    },
  };
});

jest.mock("../src/services/product.service", () => ({
  __esModule: true,
  default: {
    getProductById: jest.fn(),
    getStockBySize: jest.fn(),
    updateStock: jest.fn(),
  },
}));

jest.mock("../src/services/payments/providers/aplazo.provider", () => ({
  __esModule: true,
  default: aplazoProviderMocks,
}));

import { PaymentAttemptRepository } from "../src/services/payments/payment-attempt.repository";
import { PaymentEventLogRepository } from "../src/services/payments/payment-event-log.repository";
import { PaymentsService } from "../src/services/payments/payments.service";
import { PaymentEventProcessingService } from "../src/services/payments/payment-event-processing.service";
import paymentFinalizerService, {
  PaymentFinalizerService,
} from "../src/services/payments/payment-finalizer.service";
import paymentReconciliationService, {
  PaymentReconciliationService,
} from "../src/services/payments/payment-reconciliation.service";
import { PaymentRefundRepository } from "../src/services/payments/payment-refund.repository";
import { PaymentRefundRequestRepository } from "../src/services/payments/payment-refund-request.repository";
import productService from "../src/services/product.service";

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
      if (value === undefined) {
        return;
      }

      if (
        value &&
        typeof value === "object" &&
        (value as any).__op === "arrayUnion"
      ) {
        const existing = Array.isArray(next[key]) ? next[key] : [];
        const merged = [...existing];
        (value as any).values.forEach((entry: unknown) => {
          if (!merged.includes(entry)) {
            merged.push(entry);
          }
        });
        next[key] = merged;
        return;
      }

      if (
        value &&
        typeof value === "object" &&
        (value as any).__op === "delete"
      ) {
        delete next[key];
        return;
      }

      if (
        value &&
        typeof value === "object" &&
        (value as any).__op === "increment"
      ) {
        next[key] = Number(next[key] || 0) + Number((value as any).value || 0);
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
    set: async (data: DocData, opts?: { merge?: boolean }) => {
      const col = getCollection(collectionName);
      const existing = col.get(id);
      if (opts?.merge && existing) {
        col.set(id, applyFieldValueOps(existing, data));
        return;
      }
      col.set(id, { ...data });
    },
    update: async (patch: DocData) => {
      const col = getCollection(collectionName);
      const existing = col.get(id);
      if (!existing) {
        throw new Error(`Doc ${collectionName}/${id} not found`);
      }
      col.set(id, applyFieldValueOps(existing, patch));
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
      queryFactory(
        collectionName,
        filters,
        orderByField,
        orderByDirection,
        count,
      ),
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
      const staged: Array<{
        kind: "set" | "update" | "create";
        docRef: any;
        data: DocData;
        opts?: { merge?: boolean };
      }> = [];
      const tx = {
        get: async (docRef: any) => docRef.get(),
        set: (docRef: any, data: DocData, opts?: { merge?: boolean }) => {
          staged.push({ kind: "set", docRef, data, opts });
        },
        update: (docRef: any, data: DocData) => {
          staged.push({ kind: "update", docRef, data });
        },
        create: (docRef: any, data: DocData) => {
          staged.push({ kind: "create", docRef, data });
        },
      };

      await cb(tx);

      for (const operation of staged) {
        if (operation.kind === "set") {
          await operation.docRef.set(operation.data, operation.opts);
        }
        if (operation.kind === "update") {
          await operation.docRef.update(operation.data);
        }
        if (operation.kind === "create") {
          await operation.docRef.create(operation.data);
        }
      }
    },
    getDoc: (collectionName: string, id: string) => {
      return getCollection(collectionName).get(id);
    },
    getCollectionDocs: (collectionName: string) => {
      return [...getCollection(collectionName).values()];
    },
    countDocs: (collectionName: string) => getCollection(collectionName).size,
  };
}

const DEFAULT_INVENTORY_SEED: Record<string, Record<string, DocData>> = {
  productos: {
    prod_1: {
      existencias: 50,
      tallaIds: [],
    },
  },
  reservasInventario: {},
  movimientosInventario: {},
};

function seedFirestore(
  initial: Record<string, Record<string, DocData>> = {},
): ReturnType<typeof createFakeFirestore> {
  const merged: Record<string, Record<string, DocData>> = {
    ...DEFAULT_INVENTORY_SEED,
  };

  for (const [collectionName, docs] of Object.entries(initial)) {
    merged[collectionName] = {
      ...(DEFAULT_INVENTORY_SEED[collectionName] || {}),
      ...docs,
    };
  }

  return createFakeFirestore(merged);
}

describe("Aplazo payments service", () => {
  const buildReconciliationService = () => {
    const paymentRepo = new PaymentAttemptRepository();
    const eventRepo = new PaymentEventLogRepository();
    const finalizer = new PaymentFinalizerService(paymentRepo);
    const processor = new PaymentEventProcessingService(
      eventRepo,
      paymentRepo,
      finalizer,
    );
    return new PaymentReconciliationService(
      paymentRepo,
      eventRepo,
      finalizer,
      processor,
    );
  };

  const buildPaymentsService = () => {
    const paymentRepo = new PaymentAttemptRepository();
    const eventRepo = new PaymentEventLogRepository();
    const finalizer = new PaymentFinalizerService(paymentRepo);
    const reconciliation = new PaymentReconciliationService(
      paymentRepo,
      eventRepo,
      finalizer,
      new PaymentEventProcessingService(
        eventRepo,
        paymentRepo,
        finalizer,
      ),
    );
    return new PaymentsService(
      paymentRepo,
      eventRepo,
      finalizer,
      reconciliation,
      new PaymentRefundRepository(),
      new PaymentRefundRequestRepository(),
    );
  };

  beforeEach(() => {
    fakeFirestore = seedFirestore({
      ordenes: {},
      pagos: {},
      usuariosApp: {},
      posSessions: {},
      ventasPos: {},
      paymentEventLogs: {},
    });

    process.env.APP_URL = "http://localhost:3000";
    process.env.BACKEND_PUBLIC_URL = "http://localhost:3000";
    process.env.APLAZO_ENABLED = "true";
    process.env.APLAZO_ONLINE_ENABLED = "true";
    process.env.APLAZO_RECONCILE_ENABLED = "true";
    process.env.APLAZO_REFUNDS_ENABLED = "false";
    process.env.APLAZO_ONLINE_SUCCESS_URL = "https://app.test/success";
    process.env.APLAZO_ONLINE_CANCEL_URL = "https://app.test/cancel";
    process.env.APLAZO_ONLINE_FAILURE_URL = "https://app.test/failure";

    Object.values(aplazoProviderMocks).forEach((mock) => mock.mockReset());
    (productService.getProductById as jest.Mock).mockReset();
    (productService.getStockBySize as jest.Mock).mockReset();
    (productService.updateStock as jest.Mock).mockReset();
  });

  it("cancels expired Aplazo attempts in provider before closing them locally", async () => {
    const expiredAt = Timestamp.fromDate(new Date(Date.now() - 60_000));
    fakeFirestore = seedFirestore({
      ordenes: {
        orden_expired_cancel: {
          usuarioId: "user_1",
          estado: EstadoOrden.PENDIENTE,
          items: [],
          total: 1000,
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now(),
        },
      },
      pagos: {
        pago_expired_cancel: {
          ordenId: "orden_expired_cancel",
          userId: "user_1",
          provider: ProveedorPago.APLAZO,
          metodoPago: MetodoPago.APLAZO,
          flowType: PaymentFlowType.ONLINE,
          monto: 1000,
          amountMinor: 100000,
          currency: "mxn",
          estado: "PENDIENTE",
          status: PaymentStatus.PENDING_CUSTOMER,
          idempotencyKey: "idem_expired_cancel",
          providerReference: "cart_expired_cancel",
          expiresAt: expiredAt,
          createdAt: Timestamp.fromDate(new Date(Date.now() - 120_000)),
          updatedAt: Timestamp.now(),
          metadata: {},
        },
      },
      usuariosApp: {},
      posSessions: {},
      ventasPos: {},
      paymentEventLogs: {},
    });

    aplazoProviderMocks.getStatus.mockResolvedValue({
      status: PaymentStatus.PENDING_CUSTOMER,
      providerStatus: "No confirmado",
      providerReference: "cart_expired_cancel",
    });
    aplazoProviderMocks.cancelOrVoid.mockResolvedValue({
      status: PaymentStatus.CANCELED,
      providerStatus: "cancelado",
      providerReference: "cart_expired_cancel",
      rawResponseSanitized: { status: "cancelado" },
    });

    await buildReconciliationService().runScheduledReconciliation();

    expect(aplazoProviderMocks.cancelOrVoid).toHaveBeenCalledWith({
      paymentAttempt: expect.objectContaining({
        id: "pago_expired_cancel",
        providerReference: "cart_expired_cancel",
      }),
      reason: "expired_by_timeout",
    });
    expect(fakeFirestore.getDoc("pagos", "pago_expired_cancel")).toMatchObject({
      status: PaymentStatus.CANCELED,
      cancelReason: "expired_by_timeout",
      canceledBy: "scheduler",
      providerStatus: "cancelado",
      metadata: expect.objectContaining({
        cancelReason: "expired_by_timeout",
        canceledBy: "scheduler",
        providerCancelResponse: { status: "cancelado" },
      }),
    });
    expect(fakeFirestore.getDoc("pagos", "pago_expired_cancel")?.canceledAt)
      .toBeDefined();
    expect(fakeFirestore.getDoc("ordenes", "orden_expired_cancel")).toMatchObject({
      estado: EstadoOrden.CANCELADA,
    });
  });

  it("does not cancel an expired attempt when Aplazo already reports it as active", async () => {
    fakeFirestore = seedFirestore({
      ordenes: {
        orden_expired_paid: {
          usuarioId: "user_1",
          estado: EstadoOrden.PENDIENTE,
          items: [],
          total: 1000,
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now(),
        },
      },
      pagos: {
        pago_expired_paid: {
          ordenId: "orden_expired_paid",
          userId: "user_1",
          provider: ProveedorPago.APLAZO,
          metodoPago: MetodoPago.APLAZO,
          flowType: PaymentFlowType.ONLINE,
          monto: 1000,
          amountMinor: 100000,
          currency: "mxn",
          estado: "PENDIENTE",
          status: PaymentStatus.PENDING_CUSTOMER,
          idempotencyKey: "idem_expired_paid",
          providerReference: "cart_expired_paid",
          expiresAt: Timestamp.fromDate(new Date(Date.now() - 60_000)),
          createdAt: Timestamp.fromDate(new Date(Date.now() - 120_000)),
          updatedAt: Timestamp.now(),
          metadata: {},
        },
      },
      usuariosApp: {},
      posSessions: {},
      ventasPos: {},
      paymentEventLogs: {},
    });

    aplazoProviderMocks.getStatus.mockResolvedValue({
      status: PaymentStatus.PAID,
      providerStatus: "Activo",
      providerReference: "cart_expired_paid",
    });

    await buildReconciliationService().runScheduledReconciliation();

    expect(aplazoProviderMocks.cancelOrVoid).not.toHaveBeenCalled();
    expect(fakeFirestore.getDoc("pagos", "pago_expired_paid")).toMatchObject({
      status: PaymentStatus.PAID,
      providerStatus: "Activo",
    });
    expect(fakeFirestore.getDoc("ordenes", "orden_expired_paid")).toMatchObject({
      estado: EstadoOrden.CONFIRMADA,
    });
  });

  it("blocks manual Aplazo cancellation when provider reports the payment as paid", async () => {
    fakeFirestore = seedFirestore({
      ordenes: {
        orden_manual_paid: {
          usuarioId: "user_1",
          estado: EstadoOrden.PENDIENTE,
          items: [],
          total: 1000,
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now(),
        },
      },
      pagos: {
        pago_manual_paid: {
          ordenId: "orden_manual_paid",
          userId: "user_1",
          provider: ProveedorPago.APLAZO,
          metodoPago: MetodoPago.APLAZO,
          flowType: PaymentFlowType.ONLINE,
          monto: 1000,
          amountMinor: 100000,
          currency: "mxn",
          estado: "PENDIENTE",
          status: PaymentStatus.PENDING_CUSTOMER,
          idempotencyKey: "idem_manual_paid",
          providerReference: "cart_manual_paid",
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now(),
        },
      },
      usuariosApp: {},
      posSessions: {},
      ventasPos: {},
      paymentEventLogs: {},
    });

    aplazoProviderMocks.getStatus.mockResolvedValue({
      status: PaymentStatus.PAID,
      providerStatus: "Activo",
      providerReference: "cart_manual_paid",
    });

    const service = buildPaymentsService();

    await expect(
      service.cancelAplazoPaymentAttempt(
        "pago_manual_paid",
        { uid: "admin_1", rol: RolUsuario.ADMIN },
        "manual cancel",
      ),
    ).rejects.toMatchObject({
      code: "PAYMENT_CANCEL_NOT_ALLOWED",
      message:
        "El pago Aplazo ya está ACTIVO/pagado; usa el flujo de refund para devolverlo",
    });
    expect(aplazoProviderMocks.cancelOrVoid).not.toHaveBeenCalled();
    expect(fakeFirestore.getDoc("pagos", "pago_manual_paid")).toMatchObject({
      status: PaymentStatus.PAID,
      providerStatus: "Activo",
    });
  });

  it("returns canceled Aplazo attempts idempotently without calling provider cancel again", async () => {
    fakeFirestore = seedFirestore({
      ordenes: {},
      pagos: {
        pago_manual_canceled: {
          userId: "user_1",
          provider: ProveedorPago.APLAZO,
          metodoPago: MetodoPago.APLAZO,
          flowType: PaymentFlowType.ONLINE,
          monto: 1000,
          amountMinor: 100000,
          currency: "mxn",
          estado: "FALLIDO",
          status: PaymentStatus.CANCELED,
          idempotencyKey: "idem_manual_canceled",
          providerReference: "cart_manual_canceled",
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now(),
        },
      },
      usuariosApp: {},
      posSessions: {},
      ventasPos: {},
      paymentEventLogs: {},
    });

    const service = buildPaymentsService();
    const result = await service.cancelAplazoPaymentAttempt(
      "pago_manual_canceled",
      { uid: "admin_1", rol: RolUsuario.ADMIN },
      "retry cancel",
    );

    expect(result.status).toBe(PaymentStatus.CANCELED);
    expect(aplazoProviderMocks.getStatus).not.toHaveBeenCalled();
    expect(aplazoProviderMocks.cancelOrVoid).not.toHaveBeenCalled();
  });

  const seedAplazoRefundAttempt = (
    overrides: Record<string, unknown> = {},
    orderOverrides: Record<string, unknown> = {},
  ) => {
    fakeFirestore = seedFirestore({
      ordenes: {
        orden_refund: {
          usuarioId: "user_1",
          estado: EstadoOrden.CONFIRMADA,
          items: [],
          total: 1000,
          subtotal: 1000,
          impuestos: 0,
          metodoPago: MetodoPago.APLAZO,
          paymentMetadata: {},
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now(),
          ...orderOverrides,
        },
      },
      pagos: {
        pago_refund: {
          ordenId: "orden_refund",
          userId: "user_1",
          provider: ProveedorPago.APLAZO,
          metodoPago: MetodoPago.APLAZO,
          flowType: PaymentFlowType.ONLINE,
          monto: 1000,
          amountMinor: 100000,
          currency: "mxn",
          estado: "COMPLETADO",
          status: PaymentStatus.PAID,
          idempotencyKey: "idem_refund",
          providerReference: "cart_refund",
          providerStatus: "Activo",
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now(),
          metadata: {},
          ...overrides,
        },
      },
      usuariosApp: {},
      posSessions: {},
      ventasPos: {},
      paymentEventLogs: {},
      paymentRefunds: {},
      paymentRefundRequests: {},
    });
  };

  const mockAplazoPaidStatus = () => {
    aplazoProviderMocks.getStatus.mockResolvedValue({
      status: PaymentStatus.PAID,
      providerStatus: "Activo",
      providerReference: "cart_refund",
    });
  };

  const mockAplazoRefundSuccess = (refundId = "665") => {
    aplazoProviderMocks.refund.mockResolvedValue({
      refundState: "processing",
      providerStatus: "REQUESTED",
      refundId,
      refundAmountMinor: 10000,
      rawResponseSanitized: {
        refundId,
        refundStatus: "REQUESTED",
      },
    });
  };

  it.each([
    [PaymentStatus.PENDING_CUSTOMER, "PAYMENT_NOT_PAID_USE_CANCEL"],
    [PaymentStatus.CANCELED, "PAYMENT_NOT_PAID_USE_CANCEL"],
    [PaymentStatus.EXPIRED, "PAYMENT_NOT_PAID_USE_CANCEL"],
    [PaymentStatus.REFUNDED, "PAYMENT_ALREADY_REFUNDED"],
  ])(
    "blocks Aplazo refund when local payment status is %s",
    async (status, expectedCode) => {
      process.env.APLAZO_REFUNDS_ENABLED = "true";
      seedAplazoRefundAttempt({
        status,
        estado:
          status === PaymentStatus.REFUNDED ? "REEMBOLSADO" : "PENDIENTE",
      });
      const service = buildPaymentsService();

      await expect(
        service.refundAplazoPaymentAttempt(
          "pago_refund",
          { uid: "admin_1", rol: RolUsuario.ADMIN },
          { refundAmountMinor: 10000, reason: "Wrong size" },
        ),
      ).rejects.toMatchObject({
        code: expectedCode,
      });
      expect(aplazoProviderMocks.getStatus).not.toHaveBeenCalled();
      expect(aplazoProviderMocks.refund).not.toHaveBeenCalled();
    },
  );

  it("allows partial Aplazo refund when local and provider status are paid", async () => {
    process.env.APLAZO_REFUNDS_ENABLED = "true";
    seedAplazoRefundAttempt();
    mockAplazoPaidStatus();
    mockAplazoRefundSuccess("665");
    const service = buildPaymentsService();

    const result = await service.refundAplazoPaymentAttempt(
      "pago_refund",
      { uid: "admin_1", rol: RolUsuario.ADMIN },
      { refundAmountMinor: 10000, reason: "Wrong size" },
    );

    expect(aplazoProviderMocks.refund).toHaveBeenCalledWith({
      paymentAttempt: expect.objectContaining({
        id: "pago_refund",
        providerReference: "cart_refund",
      }),
      refundAmountMinor: 10000,
      reason: "Wrong size",
    });
    expect(result.status).toBe(PaymentStatus.PARTIALLY_REFUNDED);
    expect(result.refundTotalMinor).toBe(10000);
    expect(result.refundRemainingMinor).toBe(90000);
    expect(result.refundsCount).toBe(1);
    expect(fakeFirestore.getDoc("ordenes", "orden_refund")).toMatchObject({
      paymentMetadata: expect.objectContaining({
        paymentStatus: PaymentStatus.PARTIALLY_REFUNDED,
        lastRefundAmountMinor: 10000,
        lastRefundId: "665",
      }),
    });
    expect([...Array(fakeFirestore.countDocs("paymentRefunds")).keys()].length).toBe(1);
  });

  it("rejects Aplazo refund when provider reports NO CONFIRMADO", async () => {
    process.env.APLAZO_REFUNDS_ENABLED = "true";
    seedAplazoRefundAttempt();
    aplazoProviderMocks.getStatus.mockResolvedValue({
      status: PaymentStatus.PENDING_CUSTOMER,
      providerStatus: "No confirmado",
    });
    const service = buildPaymentsService();

    await expect(
      service.refundAplazoPaymentAttempt(
        "pago_refund",
        { uid: "admin_1", rol: RolUsuario.ADMIN },
        { refundAmountMinor: 10000, reason: "Wrong size" },
      ),
    ).rejects.toMatchObject({
      code: "PAYMENT_NOT_PAID_USE_CANCEL",
    });
    expect(aplazoProviderMocks.refund).not.toHaveBeenCalled();
  });

  it("rejects invalid Aplazo refund amount", async () => {
    process.env.APLAZO_REFUNDS_ENABLED = "true";
    seedAplazoRefundAttempt();
    mockAplazoPaidStatus();
    const service = buildPaymentsService();

    await expect(
      service.refundAplazoPaymentAttempt(
        "pago_refund",
        { uid: "admin_1", rol: RolUsuario.ADMIN },
        { refundAmountMinor: 0, reason: "Wrong size" },
      ),
    ).rejects.toMatchObject({
      code: "REFUND_AMOUNT_INVALID",
    });
    expect(aplazoProviderMocks.refund).not.toHaveBeenCalled();
  });

  it("rejects Aplazo refund amount greater than remaining balance", async () => {
    process.env.APLAZO_REFUNDS_ENABLED = "true";
    seedAplazoRefundAttempt({
      refundTotalMinor: 95000,
      refundAmount: 950,
    });
    mockAplazoPaidStatus();
    const service = buildPaymentsService();

    await expect(
      service.refundAplazoPaymentAttempt(
        "pago_refund",
        { uid: "admin_1", rol: RolUsuario.ADMIN },
        { refundAmountMinor: 6000, reason: "Wrong size" },
      ),
    ).rejects.toMatchObject({
      code: "REFUND_AMOUNT_EXCEEDS_AVAILABLE",
    });
    expect(aplazoProviderMocks.refund).not.toHaveBeenCalled();
  });

  it("marks Aplazo payment as refunded when refund completes remaining balance", async () => {
    process.env.APLAZO_REFUNDS_ENABLED = "true";
    seedAplazoRefundAttempt({
      refundTotalMinor: 90000,
      refundRemainingMinor: 10000,
      refundAmount: 900,
      refundsCount: 2,
    });
    mockAplazoPaidStatus();
    mockAplazoRefundSuccess("666");
    const service = buildPaymentsService();

    const result = await service.refundAplazoPaymentAttempt(
      "pago_refund",
      { uid: "admin_1", rol: RolUsuario.ADMIN },
      { reason: "Remaining refund" },
    );

    expect(aplazoProviderMocks.refund).toHaveBeenCalledWith(
      expect.objectContaining({
        refundAmountMinor: 10000,
      }),
    );
    expect(result.status).toBe(PaymentStatus.REFUNDED);
    expect(result.refundTotalMinor).toBe(100000);
    expect(result.refundRemainingMinor).toBe(0);
    expect(result.refundsCount).toBe(3);
    expect(fakeFirestore.getDoc("ordenes", "orden_refund")).toMatchObject({
      paymentMetadata: expect.objectContaining({
        paymentStatus: PaymentStatus.REFUNDED,
      }),
    });
  });

  it("prevents double Aplazo refund while a refund is processing", async () => {
    process.env.APLAZO_REFUNDS_ENABLED = "true";
    seedAplazoRefundAttempt({
      currentRefundOperationId: "existing_refund_operation",
    });
    mockAplazoPaidStatus();
    const service = buildPaymentsService();

    await expect(
      service.refundAplazoPaymentAttempt(
        "pago_refund",
        { uid: "admin_1", rol: RolUsuario.ADMIN },
        { refundAmountMinor: 10000, reason: "Wrong size" },
      ),
    ).rejects.toMatchObject({
      code: "REFUND_ALREADY_PROCESSING",
    });
    expect(aplazoProviderMocks.refund).not.toHaveBeenCalled();
  });

  it("marks refund operation failed when Aplazo refund fails without changing payment or order refund status", async () => {
    process.env.APLAZO_REFUNDS_ENABLED = "true";
    seedAplazoRefundAttempt();
    mockAplazoPaidStatus();
    aplazoProviderMocks.refund.mockRejectedValue(
      Object.assign(new Error("Aplazo refund failed"), {
        statusCode: 502,
        code: "PAYMENT_PROVIDER_ERROR",
      }),
    );
    const service = buildPaymentsService();

    await expect(
      service.refundAplazoPaymentAttempt(
        "pago_refund",
        { uid: "admin_1", rol: RolUsuario.ADMIN },
        { refundAmountMinor: 10000, reason: "Wrong size" },
      ),
    ).rejects.toMatchObject({
      code: "APLAZO_REFUND_FAILED",
    });

    expect(fakeFirestore.getDoc("pagos", "pago_refund")).toMatchObject({
      status: PaymentStatus.PAID,
      refundState: "failed",
      currentRefundOperationId: null,
    });
    expect(fakeFirestore.getDoc("ordenes", "orden_refund")).toMatchObject({
      paymentMetadata: {},
    });
    const refundRecords = fakeFirestore.getCollectionDocs("paymentRefunds");
    expect(refundRecords).toHaveLength(1);
    expect(refundRecords[0]).toMatchObject({
      status: "failed",
      failedReason: "Aplazo refund failed",
    });
  });

  it("creates a pending Aplazo refund request by orderId", async () => {
    seedAplazoRefundAttempt();
    const service = buildPaymentsService();

    const request = await service.createAplazoRefundRequest(
      { uid: "user_1", rol: RolUsuario.CLIENTE },
      {
        orderId: "orden_refund",
        reason: "No era la talla correcta",
      },
    );

    expect(request).toMatchObject({
      provider: "aplazo",
      orderId: "orden_refund",
      paymentAttemptId: "pago_refund",
      userId: "user_1",
      reason: "No era la talla correcta",
      status: "pending",
    });
    expect(fakeFirestore.getCollectionDocs("paymentRefundRequests")).toHaveLength(1);
  });

  it("blocks customer Aplazo refund requests for another user's order", async () => {
    seedAplazoRefundAttempt();
    const service = buildPaymentsService();

    await expect(
      service.createAplazoRefundRequest(
        { uid: "user_2", rol: RolUsuario.CLIENTE },
        {
          orderId: "orden_refund",
          reason: "No era la talla correcta",
        },
      ),
    ).rejects.toMatchObject({
      code: "PAYMENT_FORBIDDEN",
    });
    expect(fakeFirestore.getCollectionDocs("paymentRefundRequests")).toHaveLength(0);
  });

  it("rejects duplicate open Aplazo refund requests for the same payment", async () => {
    seedAplazoRefundAttempt();
    const service = buildPaymentsService();

    await service.createAplazoRefundRequest(
      { uid: "user_1", rol: RolUsuario.CLIENTE },
      {
        orderId: "orden_refund",
        reason: "Primer motivo",
      },
    );

    await expect(
      service.createAplazoRefundRequest(
        { uid: "user_1", rol: RolUsuario.CLIENTE },
        {
          orderId: "orden_refund",
          reason: "Segundo motivo",
        },
      ),
    ).rejects.toMatchObject({
      code: "REFUND_REQUEST_ALREADY_OPEN",
    });
    expect(fakeFirestore.getCollectionDocs("paymentRefundRequests")).toHaveLength(1);
  });

  it("lists pending Aplazo refund requests for admin", async () => {
    seedAplazoRefundAttempt();
    const service = buildPaymentsService();
    await service.createAplazoRefundRequest(
      { uid: "user_1", rol: RolUsuario.CLIENTE },
      {
        orderId: "orden_refund",
        reason: "No era la talla correcta",
      },
    );

    const requests = await service.listAplazoRefundRequestsForAdmin(
      { uid: "admin_1", rol: RolUsuario.ADMIN },
      { status: "pending" },
    );

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      status: "pending",
      orderId: "orden_refund",
    });
  });

  it("rejects an Aplazo refund request without calling Aplazo", async () => {
    seedAplazoRefundAttempt();
    const service = buildPaymentsService();
    const request = await service.createAplazoRefundRequest(
      { uid: "user_1", rol: RolUsuario.CLIENTE },
      {
        orderId: "orden_refund",
        reason: "No era la talla correcta",
      },
    );

    const rejected = await service.rejectAplazoRefundRequest(
      request.id!,
      { uid: "admin_1", rol: RolUsuario.ADMIN },
      { reason: "Fuera de política" },
    );

    expect(rejected).toMatchObject({
      status: "rejected",
      rejectionReason: "Fuera de política",
      rejectedBy: "admin_1",
    });
    expect(aplazoProviderMocks.getStatus).not.toHaveBeenCalled();
    expect(aplazoProviderMocks.refund).not.toHaveBeenCalled();
  });

  it("approves an Aplazo refund request and processes the provider refund", async () => {
    process.env.APLAZO_REFUNDS_ENABLED = "true";
    seedAplazoRefundAttempt();
    mockAplazoPaidStatus();
    mockAplazoRefundSuccess("777");
    const service = buildPaymentsService();
    const request = await service.createAplazoRefundRequest(
      { uid: "user_1", rol: RolUsuario.CLIENTE },
      {
        orderId: "orden_refund",
        reason: "No era la talla correcta",
      },
    );

    const processed = await service.approveAplazoRefundRequest(
      request.id!,
      { uid: "admin_1", rol: RolUsuario.ADMIN },
      {
        refundAmountMinor: 10000,
        reason: "Aprobado por soporte",
      },
    );

    expect(aplazoProviderMocks.refund).toHaveBeenCalledWith({
      paymentAttempt: expect.objectContaining({
        id: "pago_refund",
        providerReference: "cart_refund",
      }),
      refundAmountMinor: 10000,
      reason: "Aprobado por soporte",
    });
    expect(processed).toMatchObject({
      status: "processed",
      refundAmountMinor: 10000,
      providerRefundId: "777",
    });
    expect(fakeFirestore.getDoc("pagos", "pago_refund")).toMatchObject({
      status: PaymentStatus.PARTIALLY_REFUNDED,
      refundTotalMinor: 10000,
    });
  });

  it("keeps an Aplazo refund request approved when provider refund fails", async () => {
    process.env.APLAZO_REFUNDS_ENABLED = "true";
    seedAplazoRefundAttempt();
    mockAplazoPaidStatus();
    aplazoProviderMocks.refund.mockRejectedValue(
      Object.assign(new Error("Aplazo refund failed"), {
        statusCode: 502,
        code: "PAYMENT_PROVIDER_ERROR",
      }),
    );
    const service = buildPaymentsService();
    const request = await service.createAplazoRefundRequest(
      { uid: "user_1", rol: RolUsuario.CLIENTE },
      {
        orderId: "orden_refund",
        reason: "No era la talla correcta",
      },
    );

    await expect(
      service.approveAplazoRefundRequest(
        request.id!,
        { uid: "admin_1", rol: RolUsuario.ADMIN },
        {
          refundAmountMinor: 10000,
          reason: "Aprobado por soporte",
        },
      ),
    ).rejects.toMatchObject({
      code: "APLAZO_REFUND_FAILED",
    });

    expect(fakeFirestore.getDoc("paymentRefundRequests", request.id!)).toMatchObject({
      status: "approved",
      refundAmountMinor: 10000,
      lastProcessingError: expect.objectContaining({
        code: "APLAZO_REFUND_FAILED",
      }),
    });
    expect(fakeFirestore.getDoc("pagos", "pago_refund")).toMatchObject({
      status: PaymentStatus.PAID,
    });
  });

  it("returns the same online payment attempt on safe retries without a client key", async () => {
    fakeFirestore = seedFirestore({
      ordenes: {
        orden_aplazo_1: {
          usuarioId: "user_1",
          estado: EstadoOrden.PENDIENTE,
          metodoPago: MetodoPago.APLAZO,
          subtotal: 1000,
          impuestos: 0,
          total: 1099,
          costoEnvio: 99,
          items: [
            {
              productoId: "prod_1",
              cantidad: 1,
              precioUnitario: 1000,
              subtotal: 1000,
            },
          ],
        },
      },
      pagos: {},
      usuariosApp: {
        user_1: {
          uid: "user_1",
          nombre: "Usuario Uno",
          email: "user1@example.com",
          telefono: "4771234567",
        },
      },
      posSessions: {},
      ventasPos: {},
      paymentEventLogs: {},
    });

    aplazoProviderMocks.createOnline.mockResolvedValue({
      status: PaymentStatus.PENDING_CUSTOMER,
      providerStatus: "pending",
      providerPaymentId: "apl_1",
      providerReference: "ref_1",
      redirectUrl: "https://aplazo.example/checkout/ref_1",
      rawRequestSanitized: {},
      rawResponseSanitized: {},
    });
    (productService.getProductById as jest.Mock).mockResolvedValue({
      id: "prod_1",
      descripcion: "Jersey Oficial",
      clave: "JER-001",
      imagenes: ["https://cdn.example.com/jersey.jpg"],
    });

    const paymentAttemptRepo = new PaymentAttemptRepository();
    const eventLogRepo = new PaymentEventLogRepository();
    const service = new PaymentsService(
      paymentAttemptRepo,
      eventLogRepo,
      paymentFinalizerService,
      paymentReconciliationService,
    );

    const first = await service.createAplazoOnline(
      {
        uid: "user_1",
        rol: RolUsuario.CLIENTE,
        email: "user1@example.com",
        telefono: "+52 477 123 4567",
      },
      {
        orderId: "orden_aplazo_1",
      },
    );

    const second = await service.createAplazoOnline(
      {
        uid: "user_1",
        rol: RolUsuario.CLIENTE,
        email: "user1@example.com",
        telefono: "+52 477 123 4567",
      },
      {
        orderId: "orden_aplazo_1",
      },
    );

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(first.paymentAttempt.id).toBe(second.paymentAttempt.id);
    expect(first.paymentAttempt.providerReference).toBe("ref_1");
    expect(aplazoProviderMocks.createOnline).toHaveBeenCalledWith(
      expect.objectContaining({
        providerReference: "orden_aplazo_1",
        currency: "MXN",
        pricingSnapshot: expect.objectContaining({
          subtotalMinor: 100000,
          shippingMinor: 9900,
          totalMinor: 109900,
          items: [
            expect.objectContaining({
              productoId: "prod_1",
              name: "Jersey Oficial",
              sku: "JER-001",
              imageUrl: "https://cdn.example.com/jersey.jpg",
            }),
          ],
        }),
      }),
    );
    expect(aplazoProviderMocks.createOnline).toHaveBeenCalledTimes(1);
    expect(fakeFirestore.countDocs("pagos")).toBe(1);
  });

  it("reuses the same online attempt for the same order even with a different idempotency key", async () => {
    fakeFirestore = seedFirestore({
      ordenes: {
        orden_aplazo_dup: {
          usuarioId: "user_1",
          estado: EstadoOrden.PENDIENTE,
          metodoPago: MetodoPago.APLAZO,
          subtotal: 500,
          impuestos: 0,
          total: 500,
          costoEnvio: 0,
          items: [
            {
              productoId: "prod_1",
              cantidad: 1,
              precioUnitario: 500,
              subtotal: 500,
            },
          ],
        },
      },
      pagos: {},
      usuariosApp: {
        user_1: {
          uid: "user_1",
          nombre: "Usuario Uno",
          email: "user1@example.com",
          telefono: "+52 477 123 4567",
        },
      },
      posSessions: {},
      ventasPos: {},
      paymentEventLogs: {},
    });

    aplazoProviderMocks.createOnline.mockResolvedValue({
      status: PaymentStatus.PENDING_CUSTOMER,
      providerStatus: "pending",
      providerReference: "orden_aplazo_dup",
      redirectUrl: "https://aplazo.example/checkout/orden_aplazo_dup",
      rawRequestSanitized: {},
      rawResponseSanitized: {},
    });
    (productService.getProductById as jest.Mock).mockResolvedValue({
      id: "prod_1",
      descripcion: "Producto Dedupe",
      clave: "SKU-DEDUPE",
      imagenes: [],
    });

    const service = new PaymentsService(
      new PaymentAttemptRepository(),
      new PaymentEventLogRepository(),
      paymentFinalizerService,
      paymentReconciliationService,
    );

    const first = await service.createAplazoOnline(
      {
        uid: "user_1",
        rol: RolUsuario.CLIENTE,
        telefono: "4771234567",
      },
      {
        orderId: "orden_aplazo_dup",
      },
      "idem_order_dup_1111",
    );

    const second = await service.createAplazoOnline(
      {
        uid: "user_1",
        rol: RolUsuario.CLIENTE,
        telefono: "4771234567",
      },
      {
        orderId: "orden_aplazo_dup",
      },
      "idem_order_dup_2222",
    );

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.paymentAttempt.id).toBe(first.paymentAttempt.id);
    expect(aplazoProviderMocks.createOnline).toHaveBeenCalledTimes(1);
  });

  it("blocks provider sync for legacy Aplazo in-store attempts", async () => {
    fakeFirestore = seedFirestore({
      ordenes: {},
      pagos: {
        pago_aplazo_instore_legacy: {
          ordenId: "",
          userId: "empleado_1",
          provider: ProveedorPago.APLAZO,
          metodoPago: MetodoPago.APLAZO,
          flowType: PaymentFlowType.IN_STORE,
          monto: 850,
          amountMinor: 85000,
          currency: "mxn",
          estado: "PENDIENTE",
          status: PaymentStatus.PENDING_CUSTOMER,
          idempotencyKey: "idem_aplazo_instore_legacy",
          providerReference: "cart-pos-legacy",
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now(),
        },
      },
      usuariosApp: {},
      posSessions: {},
      ventasPos: {},
      paymentEventLogs: {},
    });

    const service = new PaymentsService(
      new PaymentAttemptRepository(),
      new PaymentEventLogRepository(),
      paymentFinalizerService,
      paymentReconciliationService,
    );

    await expect(
      service.getPaymentStatusForActor(
        "pago_aplazo_instore_legacy",
        {
          uid: "empleado_1",
          rol: RolUsuario.EMPLEADO,
        },
        { syncWithProvider: true },
      ),
    ).rejects.toMatchObject({
      code: "PAYMENT_FLOW_UNSUPPORTED",
    });
    expect(aplazoProviderMocks.getStatus).not.toHaveBeenCalled();
  });

  it("rejects orders with total <= 0 as PAYMENT_ORDER_INVALID", async () => {
    fakeFirestore = seedFirestore({
      ordenes: {
        orden_aplazo_invalid: {
          usuarioId: "user_1",
          estado: EstadoOrden.PENDIENTE,
          metodoPago: MetodoPago.APLAZO,
          subtotal: 0,
          impuestos: 0,
          total: 0,
          costoEnvio: 0,
          items: [
            {
              productoId: "prod_1",
              cantidad: 1,
              precioUnitario: 0,
              subtotal: 0,
            },
          ],
        },
      },
      pagos: {},
      usuariosApp: {},
      posSessions: {},
      ventasPos: {},
      paymentEventLogs: {},
    });

    const service = new PaymentsService(
      new PaymentAttemptRepository(),
      new PaymentEventLogRepository(),
      paymentFinalizerService,
      paymentReconciliationService,
    );

    await expect(
      service.createAplazoOnline(
        {
          uid: "user_1",
          rol: RolUsuario.CLIENTE,
        },
        {
          orderId: "orden_aplazo_invalid",
        },
      ),
    ).rejects.toMatchObject({
      code: "PAYMENT_ORDER_INVALID",
      details: {
        reason: "ORDER_TOTAL_INVALID",
      },
    });
  });

  it("fails before calling aplazo when customer phone is invalid", async () => {
    fakeFirestore = seedFirestore({
      ordenes: {
        orden_aplazo_phone: {
          usuarioId: "user_1",
          estado: EstadoOrden.PENDIENTE,
          metodoPago: MetodoPago.APLAZO,
          subtotal: 100,
          impuestos: 0,
          total: 100,
          costoEnvio: 0,
          items: [
            {
              productoId: "prod_1",
              cantidad: 1,
              precioUnitario: 100,
              subtotal: 100,
            },
          ],
        },
      },
      pagos: {},
      usuariosApp: {
        user_1: {
          uid: "user_1",
          nombre: " Usuario   Uno ",
          email: "USER1@Example.com",
          telefono: "12345",
        },
      },
      posSessions: {},
      ventasPos: {},
      paymentEventLogs: {},
    });

    (productService.getProductById as jest.Mock).mockResolvedValue({
      id: "prod_1",
      descripcion: "Producto",
      clave: "SKU-1",
      imagenes: [],
    });

    const service = new PaymentsService(
      new PaymentAttemptRepository(),
      new PaymentEventLogRepository(),
      paymentFinalizerService,
      paymentReconciliationService,
    );

    await service
      .createAplazoOnline(
        {
          uid: "user_1",
          rol: RolUsuario.CLIENTE,
        },
        {
          orderId: "orden_aplazo_phone",
        },
      )
      .then(() => {
        throw new Error("Expected createAplazoOnline to fail");
      })
      .catch((error) => {
        expect(error).toMatchObject({
          code: "PAYMENT_VALIDATION_ERROR",
        });
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toBe("Teléfono inválido para Aplazo");
      });

    expect(aplazoProviderMocks.createOnline).not.toHaveBeenCalled();
  });

  it("fails before calling aplazo when pricing snapshot cannot build valid products", async () => {
    fakeFirestore = seedFirestore({
      ordenes: {
        orden_aplazo_items: {
          usuarioId: "user_1",
          estado: EstadoOrden.PENDIENTE,
          metodoPago: MetodoPago.APLAZO,
          subtotal: 0,
          impuestos: 0,
          total: 100,
          costoEnvio: 0,
          items: [
            {
              productoId: "prod_1",
              cantidad: 1,
              precioUnitario: 0,
              subtotal: 0,
            },
          ],
        },
      },
      pagos: {},
      usuariosApp: {
        user_1: {
          uid: "user_1",
          nombre: "Usuario Uno",
          email: "user1@example.com",
          telefono: "4771234567",
        },
      },
      posSessions: {},
      ventasPos: {},
      paymentEventLogs: {},
    });

    (productService.getProductById as jest.Mock).mockResolvedValue({
      id: "prod_1",
      descripcion: "",
      clave: "SKU-1",
      imagenes: [],
    });

    const service = new PaymentsService(
      new PaymentAttemptRepository(),
      new PaymentEventLogRepository(),
      paymentFinalizerService,
      paymentReconciliationService,
    );

    await service
      .createAplazoOnline(
        {
          uid: "user_1",
          rol: RolUsuario.CLIENTE,
        },
        {
          orderId: "orden_aplazo_items",
          customer: {
            name: "  Usuario   Uno ",
            email: " USER1@Example.com ",
            phone: "+52 477 123 4567",
          },
        },
      )
      .then(() => {
        throw new Error("Expected createAplazoOnline to fail");
      })
      .catch((error) => {
        expect(error).toMatchObject({
          code: "PAYMENT_VALIDATION_ERROR",
        });
        expect((error as Error).message).toBe(
          "No fue posible construir products[] válidos para Aplazo",
        );
      });

    expect(aplazoProviderMocks.createOnline).not.toHaveBeenCalled();
  });

  it("normalizes customer fields before sending the createOnline request", async () => {
    fakeFirestore = seedFirestore({
      ordenes: {
        orden_aplazo_normalize: {
          usuarioId: "user_1",
          estado: EstadoOrden.PENDIENTE,
          metodoPago: MetodoPago.APLAZO,
          subtotal: 100,
          impuestos: 0,
          total: 100,
          costoEnvio: 0,
          items: [
            {
              productoId: "prod_1",
              cantidad: 1,
              precioUnitario: 100,
              subtotal: 100,
            },
          ],
        },
      },
      pagos: {},
      usuariosApp: {
        user_1: {
          uid: "user_1",
          nombre: "  Usuario   Uno ",
          email: "USER1@Example.com",
          telefono: "+52 477 123 4567",
        },
      },
      posSessions: {},
      ventasPos: {},
      paymentEventLogs: {},
    });

    aplazoProviderMocks.createOnline.mockResolvedValue({
      status: PaymentStatus.PENDING_CUSTOMER,
      providerStatus: "pending",
      providerReference: "orden_aplazo_normalize",
      redirectUrl: "https://aplazo.example/checkout/orden_aplazo_normalize",
      rawRequestSanitized: {},
      rawResponseSanitized: {},
    });
    (productService.getProductById as jest.Mock).mockResolvedValue({
      id: "prod_1",
      descripcion: "Producto",
      clave: "SKU-1",
      imagenes: [],
    });

    const service = new PaymentsService(
      new PaymentAttemptRepository(),
      new PaymentEventLogRepository(),
      paymentFinalizerService,
      paymentReconciliationService,
    );

    await service.createAplazoOnline(
      {
        uid: "user_1",
        rol: RolUsuario.CLIENTE,
      },
      {
        orderId: "orden_aplazo_normalize",
      },
    );

    expect(aplazoProviderMocks.createOnline).toHaveBeenCalledWith(
      expect.objectContaining({
        customerName: "Usuario Uno",
        customerEmail: "user1@example.com",
        customerPhone: "4771234567",
      }),
    );
  });

  it("deduplicates an aplazo webhook by event id or payload hash", async () => {
    fakeFirestore = seedFirestore({
      ordenes: {},
      pagos: {
        pago_aplazo_1: {
          ordenId: "orden_aplazo_1",
          userId: "user_1",
          provider: ProveedorPago.APLAZO,
          metodoPago: MetodoPago.APLAZO,
          monto: 1000,
          amountMinor: 100000,
          currency: "mxn",
          estado: "PENDIENTE",
          status: "pending_customer",
          idempotencyKey: "idem_aplazo_1",
          providerReference: "ref_1",
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now(),
        },
      },
      usuariosApp: {},
      posSessions: {},
      ventasPos: {},
      paymentEventLogs: {},
    });

    aplazoProviderMocks.parseWebhook.mockResolvedValue({
      provider: ProveedorPago.APLAZO,
      eventType: "payment.updated",
      eventId: "evt_aplazo_1",
      dedupeKey: "evt_aplazo_1",
      providerReference: "ref_1",
      status: PaymentStatus.PAID,
      payloadSanitized: { status: "paid" },
    });

    const service = new PaymentsService(
      new PaymentAttemptRepository(),
      new PaymentEventLogRepository(),
      paymentFinalizerService,
      paymentReconciliationService,
    );

    const first = await service.handleAplazoWebhook({
      rawBody: Buffer.from(JSON.stringify({ id: "evt_aplazo_1", status: "paid" })),
      headers: {},
      requestId: "req-1",
    });

    const second = await service.handleAplazoWebhook({
      rawBody: Buffer.from(JSON.stringify({ id: "evt_aplazo_1", status: "paid" })),
      headers: {},
      requestId: "req-2",
    });

    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(fakeFirestore.countDocs("paymentEventLogs")).toBe(1);
  });

  it("queues and processes the Aplazo confirmation webhook as a paid payment", async () => {
    fakeFirestore = seedFirestore({
      ordenes: {},
      pagos: {
        pago_aplazo_confirmed: {
          ordenId: "orden_aplazo_confirmed",
          userId: "user_1",
          provider: ProveedorPago.APLAZO,
          metodoPago: MetodoPago.APLAZO,
          monto: 1000,
          amountMinor: 100000,
          currency: "mxn",
          estado: "PENDIENTE",
          status: PaymentStatus.PENDING_CUSTOMER,
          idempotencyKey: "idem_aplazo_confirmed",
          providerReference: "cart-123-abc",
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now(),
        },
      },
      usuariosApp: {},
      posSessions: {},
      ventasPos: {},
      paymentEventLogs: {},
    });

    aplazoProviderMocks.parseWebhook.mockResolvedValue({
      provider: ProveedorPago.APLAZO,
      eventType: "aplazo.status.activo",
      dedupeKey: "aplazo-confirmation-1",
      providerLoanId: "155789",
      providerReference: "cart-123-abc",
      merchantId: "1234",
      channel: "online",
      status: PaymentStatus.PAID,
      providerStatus: "Activo",
      payloadSanitized: {
        status: "Activo",
        loanId: 155789,
        cartId: "cart-123-abc",
        merchantId: 1234,
      },
    });

    const finalizer = {
      finalizeTerminalStatus: jest.fn().mockResolvedValue({
        id: "pago_aplazo_confirmed",
        provider: ProveedorPago.APLAZO,
        status: PaymentStatus.PAID,
      }),
      recordLatePaidDivergence: jest.fn(),
    } as unknown as typeof paymentFinalizerService;

    const service = new PaymentsService(
      new PaymentAttemptRepository(),
      new PaymentEventLogRepository(),
      finalizer,
      paymentReconciliationService,
    );

    const queued = await service.handleAplazoWebhook({
      rawBody: Buffer.from(
        JSON.stringify({
          status: "Activo",
          loanId: 155789,
          cartId: "cart-123-abc",
          merchantId: 1234,
        }),
      ),
      headers: {
        authorization: "Bearer expected_secret",
      },
      requestId: "req-aplazo-confirmation",
    });

    const processor = new PaymentEventProcessingService(
      new PaymentEventLogRepository(),
      new PaymentAttemptRepository(),
      finalizer,
    );
    await processor.processQueuedEvent(queued.eventLogId);

    expect(finalizer.finalizeTerminalStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "pago_aplazo_confirmed",
        providerReference: "cart-123-abc",
      }),
      PaymentStatus.PAID,
      expect.objectContaining({
        source: "webhook",
        requestedBy: "aplazo-webhook",
        providerResult: expect.objectContaining({
          providerLoanId: "155789",
          providerReference: "cart-123-abc",
          providerStatus: "Activo",
          status: PaymentStatus.PAID,
        }),
      }),
    );
    expect(fakeFirestore.getDoc("paymentEventLogs", queued.eventLogId)).toMatchObject({
      status: "processed",
      paymentAttemptId: "pago_aplazo_confirmed",
      merchantId: "1234",
    });
  });

  it("syncs aplazo refund status and recalculates the confirmed refunded amount", async () => {
    fakeFirestore = seedFirestore({
      ordenes: {},
      pagos: {
        pago_aplazo_refund_1: {
          ordenId: "orden_aplazo_refund_1",
          userId: "admin_1",
          provider: ProveedorPago.APLAZO,
          metodoPago: MetodoPago.APLAZO,
          monto: 1299,
          amountMinor: 129900,
          currency: "MXN",
          estado: "REEMBOLSADO",
          status: "refunded",
          refundState: "requested",
          refundAmount: 130,
          refundId: "25083",
          idempotencyKey: "idem_aplazo_refund_1",
          providerReference: "abc321",
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now(),
          metadata: {},
        },
      },
      usuariosApp: {},
      posSessions: {},
      ventasPos: {},
      paymentEventLogs: {},
    });

    aplazoProviderMocks.getRefundStatus.mockResolvedValue({
      refundState: "processing",
      providerStatus: "PROCESSING",
      refundId: "25083",
      refundEntries: [
        {
          refundId: "25079",
          providerStatus: "REFUNDED",
          refundState: "succeeded",
          refundDate: "2024-12-19T17:45:03.59153",
          amountMinor: 12000,
        },
        {
          refundId: "25083",
          providerStatus: "PROCESSING",
          refundState: "processing",
          refundDate: "2024-12-19T17:49:33.910913",
          amountMinor: 1000,
        },
      ],
    });

    const service = new PaymentsService(
      new PaymentAttemptRepository(),
      new PaymentEventLogRepository(),
      paymentFinalizerService,
      paymentReconciliationService,
    );

    const result = await service.getAplazoRefundStatus(
      "pago_aplazo_refund_1",
      {
        uid: "admin_1",
        rol: RolUsuario.ADMIN,
      },
      {
        refundId: "25083",
      },
    );

    expect(aplazoProviderMocks.getRefundStatus).toHaveBeenCalledWith({
      paymentAttempt: expect.objectContaining({
        id: "pago_aplazo_refund_1",
        providerReference: "abc321",
      }),
      refundId: "25083",
    });
    expect(result.paymentAttempt.status).toBe(PaymentStatus.PARTIALLY_REFUNDED);
    expect(result.paymentAttempt.refundState).toBe("processing");
    expect(result.paymentAttempt.providerStatus).toBe("PROCESSING");
    expect(result.paymentAttempt.refundAmount).toBe(120);
    expect(result.totalRefundedAmount).toBe(120);
    expect(result.selectedRefund).toMatchObject({
      refundId: "25083",
      providerStatus: "PROCESSING",
    });
  });

  it("rejects aplazo refund status queries from non-privileged actors", async () => {
    fakeFirestore = seedFirestore({
      ordenes: {},
      pagos: {
        pago_aplazo_refund_2: {
          ordenId: "orden_aplazo_refund_2",
          userId: "user_1",
          provider: ProveedorPago.APLAZO,
          metodoPago: MetodoPago.APLAZO,
          monto: 500,
          amountMinor: 50000,
          currency: "MXN",
          estado: "COMPLETADO",
          status: "paid",
          idempotencyKey: "idem_aplazo_refund_2",
          providerReference: "cart_refund_2",
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now(),
        },
      },
      usuariosApp: {},
      posSessions: {},
      ventasPos: {},
      paymentEventLogs: {},
    });

    const service = new PaymentsService(
      new PaymentAttemptRepository(),
      new PaymentEventLogRepository(),
      paymentFinalizerService,
      paymentReconciliationService,
    );

    await expect(
      service.getAplazoRefundStatus(
        "pago_aplazo_refund_2",
        {
          uid: "user_1",
          rol: RolUsuario.CLIENTE,
        },
        {},
      ),
    ).rejects.toMatchObject({
      code: "PAYMENT_FORBIDDEN",
    });
  });

  it("runs reconcile and finalizes paid status through the finalizer", async () => {
    fakeFirestore = seedFirestore({
      ordenes: {},
      pagos: {
        pago_aplazo_1: {
          ordenId: "orden_aplazo_1",
          userId: "user_1",
          provider: ProveedorPago.APLAZO,
          metodoPago: MetodoPago.APLAZO,
          monto: 1000,
          amountMinor: 100000,
          currency: "mxn",
          estado: "PENDIENTE",
          status: "pending_customer",
          idempotencyKey: "idem_aplazo_1",
          providerReference: "ref_1",
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now(),
        },
      },
      usuariosApp: {},
      posSessions: {},
      ventasPos: {},
      paymentEventLogs: {},
    });

    const finalizer = {
      finalizeTerminalStatus: jest.fn().mockResolvedValue({
        id: "pago_aplazo_1",
        provider: ProveedorPago.APLAZO,
        status: PaymentStatus.PAID,
      }),
    } as unknown as typeof paymentFinalizerService;

    aplazoProviderMocks.getStatus.mockResolvedValue({
      status: PaymentStatus.PAID,
      providerStatus: "paid",
      providerReference: "ref_1",
    });

    const reconciliationService = new (require("../src/services/payments/payment-reconciliation.service").PaymentReconciliationService)(
      new PaymentAttemptRepository(),
      new PaymentEventLogRepository(),
      finalizer,
      new PaymentEventProcessingService(
        new PaymentEventLogRepository(),
        new PaymentAttemptRepository(),
        finalizer,
      ),
    );

    const reconciled = await reconciliationService.reconcilePaymentAttempt(
      "pago_aplazo_1",
      "admin_1",
    );

    expect(finalizer.finalizeTerminalStatus).toHaveBeenCalledTimes(1);
    expect(reconciled.status).toBe(PaymentStatus.PAID);
  });
});
