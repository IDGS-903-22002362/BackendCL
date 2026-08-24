import { describe, expect, it, jest } from "@jest/globals";
import { Timestamp } from "firebase-admin/firestore";

jest.mock("../src/config/app.firebase", () => ({
  firestoreApp: {
    collection: () => ({ doc: () => ({}) }),
    settings: () => undefined,
  },
}));

import {
  applyMovementRepair,
  classifyMemberMovements,
  ClassifiedMovement,
  detectAbsorptionEvents,
  PosMovementRecord,
} from "../src/modules/loyalty/scripts/repair-pos-ledger";
import {
  buildAbsorbedExternalId,
  planFills,
} from "../src/modules/loyalty/scripts/reconcile-absorbed-ledger";
import {
  findRepairedTransactions,
  revertRepairedTransaction,
} from "../src/modules/loyalty/scripts/rollback-pos-ledger-repair";
import { buildPosSaleExternalTxnId } from "../src/modules/loyalty/utils/pos-sale.util";

type DocData = Record<string, unknown>;

/** Firestore mínimo en memoria con `create` que colisiona, como el real. */
function createFakeFirestore(initial: Record<string, Record<string, DocData>>) {
  const collections = new Map<string, Map<string, DocData>>();
  let idCounter = 0;
  Object.entries(initial).forEach(([name, docs]) => {
    collections.set(
      name,
      new Map(Object.entries(docs).map(([id, data]) => [id, { ...data }])),
    );
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
        const err = new Error("ALREADY_EXISTS") as Error & { code?: number };
        err.code = 6;
        throw err;
      }
      col.set(id, { ...data });
    },
  });

  const collectionFactory = (name: string) => ({
    doc(id?: string) {
      return docRefFactory(name, id ?? `txn_${++idCounter}`);
    },
    where(field: string, _op: string, value: unknown) {
      return {
        async get() {
          const docs = [...getCollection(name).entries()]
            .filter(([, data]) => data[field] === value)
            .map(([id, data]) => ({ id, data: () => ({ ...data }) }));
          return { docs, size: docs.length, empty: docs.length === 0 };
        },
      };
    },
  });

  return {
    _dump: (name: string) => getCollection(name),
    collection: collectionFactory,
    async runTransaction(cb: (tx: unknown) => unknown) {
      return cb({
        get: (ref: { get: () => Promise<unknown> }) => ref.get(),
        set: (
          ref: { set: (d: DocData, o?: { merge?: boolean }) => void },
          data: DocData,
          options?: { merge?: boolean },
        ) => ref.set(data, options),
        create: (ref: { create: (d: DocData) => void }, data: DocData) =>
          ref.create(data),
      });
    },
  } as unknown as FirebaseFirestore.Firestore & {
    _dump: (name: string) => Map<string, DocData>;
  };
}

const movement = (
  overrides: Partial<PosMovementRecord> = {},
): PosMovementRecord => ({
  movementId: "pos_acc_V-1",
  memberId: "uid-1",
  ventaId: "V-1",
  puntos: 263,
  createdAtMs: 2_000,
  ...overrides,
});

const classified = (
  overrides: Partial<ClassifiedMovement> = {},
): ClassifiedMovement => ({
  ...movement(),
  externalTransactionId: buildPosSaleExternalTxnId("V-1"),
  classification: "MISSING",
  reason: "test",
  ...overrides,
});

describe("reparación POS → ledger", () => {
  describe("clasificación (nunca por comparación de saldos)", () => {
    it("marca MISSING lo que ocurrió después de arrancar el wallet", () => {
      const [result] = classifyMemberMovements({
        memberId: "uid-1",
        movements: [movement({ createdAtMs: 5_000 })],
        walletExists: true,
        firstLedgerTxnAtMs: 1_000,
        ledgerExternalIds: new Map(),
        ledgerSaleIds: new Map(),
      });
      expect(result.classification).toBe("MISSING");
    });

    it("marca ABSORBED lo anterior al ledger: ya está dentro del saldo inicial", () => {
      const [result] = classifyMemberMovements({
        memberId: "uid-1",
        movements: [movement({ createdAtMs: 500 })],
        walletExists: true,
        firstLedgerTxnAtMs: 1_000,
        ledgerExternalIds: new Map(),
        ledgerSaleIds: new Map(),
      });
      expect(result.classification).toBe("ABSORBED");
    });

    it("no reacredita una venta que ya está en el ledger", () => {
      const [result] = classifyMemberMovements({
        memberId: "uid-1",
        movements: [movement()],
        walletExists: true,
        firstLedgerTxnAtMs: 1_000,
        ledgerExternalIds: new Map([["pos-sale:V-1", "txn-existente"]]),
        ledgerSaleIds: new Map(),
      });
      expect(result.classification).toBe("IN_LEDGER");
      expect(result.existingTransactionId).toBe("txn-existente");
    });

    it("detecta la venta aunque se haya acreditado bajo otro namespace", () => {
      const [result] = classifyMemberMovements({
        memberId: "uid-1",
        movements: [movement()],
        walletExists: true,
        firstLedgerTxnAtMs: 1_000,
        ledgerExternalIds: new Map(),
        ledgerSaleIds: new Map([["V-1", "txn-staff-sale"]]),
      });
      expect(result.classification).toBe("IN_LEDGER");
    });

    it("sin wallet ni ledger los puntos siguen en el espejo: no hay pérdida aún", () => {
      const [result] = classifyMemberMovements({
        memberId: "uid-1",
        movements: [movement()],
        walletExists: false,
        firstLedgerTxnAtMs: null,
        ledgerExternalIds: new Map(),
        ledgerSaleIds: new Map(),
      });
      expect(result.classification).toBe("NO_WALLET_YET");
    });
  });

  describe("absorción tardía del wallet", () => {
    // El motor re-materializa el wallet desde `puntosActuales` al reclamar la
    // racha: los puntos POS del espejo entran sin dejar fila en el ledger.
    // Reacreditarlos los duplica, que es justo lo que hay que evitar.
    it("detecta el salto de saldo que ninguna transacción explica", () => {
      const events = detectAbsorptionEvents([
        { balanceBefore: 0, balanceAfter: 40, createdAtMs: 1_000 },
        { balanceBefore: 40, balanceAfter: 55, createdAtMs: 2_000 },
        { balanceBefore: 81, balanceAfter: 86, createdAtMs: 4_000 },
      ]);

      expect(events).toEqual([{ atMs: 4_000, amount: 26 }]);
    });

    it("no inventa saltos cuando el encadenado es correcto", () => {
      const events = detectAbsorptionEvents([
        { balanceBefore: 0, balanceAfter: 40, createdAtMs: 1_000 },
        { balanceBefore: 40, balanceAfter: 45, createdAtMs: 2_000 },
      ]);

      expect(events).toEqual([]);
    });

    it("marca ABSORBED el movimiento que el salto ya se tragó", () => {
      const [result] = classifyMemberMovements({
        memberId: "uid-1",
        movements: [movement({ puntos: 26, createdAtMs: 3_000 })],
        walletExists: true,
        firstLedgerTxnAtMs: 1_000,
        ledgerExternalIds: new Map(),
        ledgerSaleIds: new Map(),
        absorptionEvents: [{ atMs: 4_000, amount: 26 }],
      });

      expect(result.classification).toBe("ABSORBED");
      expect(result.reason).toContain("duplicaría");
    });

    it("distingue el absorbido del posterior legítimo", () => {
      const results = classifyMemberMovements({
        memberId: "uid-1",
        movements: [
          movement({ movementId: "pos_acc_A", ventaId: "A", puntos: 20, createdAtMs: 2_000 }),
          movement({ movementId: "pos_acc_B", ventaId: "B", puntos: 7, createdAtMs: 3_000 }),
          movement({ movementId: "pos_acc_C", ventaId: "C", puntos: 39, createdAtMs: 5_000 }),
        ],
        walletExists: true,
        firstLedgerTxnAtMs: 1_000,
        ledgerExternalIds: new Map(),
        ledgerSaleIds: new Map(),
        absorptionEvents: [{ atMs: 4_000, amount: 27 }],
      });

      expect(results.map((r) => r.classification)).toEqual([
        "ABSORBED",
        "ABSORBED",
        "MISSING",
      ]);
    });

    it("no adivina cuando el salto no cuadra exactamente", () => {
      const results = classifyMemberMovements({
        memberId: "uid-1",
        movements: [movement({ puntos: 26, createdAtMs: 3_000 })],
        walletExists: true,
        firstLedgerTxnAtMs: 1_000,
        ledgerExternalIds: new Map(),
        ledgerSaleIds: new Map(),
        absorptionEvents: [{ atMs: 4_000, amount: 11 }],
      });

      expect(results[0].classification).toBe("MISSING");
      expect(results[0].reason).toContain("ATENCIÓN");
    });
  });

  describe("reconciliación de puntos absorbidos", () => {
    const mov = (
      movementId: string,
      ventaId: string,
      puntos: number,
      createdAtMs: number,
    ) => ({ movementId, ventaId, puntos, createdAtMs });

    it("reparte el hueco encadenando cada venta con la siguiente", () => {
      const fills = planFills(5_000, 91, 118, [
        mov("pos_acc_A", "A", 20, 2_000),
        mov("pos_acc_B", "B", 7, 3_000),
      ]);

      expect(fills).toEqual([
        expect.objectContaining({ ventaId: "A", points: 20, balanceBefore: 91, balanceAfter: 111 }),
        expect.objectContaining({ ventaId: "B", points: 7, balanceBefore: 111, balanceAfter: 118 }),
      ]);
    });

    it("ignora las ventas posteriores al salto", () => {
      const fills = planFills(5_000, 0, 20, [
        mov("pos_acc_A", "A", 20, 2_000),
        mov("pos_acc_B", "B", 7, 9_000),
      ]);

      expect(fills).toHaveLength(1);
      expect(fills?.[0].ventaId).toBe("A");
    });

    it("se rinde si las ventas no cubren el hueco exactamente", () => {
      expect(planFills(5_000, 91, 118, [mov("pos_acc_A", "A", 20, 2_000)])).toBeNull();
    });

    it("no colisiona con la clave externa de la reparación", () => {
      expect(buildAbsorbedExternalId("V-123")).toBe("pos-absorbed:V-123");
      expect(buildAbsorbedExternalId("V-123")).not.toContain("pos-sale:");
    });
  });

  describe("aplicación de la reparación", () => {
    const baseData = (walletPoints: number, legacyPoints = walletPoints) => ({
      usuariosApp: {
        "uid-1": { uid: "uid-1", puntosActuales: legacyPoints },
      },
      loyalty_wallets: {
        "uid-1": {
          memberId: "uid-1",
          availablePoints: walletPoints,
          heldPoints: 0,
          pendingPoints: 0,
          lifetimeEarnedPoints: walletPoints,
          lifetimeRedeemedPoints: 0,
          level: "Bronce",
        },
      },
      loyalty_transactions: {},
      loyalty_external_txn_index: {},
    });

    // Caso 1: wallet 90 + racha 5 = 95; POS aportó 263 => 358 y la racha no los borra.
    it("Caso 1: restituye los 263 puntos POS sobre el saldo con racha ya aplicada", async () => {
      const db = createFakeFirestore(baseData(95));

      const outcome = await applyMovementRepair(db, classified({ puntos: 263 }));

      expect(outcome).toMatchObject({ status: "APPLIED", points: 263 });
      expect(db._dump("loyalty_wallets").get("uid-1")).toMatchObject({
        availablePoints: 358,
      });
      // El espejo legacy se deriva del wallet, no al revés.
      expect(db._dump("usuariosApp").get("uid-1")).toMatchObject({
        puntosActuales: 358,
      });
    });

    // Caso 5: ejecutar el script dos veces acredita 0 puntos adicionales.
    it("Caso 5: la segunda ejecución no acredita nada", async () => {
      const db = createFakeFirestore(baseData(95));
      const target = classified({ puntos: 263 });

      await applyMovementRepair(db, target);
      const second = await applyMovementRepair(db, target);

      expect(second).toEqual({ status: "ALREADY_PROCESSED" });
      expect(db._dump("loyalty_wallets").get("uid-1")).toMatchObject({
        availablePoints: 358,
      });
      expect(db._dump("loyalty_transactions").size).toBe(1);
    });

    // Caso 6: el usuario ya canjeó legítimamente; no se devuelven puntos gastados.
    it("Caso 6: parte del wallet real (158 tras canjear 200), no del espejo inflado", async () => {
      // Escenario del enunciado: saldo previo 358, canjea 200 => wallet 158,
      // pero el espejo legacy quedó accidentalmente en 358.
      const db = createFakeFirestore(baseData(158, 358));

      await applyMovementRepair(db, classified({ puntos: 40 }));

      // 158 + 40, jamás max(358, 158) ni 358 + 40.
      expect(db._dump("loyalty_wallets").get("uid-1")).toMatchObject({
        availablePoints: 198,
      });
      expect(db._dump("usuariosApp").get("uid-1")).toMatchObject({
        puntosActuales: 198,
      });
    });

    // Caso 8: ecommerce + POS + racha conviven; cada evento es su propia entrada.
    it("Caso 8: varias ventas POS se suman una a una y quedan en el ledger", async () => {
      const db = createFakeFirestore(baseData(100));

      await applyMovementRepair(
        db,
        classified({
          movementId: "pos_acc_V-a",
          ventaId: "V-a",
          externalTransactionId: buildPosSaleExternalTxnId("V-a"),
          puntos: 15,
        }),
      );
      await applyMovementRepair(
        db,
        classified({
          movementId: "pos_acc_V-b",
          ventaId: "V-b",
          externalTransactionId: buildPosSaleExternalTxnId("V-b"),
          puntos: 17,
        }),
      );

      expect(db._dump("loyalty_wallets").get("uid-1")).toMatchObject({
        availablePoints: 132,
      });
      expect(db._dump("loyalty_transactions").size).toBe(2);
      expect(db._dump("loyalty_external_txn_index").size).toBe(2);
    });

    it("no acredita si el socio no tiene wallet: sus puntos siguen en el espejo", async () => {
      const db = createFakeFirestore({
        usuariosApp: { "uid-1": { uid: "uid-1", puntosActuales: 300 } },
        loyalty_wallets: {},
        loyalty_transactions: {},
        loyalty_external_txn_index: {},
      });

      const outcome = await applyMovementRepair(db, classified({ puntos: 263 }));

      expect(outcome).toMatchObject({ status: "SKIPPED" });
      expect(db._dump("usuariosApp").get("uid-1")).toMatchObject({
        puntosActuales: 300,
      });
      expect(db._dump("loyalty_transactions").size).toBe(0);
    });

    // FASE 12: cada reparación deja rastro de su origen.
    it("deja metadata de auditoría en la transacción reparada", async () => {
      const db = createFakeFirestore(baseData(95));

      await applyMovementRepair(db, classified({ puntos: 263 }));

      const [txn] = [...db._dump("loyalty_transactions").values()];
      expect(txn).toMatchObject({
        channel: "STORE",
        type: "EARN",
        points: 263,
        balanceBefore: 95,
        balanceAfter: 358,
        reasonCode: "POS_LEDGER_REPAIR",
        externalTransactionId: "pos-sale:V-1",
      });
      expect(txn.metadata).toMatchObject({
        source: "POS",
        repair: true,
        originalMovementId: "pos_acc_V-1",
        ventaId: "V-1",
      });
      expect((txn.metadata as Record<string, unknown>).repairedAt).toEqual(
        expect.any(String),
      );
      expect(txn.createdAt).toBeInstanceOf(Timestamp);
    });
  });

  describe("rollback de la reparación", () => {
    const repairedDb = async (walletPoints = 95, puntos = 263) => {
      const db = createFakeFirestore({
        usuariosApp: { "uid-1": { uid: "uid-1", puntosActuales: walletPoints } },
        loyalty_wallets: {
          "uid-1": {
            memberId: "uid-1",
            availablePoints: walletPoints,
            heldPoints: 0,
            pendingPoints: 0,
            lifetimeEarnedPoints: walletPoints,
            lifetimeRedeemedPoints: 0,
            level: "Bronce",
          },
        },
        loyalty_transactions: {},
        loyalty_external_txn_index: {},
      });
      await applyMovementRepair(db, classified({ puntos }));
      return db;
    };

    it("encuentra exactamente las transacciones que creó la reparación", async () => {
      const db = await repairedDb();

      const candidates = await findRepairedTransactions(db);

      expect(candidates).toHaveLength(1);
      expect(candidates[0]).toMatchObject({
        memberId: "uid-1",
        points: 263,
        ventaId: "V-1",
        originalMovementId: "pos_acc_V-1",
      });
    });

    it("revierte con una transacción compensatoria, no tocando saldos a mano", async () => {
      const db = await repairedDb();
      const [candidate] = await findRepairedTransactions(db);

      const result = await revertRepairedTransaction(db, candidate);

      expect(result).toMatchObject({ status: "REVERTED", points: 263 });
      expect(db._dump("loyalty_wallets").get("uid-1")).toMatchObject({
        availablePoints: 95,
      });
      expect(db._dump("usuariosApp").get("uid-1")).toMatchObject({
        puntosActuales: 95,
      });
      // El alta y su reverso conviven: el ledger conserva ambos eventos.
      expect(db._dump("loyalty_transactions").size).toBe(2);
      const reverso = [...db._dump("loyalty_transactions").values()].find(
        (t) => t.reasonCode === "POS_LEDGER_REPAIR_ROLLBACK",
      );
      expect(reverso).toMatchObject({ points: -263, balanceAfter: 95 });
    });

    it("reejecutar el rollback no vuelve a restar", async () => {
      const db = await repairedDb();
      const [candidate] = await findRepairedTransactions(db);

      await revertRepairedTransaction(db, candidate);
      const second = await revertRepairedTransaction(db, candidate);

      expect(second).toEqual({ status: "ALREADY_REVERTED" });
      expect(db._dump("loyalty_wallets").get("uid-1")).toMatchObject({
        availablePoints: 95,
      });
    });

    it("no deja el saldo en negativo si el socio ya gastó los puntos", async () => {
      const db = await repairedDb();
      const [candidate] = await findRepairedTransactions(db);
      // El socio canjeó después de la reparación y quedó por debajo.
      db._dump("loyalty_wallets").set("uid-1", {
        ...db._dump("loyalty_wallets").get("uid-1"),
        availablePoints: 100,
      });

      const result = await revertRepairedTransaction(db, candidate);

      expect(result).toMatchObject({ status: "SKIPPED" });
      expect(db._dump("loyalty_wallets").get("uid-1")).toMatchObject({
        availablePoints: 100,
      });
    });
  });
});
