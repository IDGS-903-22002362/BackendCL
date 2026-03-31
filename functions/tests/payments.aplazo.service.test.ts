import { Timestamp } from "firebase-admin/firestore";
import { MetodoPago, EstadoOrden } from "../src/models/orden.model";
import {
  PaymentFlowType,
  PaymentMethodCode,
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
  createInStore: jest.fn(),
  parseWebhook: jest.fn(),
  getStatus: jest.fn(),
  cancelOrVoid: jest.fn(),
  refund: jest.fn(),
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
  },
}));

jest.mock("../src/services/payments/providers/aplazo.provider", () => ({
  __esModule: true,
  default: aplazoProviderMocks,
}));

import { PaymentAttemptRepository } from "../src/services/payments/payment-attempt.repository";
import { PaymentEventLogRepository } from "../src/services/payments/payment-event-log.repository";
import { PosSaleRepository } from "../src/services/payments/pos-sale.repository";
import { PosSessionRepository } from "../src/services/payments/pos-session.repository";
import { PaymentsService } from "../src/services/payments/payments.service";
import { PaymentEventProcessingService } from "../src/services/payments/payment-event-processing.service";
import paymentFinalizerService from "../src/services/payments/payment-finalizer.service";
import paymentReconciliationService from "../src/services/payments/payment-reconciliation.service";
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
    countDocs: (collectionName: string) => getCollection(collectionName).size,
  };
}

describe("Aplazo payments service", () => {
  beforeEach(() => {
    fakeFirestore = createFakeFirestore({
      ordenes: {},
      pagos: {},
      usuariosApp: {},
      posSessions: {},
      ventasPos: {},
      paymentEventLogs: {},
    });

    process.env.APP_URL = "http://localhost:3000";
    process.env.APLAZO_ENABLED = "true";
    process.env.APLAZO_ONLINE_ENABLED = "true";
    process.env.APLAZO_INSTORE_ENABLED = "true";
    process.env.APLAZO_RECONCILE_ENABLED = "true";
    process.env.APLAZO_REFUNDS_ENABLED = "false";

    Object.values(aplazoProviderMocks).forEach((mock) => mock.mockReset());
    (productService.getProductById as jest.Mock).mockReset();
  });

  it("returns the same online payment attempt on safe retries without a client key", async () => {
    fakeFirestore = createFakeFirestore({
      ordenes: {
        orden_aplazo_1: {
          usuarioId: "user_1",
          estado: EstadoOrden.PENDIENTE,
          metodoPago: MetodoPago.APLAZO,
          subtotal: 1000,
          impuestos: 0,
          total: 1000,
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

    const paymentAttemptRepo = new PaymentAttemptRepository();
    const eventLogRepo = new PaymentEventLogRepository();
    const posSaleRepo = new PosSaleRepository();
    const posSessionRepo = new PosSessionRepository();
    const service = new PaymentsService(
      paymentAttemptRepo,
      eventLogRepo,
      paymentFinalizerService,
      paymentReconciliationService,
      posSaleRepo,
      posSessionRepo,
    );

    const first = await service.createAplazoOnline(
      {
        uid: "user_1",
        rol: RolUsuario.CLIENTE,
        email: "user1@example.com",
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
      }),
    );
    expect(aplazoProviderMocks.createOnline).toHaveBeenCalledTimes(1);
    expect(fakeFirestore.countDocs("pagos")).toBe(1);
  });

  it("creates an in-store attempt and returns link plus QR metadata", async () => {
    fakeFirestore = createFakeFirestore({
      ordenes: {},
      pagos: {},
      usuariosApp: {},
      posSessions: {
        pos_session_1: {
          deviceId: "device-1",
          cajaId: "caja-1",
          sucursalId: "sucursal-1",
          vendedorUid: "empleado_1",
          status: "OPEN",
          openedAt: Timestamp.now(),
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now(),
        },
      },
      ventasPos: {},
      paymentEventLogs: {},
    });

    (productService.getProductById as jest.Mock).mockResolvedValue({
      id: "prod_1",
      descripcion: "Jersey Oficial",
      precioPublico: 850,
      activo: true,
      existencias: 10,
      tallaIds: [],
      inventarioPorTalla: [],
    });

    aplazoProviderMocks.createInStore.mockResolvedValue({
      status: PaymentStatus.PENDING_CUSTOMER,
      providerStatus: "pending",
      providerPaymentId: "instore_1",
      providerReference: "instore_ref_1",
      paymentLink: "https://aplazo.example/pay/instore_ref_1",
      qrString: "qr_payload",
      qrImageUrl: "https://aplazo.example/qr/instore_ref_1.png",
      rawRequestSanitized: {},
      rawResponseSanitized: {},
    });

    const service = new PaymentsService(
      new PaymentAttemptRepository(),
      new PaymentEventLogRepository(),
      paymentFinalizerService,
      paymentReconciliationService,
      new PosSaleRepository(),
      new PosSessionRepository(),
    );

    const result = await service.createAplazoInStore(
      {
        uid: "empleado_1",
        rol: RolUsuario.EMPLEADO,
      },
      {
        posSessionId: "pos_session_1",
        deviceId: "device-1",
        cajaId: "caja-1",
        sucursalId: "sucursal-1",
        vendedorUid: "empleado_1",
        items: [{ productoId: "prod_1", cantidad: 1 }],
        currency: "mxn",
      },
    );

    expect(result.created).toBe(true);
    expect(result.paymentAttempt.flowType).toBe(PaymentFlowType.IN_STORE);
    expect(result.paymentAttempt.paymentMethodCode).toBe(
      PaymentMethodCode.APLAZO,
    );
    expect(aplazoProviderMocks.createInStore).toHaveBeenCalledWith(
      expect.objectContaining({
        providerReference: expect.any(String),
        webhookUrl: "http://localhost:3000/api/webhooks/aplazo",
      }),
    );
    expect(result.paymentAttempt.metadata?.paymentLink).toBe(
      "https://aplazo.example/pay/instore_ref_1",
    );
    expect(result.sale.paymentAttemptId).toBe(result.paymentAttempt.id);
  });

  it("deduplicates an aplazo webhook by event id or payload hash", async () => {
    fakeFirestore = createFakeFirestore({
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
      new PosSaleRepository(),
      new PosSessionRepository(),
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

  it("runs reconcile and finalizes paid status through the finalizer", async () => {
    fakeFirestore = createFakeFirestore({
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
