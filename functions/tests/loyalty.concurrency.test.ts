import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { Timestamp } from "firebase-admin/firestore";
import { LoyaltyActorType, LoyaltyChannel } from "../src/modules/loyalty/models/loyalty.enums";
import { RolUsuario } from "../src/models/usuario.model";

type DocData = Record<string, unknown>;

function createFakeFirestore(initial: Record<string, Record<string, DocData>>) {
  const collections = new Map<string, Map<string, DocData>>();
  let idCounter = 0;
  Object.entries(initial).forEach(([name, docs]) => {
    collections.set(name, new Map(Object.entries(docs).map(([id, data]) => [id, { ...data }])));
  });

  const getCollection = (name: string) => {
    if (!collections.has(name)) collections.set(name, new Map());
    return collections.get(name)!;
  };

  const docRefFactory = (collectionName: string, id: string) => ({
    id,
    async get() {
      const data = getCollection(collectionName).get(id);
      return { exists: !!data, id, data: () => (data ? { ...data } : undefined) };
    },
    set(data: DocData, options?: { merge?: boolean }) {
      const col = getCollection(collectionName);
      const current = col.get(id);
      col.set(id, options?.merge && current ? { ...current, ...data } : { ...data });
    },
    create(data: DocData) {
      const col = getCollection(collectionName);
      if (col.has(id)) {
        const err = new Error("exists") as Error & { code?: number };
        err.code = 6;
        throw err;
      }
      col.set(id, { ...data });
    },
    collection(sub: string) {
      return collectionFactory(`${collectionName}/${id}/${sub}`);
    },
  });

  const collectionFactory = (name: string) => ({
    doc(id?: string) {
      return docRefFactory(name, id ?? `auto_${++idCounter}`);
    },
  });

  return {
    collection: collectionFactory,
    async runTransaction(cb: (tx: {
      get: (ref: { get: () => Promise<unknown> }) => Promise<unknown>;
      set: (ref: { set: (d: DocData, o?: { merge?: boolean }) => void }, d: DocData, o?: { merge?: boolean }) => void;
      create: (ref: { create: (d: DocData) => void }, d: DocData) => void;
    }) => unknown) {
      for (let attempt = 0; attempt < 8; attempt += 1) {
        try {
          return await cb({
            get: (ref) => ref.get(),
            set: (ref, data, options) => ref.set(data, options),
            create: (ref, data) => ref.create(data),
          });
        } catch (error) {
          const code = (error as { code?: number }).code;
          if (code === 6 && attempt < 7) {
            continue;
          }
          throw error;
        }
      }
      throw new Error("TRANSACTION_MAX_RETRIES");
    },
    count(name: string) {
      return getCollection(name).size;
    },
    get(name: string, id: string) {
      return getCollection(name).get(id);
    },
  };
}

const fixedNow = Timestamp.fromDate(new Date("2026-03-30T12:00:00.000Z"));
let fakeFirestore = createFakeFirestore({});

jest.mock("../src/config/app.firebase", () => ({
  firestoreApp: {
    collection: (name: string) => fakeFirestore.collection(name),
    runTransaction: (cb: (tx: unknown) => unknown) => fakeFirestore.runTransaction(cb),
  },
}));

jest.mock("../src/config/firebase.admin", () => ({
  admin: {
    firestore: {
      Timestamp: { now: () => fixedNow },
      FieldValue: { serverTimestamp: () => fixedNow },
    },
  },
}));

jest.mock("../src/modules/loyalty/services/loyalty-feature-flags.service", () => ({
  requireLoyaltyWrites: jest.fn<any>().mockResolvedValue(undefined),
  loyaltyFeatureFlagsService: {
    getFlags: jest.fn<any>().mockResolvedValue({
      loyaltyV1WritesEnabled: true,
      loyaltyPhysicalEarnEnabled: true,
      loyaltyDigitalEarnEnabled: true,
    }),
  },
  default: {
    getFlags: jest.fn<any>().mockResolvedValue({
      loyaltyV1WritesEnabled: true,
      loyaltyPhysicalEarnEnabled: true,
      loyaltyDigitalEarnEnabled: true,
    }),
  },
}));

jest.mock("../src/services/puntos.service", () => ({
  __esModule: true,
  default: {
    procesarExpiracionUsuario: jest.fn<any>().mockResolvedValue({
      procesado: false,
      puntosExpirados: 0,
    }),
    evaluateExpiracionPendiente: jest.fn<any>().mockResolvedValue({
      expiring: false,
      points: 0,
      cycleKey: "",
    }),
  },
}));

import loyaltyEngineService from "../src/modules/loyalty/services/loyalty-engine.service";

const actor = {
  actorType: LoyaltyActorType.SERVICE,
  actorId: "test",
  roles: ["SERVICE"],
  permissions: [] as string[],
};

describe("loyalty concurrency", () => {
  beforeEach(() => {
    fakeFirestore = createFakeFirestore({
      usuariosApp: {
        member_1: {
          uid: "member_1",
          rol: RolUsuario.CLIENTE,
          puntosActuales: 0,
          createdAt: fixedNow,
          updatedAt: fixedNow,
        },
      },
      loyalty_wallets: {
        member_1: {
          memberId: "member_1",
          availablePoints: 100,
          heldPoints: 0,
          pendingPoints: 0,
          lifetimeEarnedPoints: 100,
          lifetimeRedeemedPoints: 0,
          level: "Bronce",
          createdAt: fixedNow,
          updatedAt: fixedNow,
        },
      },
    });
  });

  it("caso 1: reintentos con misma venta generan un solo movimiento", async () => {
    const input = {
      memberId: "member_1",
      externalTransactionId: "FOLIO-ABC",
      amountCents: 10000,
      currency: "MXN" as const,
      channel: LoyaltyChannel.STORE,
      idempotencyKey: "earn:folio:ABC",
      actor,
    };

    const first = await loyaltyEngineService.earnFromSale(input);
    const second = await loyaltyEngineService.earnFromSale(input);

    expect(first.transactionId).toBe(second.transactionId);
    expect(first.points).toBe(10);
    expect(first.balanceAfter).toBe(110);
  });

  it("caso 3: misma clave con body distinto devuelve conflicto", async () => {
    await loyaltyEngineService.earnFromSale({
      memberId: "member_1",
      externalTransactionId: "FOLIO-1",
      amountCents: 10000,
      currency: "MXN",
      channel: LoyaltyChannel.STORE,
      idempotencyKey: "same-key",
      actor,
    });

    await expect(
      loyaltyEngineService.earnFromSale({
        memberId: "member_1",
        externalTransactionId: "FOLIO-2",
        amountCents: 20000,
        currency: "MXN",
        channel: LoyaltyChannel.STORE,
        idempotencyKey: "same-key",
        actor,
      }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  });

  it("rechaza una venta si el destinatario dejó de ser CLIENTE", async () => {
    fakeFirestore = createFakeFirestore({
      usuariosApp: {
        internal_1: {
          uid: "internal_1",
          rol: RolUsuario.CLIENTE,
          roles: [RolUsuario.CLIENTE, RolUsuario.TRABAJADOR_CLUBLEON],
          puntosActuales: 0,
          createdAt: fixedNow,
          updatedAt: fixedNow,
        },
      },
    });

    await expect(
      loyaltyEngineService.earnFromSale({
        memberId: "internal_1",
        externalTransactionId: "FOLIO-INTERNAL",
        amountCents: 10000,
        currency: "MXN",
        channel: LoyaltyChannel.STORE,
        idempotencyKey: "internal-sale",
        actor,
      }),
    ).rejects.toMatchObject({ code: "MEMBER_NOT_FOUND" });

    expect(fakeFirestore.count("loyalty_transactions")).toBe(0);
  });
});
