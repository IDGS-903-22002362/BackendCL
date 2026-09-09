import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { Timestamp } from "firebase-admin/firestore";
import { LoyaltyActorType, LoyaltyChannel } from "../src/modules/loyalty/models/loyalty.enums";
import { RolUsuario } from "../src/models/usuario.model";

type DocData = Record<string, unknown>;
type DocRef = {
  path: string;
  get: () => Promise<unknown>;
  set: (d: DocData, o?: { merge?: boolean }) => void;
  create: (d: DocData) => void;
};

function createFakeFirestore(initial: Record<string, Record<string, DocData>>) {
  const collections = new Map<string, Map<string, DocData>>();
  // Versi?n por documento: permite que runTransaction aborte igual que
  // Firestore cuando alguien m?s escribi? lo que la transacci?n hab?a le?do.
  const versions = new Map<string, number>();
  let idCounter = 0;
  const bump = (path: string) => versions.set(path, (versions.get(path) ?? 0) + 1);
  Object.entries(initial).forEach(([name, docs]) => {
    collections.set(name, new Map(Object.entries(docs).map(([id, data]) => [id, { ...data }])));
  });

  const getCollection = (name: string) => {
    if (!collections.has(name)) collections.set(name, new Map());
    return collections.get(name)!;
  };

  // Los repositorios del motor capturan `firestoreApp.collection(...)` al
  // importarse, as? que la instancia no puede cambiar entre tests: se vac?a.
  const reset = (next: Record<string, Record<string, DocData>>) => {
    collections.clear();
    versions.clear();
    idCounter = 0;
    Object.entries(next).forEach(([name, docs]) => {
      collections.set(name, new Map(Object.entries(docs).map(([id, data]) => [id, { ...data }])));
    });
  };

  const docRefFactory = (collectionName: string, id: string) => ({
    id,
    path: `${collectionName}/${id}`,
    async get() {
      const data = getCollection(collectionName).get(id);
      return { exists: !!data, id, data: () => (data ? { ...data } : undefined) };
    },
    set(data: DocData, options?: { merge?: boolean }) {
      const col = getCollection(collectionName);
      const current = col.get(id);
      col.set(id, options?.merge && current ? { ...current, ...data } : { ...data });
      bump(`${collectionName}/${id}`);
    },
    create(data: DocData) {
      const col = getCollection(collectionName);
      if (col.has(id)) {
        const err = new Error("exists") as Error & { code?: number };
        err.code = 6;
        throw err;
      }
      col.set(id, { ...data });
      bump(`${collectionName}/${id}`);
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
    reset,
    collection: collectionFactory,
    async runTransaction(cb: (tx: {
      get: (ref: DocRef) => Promise<unknown>;
      set: (ref: DocRef, d: DocData, o?: { merge?: boolean }) => void;
      create: (ref: DocRef, d: DocData) => void;
    }) => unknown) {
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const readVersions = new Map<string, number>();
        const pendingWrites: Array<() => void> = [];

        try {
          const result = await cb({
            get: async (ref) => {
              const snap = await ref.get();
              readVersions.set(ref.path, versions.get(ref.path) ?? 0);
              return snap;
            },
            set: (ref, data, options) => {
              pendingWrites.push(() => ref.set(data, options));
            },
            create: (ref, data) => {
              pendingWrites.push(() => ref.create(data));
            },
          });

          const stale = [...readVersions].some(
            ([path, seen]) => (versions.get(path) ?? 0) !== seen,
          );
          if (stale) {
            if (attempt < 7) continue;
            throw new Error("TRANSACTION_MAX_RETRIES");
          }

          pendingWrites.forEach((write) => write());
          return result;
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
const fakeFirestore = createFakeFirestore({});

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
import { buildPosSaleExternalTxnId } from "../src/modules/loyalty/utils/pos-sale.util";

const actor = {
  actorType: LoyaltyActorType.SERVICE,
  actorId: "test",
  roles: ["SERVICE"],
  permissions: [] as string[],
};

describe("loyalty concurrency", () => {
  beforeEach(() => {
    fakeFirestore.reset({
      usuariosApp: {
        member_1: {
          uid: "member_1",
          nombre: "  Cliente   Uno  ",
          rol: RolUsuario.CLIENTE,
          // Espejo alineado con el wallet: cualquier diferencia aquí dispara
          // el detector de drift y sería ruido en los logs del test.
          puntosActuales: 100,
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
      externalTransactionId: "staff-sale:store-a:member_1:FOLIO-ABC",
      amountCents: 10000,
      currency: "MXN" as const,
      channel: LoyaltyChannel.STORE,
      idempotencyKey: "earn:folio:ABC",
      metadata: { saleId: "FOLIO-ABC", source: "staff-qr" },
      actor,
    };

    const first = await loyaltyEngineService.earnFromSale(input);
    const second = await loyaltyEngineService.earnFromSale(input);

    expect(first.transactionId).toBe(second.transactionId);
    expect(first.points).toBe(10);
    expect(first.balanceAfter).toBe(110);
    expect(first.externalTransactionId).toBe(
      "staff-sale:store-a:member_1:FOLIO-ABC",
    );
    expect(first.metadata).toEqual({
      saleId: "FOLIO-ABC",
      source: "staff-qr",
      customerNameSnapshot: "Cliente Uno",
    });
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

  it("caso 7: racha y venta POS en paralelo no se pisan entre s?", async () => {
    // El bug original: dos flujos leen 100, cada uno calcula su total sobre esa
    // lectura y el ?ltimo en escribir borra al otro. Aqu? ambos deben sumarse.
    const [racha, pos] = await Promise.all([
      loyaltyEngineService.earnFromSale({
        memberId: "member_1",
        externalTransactionId: "streak:member_1:2026-03-30",
        amountCents: 5000,
        currency: "MXN",
        channel: LoyaltyChannel.ECOMMERCE,
        idempotencyKey: "streak:2026-03-30",
        actor,
      }),
      loyaltyEngineService.earnFromSale({
        memberId: "member_1",
        externalTransactionId: buildPosSaleExternalTxnId("V-777"),
        amountCents: 26300,
        currency: "MXN",
        channel: LoyaltyChannel.STORE,
        idempotencyKey: "pos-sale:V-777",
        actor,
      }),
    ]);

    expect(racha.points).toBe(5);
    expect(pos.points).toBe(26);
    expect(racha.transactionId).not.toBe(pos.transactionId);
    // Con lost-update las dos partir?an de 100 y dar?an 105 y 126. La segunda
    // en entrar tiene que ver el saldo que dej? la primera: 105 y 131.
    expect([racha.balanceAfter, pos.balanceAfter].sort((a, b) => a - b)).toEqual([
      105, 131,
    ]);
  });

  it("caso 8: ecommerce, POS y racha conviven como eventos separados", async () => {
    const canales = [
      {
        channel: LoyaltyChannel.ECOMMERCE,
        externalTransactionId: "order:ORD-1",
        idempotencyKey: "order:ORD-1",
        amountCents: 40000,
      },
      {
        channel: LoyaltyChannel.STORE,
        externalTransactionId: buildPosSaleExternalTxnId("V-1"),
        idempotencyKey: "pos-sale:V-1",
        amountCents: 15000,
      },
      {
        channel: LoyaltyChannel.ECOMMERCE,
        externalTransactionId: "streak:member_1:2026-03-31",
        idempotencyKey: "streak:2026-03-31",
        amountCents: 5000,
      },
    ];

    const transacciones = [];
    for (const canal of canales) {
      transacciones.push(
        await loyaltyEngineService.earnFromSale({
          memberId: "member_1",
          currency: "MXN",
          actor,
          ...canal,
        }),
      );
    }

    expect(new Set(transacciones.map((t) => t.transactionId)).size).toBe(3);
    expect(transacciones.map((t) => t.points)).toEqual([40, 15, 5]);
    // Cada canal se apila sobre el anterior en lugar de reemplazarlo.
    expect(transacciones.map((t) => t.balanceAfter)).toEqual([140, 155, 160]);
  });

  it("rechaza una venta si el destinatario dej? de ser CLIENTE", async () => {
    fakeFirestore.reset({
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

  it("permite acumular a un cliente legacy activo sin rol expl?cito", async () => {
    fakeFirestore.reset({
      usuariosApp: {
        legacy_1: {
          uid: "legacy_1",
          email: "legacy@example.com",
          activo: true,
          puntosActuales: 0,
          createdAt: fixedNow,
          updatedAt: fixedNow,
        },
      },
    });

    const transaction = await loyaltyEngineService.earnFromSale({
      memberId: "legacy_1",
      externalTransactionId: "FOLIO-LEGACY",
      amountCents: 10000,
      currency: "MXN",
      channel: LoyaltyChannel.STORE,
      idempotencyKey: "legacy-sale",
      actor,
    });

    expect(transaction.points).toBe(10);
    expect(transaction.balanceAfter).toBe(10);
  });

  it("el regalo de campaña suma 20 pts, deja el movimiento y no se duplica", async () => {
    const first = await loyaltyEngineService.applyCampaignGiftBonus("member_1", {
      campaignKey: "regalo-20-puntos-2026-09-08",
      points: 20,
      description: "regalo 20 puntos del 8/09/2026",
      claimField: "regaloPuntos20260908At",
    });
    const second = await loyaltyEngineService.applyCampaignGiftBonus("member_1", {
      campaignKey: "regalo-20-puntos-2026-09-08",
      points: 20,
      description: "regalo 20 puntos del 8/09/2026",
      claimField: "regaloPuntos20260908At",
    });

    expect(first).not.toBeNull();
    expect(first?.points).toBe(20);
    expect(first?.balanceBefore).toBe(100);
    expect(first?.balanceAfter).toBe(120);
    expect(first?.description).toBe("regalo 20 puntos del 8/09/2026");
    expect(second).toBeNull();
    expect(fakeFirestore.get("usuariosApp", "member_1")?.puntosActuales).toBe(120);
    expect(
      fakeFirestore.get("usuariosApp", "member_1")?.regaloPuntos20260908At,
    ).toBeTruthy();
    expect(fakeFirestore.get("loyalty_wallets", "member_1")?.availablePoints).toBe(
      120,
    );
    expect(fakeFirestore.count("usuariosApp/member_1/movimientos_puntos")).toBe(1);
  });
});
