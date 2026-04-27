import { Timestamp } from "firebase-admin/firestore";
import { MetodoPago, EstadoOrden } from "../src/models/orden.model";
import { EstadoVentaPos } from "../src/models/venta-pos.model";
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
import { PosSaleRepository } from "../src/services/payments/pos-sale.repository";
import { PosSessionRepository } from "../src/services/payments/pos-session.repository";
import { PaymentsService } from "../src/services/payments/payments.service";
import { PaymentEventProcessingService } from "../src/services/payments/payment-event-processing.service";
import paymentFinalizerService, {
  PaymentFinalizerService,
} from "../src/services/payments/payment-finalizer.service";
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
    process.env.BACKEND_PUBLIC_URL = "http://localhost:3000";
    process.env.APLAZO_ENABLED = "true";
    process.env.APLAZO_ONLINE_ENABLED = "true";
    process.env.APLAZO_INSTORE_ENABLED = "true";
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

  it("returns the same online payment attempt on safe retries without a client key", async () => {
    fakeFirestore = createFakeFirestore({
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

  it("deduplicates an in-store attempt created from items without a client key", async () => {
    fakeFirestore = createFakeFirestore({
      ordenes: {},
      pagos: {},
      usuariosApp: {},
      posSessions: {
        pos_session_items_dedupe: {
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
      rawRequestSanitized: {},
      rawResponseSanitized: {},
    });

    const finalizer = new PaymentFinalizerService(
      new PaymentAttemptRepository(),
      new PosSaleRepository(),
    );
    const service = new PaymentsService(
      new PaymentAttemptRepository(),
      new PaymentEventLogRepository(),
      finalizer,
      paymentReconciliationService,
      new PosSaleRepository(),
      new PosSessionRepository(),
    );
    const payload = {
      posSessionId: "pos_session_items_dedupe",
      deviceId: "device-1",
      cajaId: "caja-1",
      sucursalId: "sucursal-1",
      vendedorUid: "empleado_1",
      customer: {
        name: "Cliente POS",
        phone: "4771234567",
      },
      items: [{ productoId: "prod_1", cantidad: 1 }],
      currency: "mxn",
    };

    const first = await service.createAplazoInStore(
      {
        uid: "empleado_1",
        rol: RolUsuario.EMPLEADO,
      },
      payload,
    );
    const second = await service.createAplazoInStore(
      {
        uid: "empleado_1",
        rol: RolUsuario.EMPLEADO,
      },
      payload,
    );

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.paymentAttempt.id).toBe(first.paymentAttempt.id);
    expect(second.sale.id).toBe(first.sale.id);
    expect(fakeFirestore.countDocs("ventasPos")).toBe(1);
    expect(fakeFirestore.countDocs("pagos")).toBe(1);
    expect(aplazoProviderMocks.createInStore).toHaveBeenCalledTimes(1);
  });

  it("returns the active in-store attempt for an existing POS sale", async () => {
    const now = Timestamp.now();
    fakeFirestore = createFakeFirestore({
      ordenes: {},
      pagos: {
        pago_pos_active: {
          ordenId: "",
          ventaPosId: "venta_pos_active",
          userId: "empleado_1",
          provider: ProveedorPago.APLAZO,
          metodoPago: MetodoPago.APLAZO,
          flowType: PaymentFlowType.IN_STORE,
          paymentMethodCode: PaymentMethodCode.APLAZO,
          monto: 850,
          amountMinor: 85000,
          currency: "mxn",
          estado: "PENDIENTE",
          status: PaymentStatus.PENDING_CUSTOMER,
          idempotencyKey: "idem_previous_active",
          providerReference: "cart_active",
          createdAt: now,
          updatedAt: now,
        },
      },
      usuariosApp: {},
      posSessions: {
        pos_session_existing: {
          deviceId: "device-1",
          cajaId: "caja-1",
          sucursalId: "sucursal-1",
          vendedorUid: "empleado_1",
          status: "OPEN",
          openedAt: now,
          createdAt: now,
          updatedAt: now,
        },
      },
      ventasPos: {
        venta_pos_active: {
          posSessionId: "pos_session_existing",
          deviceId: "device-1",
          cajaId: "caja-1",
          sucursalId: "sucursal-1",
          vendedorUid: "empleado_1",
          currency: "mxn",
          subtotal: 850,
          tax: 0,
          shipping: 0,
          total: 850,
          subtotalMinor: 85000,
          taxMinor: 0,
          shippingMinor: 0,
          totalMinor: 85000,
          status: EstadoVentaPos.PENDIENTE_PAGO,
          paymentAttemptId: "pago_pos_active",
          providerReference: "cart_active",
          items: [
            {
              productoId: "prod_1",
              cantidad: 1,
              precioUnitario: 850,
              subtotal: 850,
            },
          ],
          createdAt: now,
          updatedAt: now,
        },
      },
      paymentEventLogs: {},
    });

    const finalizer = new PaymentFinalizerService(
      new PaymentAttemptRepository(),
      new PosSaleRepository(),
    );
    const service = new PaymentsService(
      new PaymentAttemptRepository(),
      new PaymentEventLogRepository(),
      finalizer,
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
        ventaPosId: "venta_pos_active",
        posSessionId: "pos_session_existing",
        deviceId: "device-1",
        cajaId: "caja-1",
        sucursalId: "sucursal-1",
        vendedorUid: "empleado_1",
      },
      "different_key_123456",
    );

    expect(result.created).toBe(false);
    expect(result.paymentAttempt.id).toBe("pago_pos_active");
    expect(aplazoProviderMocks.createInStore).not.toHaveBeenCalled();
    expect(fakeFirestore.countDocs("pagos")).toBe(1);
  });

  it("rejects an existing POS sale from a different session", async () => {
    const now = Timestamp.now();
    fakeFirestore = createFakeFirestore({
      ordenes: {},
      pagos: {},
      usuariosApp: {},
      posSessions: {
        pos_session_requested: {
          deviceId: "device-1",
          cajaId: "caja-1",
          sucursalId: "sucursal-1",
          vendedorUid: "empleado_1",
          status: "OPEN",
          openedAt: now,
          createdAt: now,
          updatedAt: now,
        },
      },
      ventasPos: {
        venta_pos_other_session: {
          posSessionId: "pos_session_other",
          deviceId: "device-1",
          cajaId: "caja-1",
          sucursalId: "sucursal-1",
          vendedorUid: "empleado_1",
          currency: "mxn",
          subtotal: 850,
          tax: 0,
          shipping: 0,
          total: 850,
          subtotalMinor: 85000,
          taxMinor: 0,
          shippingMinor: 0,
          totalMinor: 85000,
          status: EstadoVentaPos.BORRADOR,
          items: [],
          createdAt: now,
          updatedAt: now,
        },
      },
      paymentEventLogs: {},
    });

    const service = new PaymentsService(
      new PaymentAttemptRepository(),
      new PaymentEventLogRepository(),
      paymentFinalizerService,
      paymentReconciliationService,
      new PosSaleRepository(),
      new PosSessionRepository(),
    );

    await expect(
      service.createAplazoInStore(
        {
          uid: "empleado_1",
          rol: RolUsuario.EMPLEADO,
        },
        {
          ventaPosId: "venta_pos_other_session",
          posSessionId: "pos_session_requested",
          deviceId: "device-1",
          cajaId: "caja-1",
          sucursalId: "sucursal-1",
          vendedorUid: "empleado_1",
        },
      ),
    ).rejects.toMatchObject({
      code: "PAYMENT_VALIDATION_ERROR",
    });
    expect(aplazoProviderMocks.createInStore).not.toHaveBeenCalled();
  });

  it("rejects terminal POS sales before calling Aplazo", async () => {
    const terminalStatuses = [
      EstadoVentaPos.PAGADA,
      EstadoVentaPos.CANCELADA,
      EstadoVentaPos.EXPIRADA,
    ];

    for (const status of terminalStatuses) {
      const now = Timestamp.now();
      fakeFirestore = createFakeFirestore({
        ordenes: {},
        pagos: {},
        usuariosApp: {},
        posSessions: {
          pos_session_terminal: {
            deviceId: "device-1",
            cajaId: "caja-1",
            sucursalId: "sucursal-1",
            vendedorUid: "empleado_1",
            status: "OPEN",
            openedAt: now,
            createdAt: now,
            updatedAt: now,
          },
        },
        ventasPos: {
          venta_pos_terminal: {
            posSessionId: "pos_session_terminal",
            deviceId: "device-1",
            cajaId: "caja-1",
            sucursalId: "sucursal-1",
            vendedorUid: "empleado_1",
            currency: "mxn",
            subtotal: 850,
            tax: 0,
            shipping: 0,
            total: 850,
            subtotalMinor: 85000,
            taxMinor: 0,
            shippingMinor: 0,
            totalMinor: 85000,
            status,
            items: [
              {
                productoId: "prod_1",
                cantidad: 1,
                precioUnitario: 850,
                subtotal: 850,
              },
            ],
            createdAt: now,
            updatedAt: now,
          },
        },
        paymentEventLogs: {},
      });

      const service = new PaymentsService(
        new PaymentAttemptRepository(),
        new PaymentEventLogRepository(),
        paymentFinalizerService,
        paymentReconciliationService,
        new PosSaleRepository(),
        new PosSessionRepository(),
      );

      await expect(
        service.createAplazoInStore(
          {
            uid: "empleado_1",
            rol: RolUsuario.EMPLEADO,
          },
          {
            ventaPosId: "venta_pos_terminal",
            posSessionId: "pos_session_terminal",
            deviceId: "device-1",
            cajaId: "caja-1",
            sucursalId: "sucursal-1",
            vendedorUid: "empleado_1",
          },
        ),
      ).rejects.toMatchObject({
        code: "PAYMENT_POS_SALE_TERMINAL",
      });
    }

    expect(aplazoProviderMocks.createInStore).not.toHaveBeenCalled();
  });

  it("reuses the same online attempt for the same order even with a different idempotency key", async () => {
    fakeFirestore = createFakeFirestore({
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
      new PosSaleRepository(),
      new PosSessionRepository(),
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

  it("rejects orders with total <= 0 as PAYMENT_ORDER_INVALID", async () => {
    fakeFirestore = createFakeFirestore({
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
      new PosSaleRepository(),
      new PosSessionRepository(),
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
    fakeFirestore = createFakeFirestore({
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
      new PosSaleRepository(),
      new PosSessionRepository(),
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
    fakeFirestore = createFakeFirestore({
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
      new PosSaleRepository(),
      new PosSessionRepository(),
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
    fakeFirestore = createFakeFirestore({
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
      new PosSaleRepository(),
      new PosSessionRepository(),
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

  it("queues and processes the Aplazo confirmation webhook as a paid payment", async () => {
    fakeFirestore = createFakeFirestore({
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
      new PosSaleRepository(),
      new PosSessionRepository(),
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

  it("finalizes an in-store paid webhook by marking the POS sale as paid and moving inventory", async () => {
    const now = Timestamp.now();
    fakeFirestore = createFakeFirestore({
      ordenes: {},
      pagos: {
        pago_aplazo_pos_confirmed: {
          ordenId: "",
          ventaPosId: "venta_pos_confirmed",
          userId: "empleado_1",
          provider: ProveedorPago.APLAZO,
          metodoPago: MetodoPago.APLAZO,
          flowType: PaymentFlowType.IN_STORE,
          paymentMethodCode: PaymentMethodCode.APLAZO,
          monto: 850,
          amountMinor: 85000,
          currency: "mxn",
          estado: "PENDIENTE",
          status: PaymentStatus.PENDING_CUSTOMER,
          idempotencyKey: "idem_aplazo_pos_confirmed",
          providerReference: "cart-pos-confirmed",
          createdAt: now,
          updatedAt: now,
        },
      },
      usuariosApp: {},
      posSessions: {},
      ventasPos: {
        venta_pos_confirmed: {
          posSessionId: "pos_session_1",
          deviceId: "device-1",
          cajaId: "caja-1",
          sucursalId: "sucursal-1",
          vendedorUid: "empleado_1",
          currency: "mxn",
          subtotal: 850,
          tax: 0,
          shipping: 0,
          total: 850,
          subtotalMinor: 85000,
          taxMinor: 0,
          shippingMinor: 0,
          totalMinor: 85000,
          status: EstadoVentaPos.PENDIENTE_PAGO,
          paymentAttemptId: "pago_aplazo_pos_confirmed",
          providerReference: "cart-pos-confirmed",
          items: [
            {
              productoId: "prod_1",
              cantidad: 1,
              precioUnitario: 850,
              subtotal: 850,
            },
          ],
          createdAt: now,
          updatedAt: now,
        },
      },
      paymentEventLogs: {},
    });

    (productService.getStockBySize as jest.Mock).mockResolvedValue({
      productoId: "prod_1",
      existencias: 10,
      tallaIds: [],
      inventarioPorTalla: [],
    });
    (productService.updateStock as jest.Mock).mockResolvedValue({
      movimientoId: "mov_1",
      productoId: "prod_1",
      tallaId: null,
      cantidadAnterior: 10,
      cantidadNueva: 9,
      diferencia: -1,
      createdAt: new Date("2026-04-27T00:00:00.000Z"),
    });

    aplazoProviderMocks.parseWebhook.mockResolvedValue({
      provider: ProveedorPago.APLAZO,
      eventType: "aplazo.status.activo",
      dedupeKey: "aplazo-pos-confirmation-1",
      providerLoanId: "155790",
      providerReference: "cart-pos-confirmed",
      merchantId: "merchant_instore",
      channel: "in_store",
      status: PaymentStatus.PAID,
      providerStatus: "Activo",
      payloadSanitized: {
        status: "Activo",
        loanId: 155790,
        cartId: "cart-pos-confirmed",
        merchantId: "merchant_instore",
      },
    });

    const finalizer = new PaymentFinalizerService(
      new PaymentAttemptRepository(),
      new PosSaleRepository(),
    );
    const service = new PaymentsService(
      new PaymentAttemptRepository(),
      new PaymentEventLogRepository(),
      finalizer,
      paymentReconciliationService,
      new PosSaleRepository(),
      new PosSessionRepository(),
    );

    const queued = await service.handleAplazoWebhook({
      rawBody: Buffer.from(
        JSON.stringify({
          status: "Activo",
          loanId: 155790,
          cartId: "cart-pos-confirmed",
          merchantId: "merchant_instore",
        }),
      ),
      headers: {
        authorization: "Bearer expected_secret",
      },
      requestId: "req-aplazo-pos-confirmation",
    });

    const processor = new PaymentEventProcessingService(
      new PaymentEventLogRepository(),
      new PaymentAttemptRepository(),
      finalizer,
    );
    await processor.processQueuedEvent(queued.eventLogId);

    expect(fakeFirestore.getDoc("ventasPos", "venta_pos_confirmed")).toMatchObject({
      status: EstadoVentaPos.PAGADA,
      paymentAttemptId: "pago_aplazo_pos_confirmed",
      providerReference: "cart-pos-confirmed",
    });
    expect(productService.updateStock).toHaveBeenCalledWith(
      "prod_1",
      expect.objectContaining({
        cantidadNueva: 9,
        ventaPosId: "venta_pos_confirmed",
        usuarioId: "empleado_1",
      }),
    );
    expect(fakeFirestore.countDocs("inventarioMovimientosIdempotency")).toBe(1);
    expect(fakeFirestore.getDoc("paymentEventLogs", queued.eventLogId)).toMatchObject({
      status: "processed",
      paymentAttemptId: "pago_aplazo_pos_confirmed",
    });
  });

  it("syncs aplazo refund status and recalculates the confirmed refunded amount", async () => {
    fakeFirestore = createFakeFirestore({
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
      new PosSaleRepository(),
      new PosSessionRepository(),
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
    fakeFirestore = createFakeFirestore({
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
      new PosSaleRepository(),
      new PosSessionRepository(),
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
