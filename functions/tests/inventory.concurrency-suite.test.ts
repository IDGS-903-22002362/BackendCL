/// <reference types="jest" />

/**
 * Suite completa de pruebas de concurrencia de inventario - 20 escenarios
 *
 * Usa un mock en memoria con transacciones serializadas (simula MVCC de Firestore).
 * Writes dentro de una transaccion se aplican en batch solo si el callback no lanza;
 * si lanza, se descartan (rollback).
 *
 * LIMITACION: el mock no replica reintentos automaticos de Firestore.
 * Para pruebas de concurrencia de red real se requiere Firebase Emulator Suite.
 */

type DocData = Record<string, unknown>;

let fakeFirestore: ReturnType<typeof createFakeFirestore>;

jest.mock("../src/config/inventory.config", () => ({
  INVENTORY_RESERVATION_TTL_MINUTES: 30,
  INVENTORY_EMPLOYEE_ADJUSTMENT_LIMIT: 5,
}));

const NOW = new Date("2026-06-22T12:00:00.000Z");

jest.mock("../src/config/firebase", () => ({
  firestoreTienda: {
    collection: (name: string) => fakeFirestore.collection(name),
    runTransaction: (cb: (tx: unknown) => Promise<unknown>) =>
      fakeFirestore.runTransaction(cb),
  },
}));

jest.mock("../src/config/firebase.admin", () => ({
  admin: {
    firestore: {
      Timestamp: {
        now: () => NOW,
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

// --- Enhanced fake Firestore with rollback support ---

function toComparable(v: unknown): Date | number {
  if (v instanceof Date) return v;
  if (typeof v === "string") {
    const d = new Date(v);
    if (!isNaN(d.getTime())) return d;
  }
  return Number(v);
}

function applyFilter(
  data: DocData,
  filter: { field: string; op: string; value: unknown },
): boolean {
  const val = data[filter.field];
  switch (filter.op) {
    case "==":
      return val === filter.value;
    case "<=": {
      const a = toComparable(val);
      const b = toComparable(filter.value);
      if (a instanceof Date && b instanceof Date) return a <= b;
      return Number(a) <= Number(b);
    }
    case ">=": {
      const a = toComparable(val);
      const b = toComparable(filter.value);
      if (a instanceof Date && b instanceof Date) return a >= b;
      return Number(a) >= Number(b);
    }
    case "in":
      return Array.isArray(filter.value) && filter.value.includes(val);
    default:
      return true;
  }
}

type DocRef = {
  id: string;
  get(): Promise<{ exists: boolean; id: string; data(): DocData | undefined }>;
  update(patch: DocData): Promise<void>;
  set(data: DocData): Promise<void>;
};

function createFakeFirestore(initial: Record<string, Record<string, DocData>>) {
  const collections = new Map<string, Map<string, DocData>>();

  const loadInitial = (state: Record<string, Record<string, DocData>>) => {
    collections.clear();
    Object.entries(state).forEach(([name, docs]) => {
      collections.set(
        name,
        new Map(
          Object.entries(docs).map(([id, data]) => [
            id,
            JSON.parse(JSON.stringify(data)),
          ]),
        ),
      );
    });
  };

  loadInitial(initial);

  let idCounter = 0;
  let lock = Promise.resolve();

  const getCol = (name: string): Map<string, DocData> => {
    if (!collections.has(name)) collections.set(name, new Map());
    return collections.get(name)!;
  };

  const makeDocRef = (colName: string, id: string): DocRef => ({
    id,
    async get() {
      const d = getCol(colName).get(id);
      return {
        exists: !!d,
        id,
        data: () => (d ? JSON.parse(JSON.stringify(d)) : undefined),
      };
    },
    async update(patch) {
      const col = getCol(colName);
      const ex = col.get(id);
      if (!ex) throw new Error(`Doc ${colName}/${id} not found for update`);
      col.set(id, { ...ex, ...patch });
    },
    async set(data) {
      getCol(colName).set(id, JSON.parse(JSON.stringify(data)));
    },
  });

  return {
    collection(name: string) {
      return {
        doc(id?: string) {
          return makeDocRef(name, id ?? `auto_${++idCounter}`);
        },
        where(field: string, op: string, value: unknown) {
          const filters = [{ field, op, value }];
          const q: {
            where(f: string, o: string, v: unknown): typeof q;
            limit(n: number): typeof q;
            get(): Promise<{
              docs: { id: string; data(): DocData; ref: DocRef }[];
              empty: boolean;
            }>;
          } = {
            where(f, o, v) {
              filters.push({ field: f, op: o, value: v });
              return q;
            },
            limit(_n) {
              return q;
            },
            async get() {
              const col = getCol(name);
              const docs = Array.from(col.entries())
                .filter(([, d]) => filters.every((f) => applyFilter(d, f)))
                .map(([docId, d]) => ({
                  id: docId,
                  data: () => ({ ...d }),
                  ref: makeDocRef(name, docId),
                }));
              return { docs, empty: docs.length === 0 };
            },
          };
          return q;
        },
      };
    },

    /**
     * Serialized transaction with rollback:
     * - Writes are staged in pending arrays.
     * - Applied atomically after callback resolves.
     * - Discarded (rollback) if callback throws.
     */
    async runTransaction(cb: (tx: unknown) => Promise<unknown>) {
      const run = async () => {
        const stagedSets: Array<{ ref: DocRef; data: DocData }> = [];
        const stagedUpdates: Array<{ ref: DocRef; patch: DocData }> = [];

        const tx = {
          get: async (docRef: DocRef) => docRef.get(),
          update(docRef: DocRef, patch: DocData) {
            stagedUpdates.push({ ref: docRef, patch });
          },
          set(docRef: DocRef, data: DocData) {
            stagedSets.push({ ref: docRef, data });
          },
        };

        const result = await cb(tx);

        // Commit staged writes only on success
        for (const { ref, patch } of stagedUpdates) await ref.update(patch);
        for (const { ref, data } of stagedSets) await ref.set(data);

        return result;
      };

      const result = lock.then(run, run);
      lock = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    },

    getCollectionData(name: string): Record<string, DocData> {
      return Object.fromEntries(getCol(name).entries());
    },

    reset(state: Record<string, Record<string, DocData>>) {
      loadInitial(state);
      idCounter = 0;
    },
  };
}

// --- Data factories ---

const EXPIRED_AT = new Date("2026-06-22T11:00:00.000Z");
const FUTURE_AT = new Date("2026-06-22T13:00:00.000Z");

function makeProductoGlobal(fisica: number, reservada = 0): DocData {
  const disponible = Math.max(0, fisica - reservada);
  return {
    existencias: disponible,
    tallaIds: [],
    inventarioPorTalla: [],
    inventarioGlobal: { fisica, reservada, noDisponible: 0, entrante: 0, disponible },
  };
}

function makeProductoConTallas(
  tallas: Array<{ tallaId: string; fisica: number; reservada?: number }>,
): DocData {
  const inventarioPorTalla = tallas.map(({ tallaId, fisica, reservada = 0 }) => ({
    tallaId,
    cantidad: Math.max(0, fisica - reservada),
    fisica,
    reservada,
    noDisponible: 0,
    entrante: 0,
  }));
  return {
    tallaIds: tallas.map((t) => t.tallaId),
    inventarioPorTalla,
    existencias: inventarioPorTalla.reduce((s, r) => s + r.cantidad, 0),
  };
}

function makeOrden(productoId: string, cantidad: number, tallaId?: string): DocData {
  const item: DocData = { productoId, cantidad };
  if (tallaId) item.tallaId = tallaId;
  return { usuarioId: "user_test", items: [item] };
}

function makeReservaActiva(
  ordenId: string,
  productoId: string,
  tallaId: string | null = null,
  cantidad = 1,
): DocData {
  const data: DocData = {
    ordenId,
    productoId,
    tallaId,
    cantidad,
    estado: "activa",
    expiraEn: FUTURE_AT,
    createdAt: NOW,
    idempotencyKey: "reserve:" + ordenId + ":" + productoId + ":" + (tallaId ?? "_"),
  };
  return data;
}

// --- Import service under test ---

import inventoryReservationService from "../src/services/inventory-reservation.service";
import { EstadoReservaInventario } from "../src/models/inventario.model";

// ============================================================================
// Suite
// ============================================================================

describe("Suite de concurrencia de inventario - 20 escenarios", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    fakeFirestore = createFakeFirestore({
      ordenes: {},
      productos: {},
      reservasInventario: {},
      movimientosInventario: {},
    });
  });

  // Escenario 1 ----------------------------------------------------------------
  it("1. Producto 1 unidad, 2 usuarios concurrentes: 1 acepta y 1 rechaza", async () => {
    fakeFirestore.reset({
      ordenes: {
        ord_a: makeOrden("prod_1u", 1),
        ord_b: makeOrden("prod_1u", 1),
      },
      productos: { prod_1u: makeProductoGlobal(1) },
      reservasInventario: {},
      movimientosInventario: {},
    });

    const results = await Promise.allSettled([
      inventoryReservationService.reserveForOrder({ ordenId: "ord_a", idempotencyPrefix: "pa_a" }),
      inventoryReservationService.reserveForOrder({ ordenId: "ord_b", idempotencyPrefix: "pa_b" }),
    ]);

    const ok = results.filter((r) => r.status === "fulfilled");
    const fail = results.filter((r) => r.status === "rejected");

    expect(ok).toHaveLength(1);
    expect(fail).toHaveLength(1);
    expect((fail[0] as PromiseRejectedResult).reason.message).toMatch(/Stock insuficiente/i);

    const p = fakeFirestore.getCollectionData("productos").prod_1u as {
      inventarioGlobal: { fisica: number; reservada: number; disponible: number };
    };
    expect(p.inventarioGlobal).toMatchObject({ fisica: 1, reservada: 1, disponible: 0 });

    const reservas = Object.values(fakeFirestore.getCollectionData("reservasInventario"));
    expect(reservas.filter((r) => r.estado === "activa")).toHaveLength(1);
    expect(reservas.filter((m) => m.tipo === "venta")).toHaveLength(0);

    const movs = Object.values(fakeFirestore.getCollectionData("movimientosInventario"));
    expect(movs.filter((m) => m.tipo === "venta")).toHaveLength(0);
    expect(movs.filter((m) => m.tipo === "reserva")).toHaveLength(1);
  });

  // Escenario 2 ----------------------------------------------------------------
  it("2. Producto 5 unidades, 20 solicitudes concurrentes: exactamente 5 aceptadas", async () => {
    const UNITS = 5;
    const REQUESTS = 20;
    const ordenes: Record<string, DocData> = {};
    for (let i = 0; i < REQUESTS; i++) ordenes["ord2_" + i] = makeOrden("prod_5u", 1);

    fakeFirestore.reset({
      ordenes,
      productos: { prod_5u: makeProductoGlobal(UNITS) },
      reservasInventario: {},
      movimientosInventario: {},
    });

    const calls = Array.from({ length: REQUESTS }, (_, i) =>
      inventoryReservationService.reserveForOrder({
        ordenId: "ord2_" + i,
        idempotencyPrefix: "pa2_" + i,
      }),
    );
    const results = await Promise.allSettled(calls);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(UNITS);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(REQUESTS - UNITS);

    const p = fakeFirestore.getCollectionData("productos").prod_5u as {
      inventarioGlobal: { fisica: number; reservada: number; disponible: number };
    };
    expect(p.inventarioGlobal.fisica).toBe(UNITS);
    expect(p.inventarioGlobal.reservada).toBe(UNITS);
    expect(p.inventarioGlobal.disponible).toBe(0);
    expect(p.inventarioGlobal.disponible).toBeGreaterThanOrEqual(0);

    const activas = Object.values(fakeFirestore.getCollectionData("reservasInventario")).filter(
      (r) => r.estado === "activa",
    );
    expect(activas).toHaveLength(UNITS);
  });

  // Escenario 3 ----------------------------------------------------------------
  it("3. 2 compras simultaneas tallas distintas (1 unidad c/u): ambas aceptadas", async () => {
    fakeFirestore.reset({
      ordenes: {
        ord3s: { items: [{ productoId: "prod_sized", cantidad: 1, tallaId: "S" }] },
        ord3m: { items: [{ productoId: "prod_sized", cantidad: 1, tallaId: "M" }] },
      },
      productos: {
        prod_sized: makeProductoConTallas([
          { tallaId: "S", fisica: 1 },
          { tallaId: "M", fisica: 1 },
        ]),
      },
      reservasInventario: {},
      movimientosInventario: {},
    });

    const results = await Promise.allSettled([
      inventoryReservationService.reserveForOrder({ ordenId: "ord3s", idempotencyPrefix: "pa3s" }),
      inventoryReservationService.reserveForOrder({ ordenId: "ord3m", idempotencyPrefix: "pa3m" }),
    ]);

    expect(results.every((r) => r.status === "fulfilled")).toBe(true);

    const inv = fakeFirestore.getCollectionData("productos").prod_sized as {
      inventarioPorTalla: Array<{ tallaId: string; cantidad: number; reservada: number }>;
    };
    const s = inv.inventarioPorTalla.find((r) => r.tallaId === "S")!;
    const m = inv.inventarioPorTalla.find((r) => r.tallaId === "M")!;
    expect(s).toMatchObject({ reservada: 1, cantidad: 0 });
    expect(m).toMatchObject({ reservada: 1, cantidad: 0 });
  });

  // Escenario 4 ----------------------------------------------------------------
  it("4. 2 compras simultaneas misma talla (1 unidad): 1 acepta, 1 rechaza", async () => {
    fakeFirestore.reset({
      ordenes: {
        ord4c: { items: [{ productoId: "prod_1s", cantidad: 1, tallaId: "S" }] },
        ord4d: { items: [{ productoId: "prod_1s", cantidad: 1, tallaId: "S" }] },
      },
      productos: { prod_1s: makeProductoConTallas([{ tallaId: "S", fisica: 1 }]) },
      reservasInventario: {},
      movimientosInventario: {},
    });

    const results = await Promise.allSettled([
      inventoryReservationService.reserveForOrder({ ordenId: "ord4c", idempotencyPrefix: "pa4c" }),
      inventoryReservationService.reserveForOrder({ ordenId: "ord4d", idempotencyPrefix: "pa4d" }),
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);

    const inv = fakeFirestore.getCollectionData("productos").prod_1s as {
      inventarioPorTalla: Array<{ tallaId: string; cantidad: number; reservada: number }>;
    };
    const s = inv.inventarioPorTalla.find((r) => r.tallaId === "S")!;
    expect(s.reservada).toBe(1);
    expect(s.cantidad).toBe(0);
  });

  // Escenario 5 ----------------------------------------------------------------
  it("5. Doble clic pago (mismo ordenId): idempotente, 1 reserva, stock decrementado 1 vez", async () => {
    fakeFirestore.reset({
      ordenes: { ord5: makeOrden("prod_dc", 1) },
      productos: { prod_dc: makeProductoGlobal(3) },
      reservasInventario: {},
      movimientosInventario: {},
    });

    const results = await Promise.allSettled([
      inventoryReservationService.reserveForOrder({ ordenId: "ord5", idempotencyPrefix: "pa5" }),
      inventoryReservationService.reserveForOrder({ ordenId: "ord5", idempotencyPrefix: "pa5" }),
    ]);

    expect(results.every((r) => r.status === "fulfilled")).toBe(true);

    const reservas = Object.values(fakeFirestore.getCollectionData("reservasInventario"));
    expect(reservas).toHaveLength(1);

    const p = fakeFirestore.getCollectionData("productos").prod_dc as {
      inventarioGlobal: { reservada: number; disponible: number };
    };
    expect(p.inventarioGlobal.reservada).toBe(1);
    expect(p.inventarioGlobal.disponible).toBe(2);
  });

  // Escenario 6 ----------------------------------------------------------------
  it("6. Mismo usuario, 2 pestanas (ordenes distintas), 1 unidad: 1 acepta, 1 rechaza", async () => {
    fakeFirestore.reset({
      ordenes: {
        ord6t1: { usuarioId: "same_user", items: [{ productoId: "prod_tab", cantidad: 1 }] },
        ord6t2: { usuarioId: "same_user", items: [{ productoId: "prod_tab", cantidad: 1 }] },
      },
      productos: { prod_tab: makeProductoGlobal(1) },
      reservasInventario: {},
      movimientosInventario: {},
    });

    const results = await Promise.allSettled([
      inventoryReservationService.reserveForOrder({
        ordenId: "ord6t1",
        usuarioId: "same_user",
        idempotencyPrefix: "pa6t1",
      }),
      inventoryReservationService.reserveForOrder({
        ordenId: "ord6t2",
        usuarioId: "same_user",
        idempotencyPrefix: "pa6t2",
      }),
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);

    const p = fakeFirestore.getCollectionData("productos").prod_tab as {
      inventarioGlobal: { disponible: number };
    };
    expect(p.inventarioGlobal.disponible).toBe(0);
  });

  // Escenario 7 ----------------------------------------------------------------
  it("7. 2 usuarios distintos, 1 unidad: exactamente 1 acepta, 1 rechaza", async () => {
    fakeFirestore.reset({
      ordenes: {
        ord7u1: { usuarioId: "user_1", items: [{ productoId: "prod_u7", cantidad: 1 }] },
        ord7u2: { usuarioId: "user_2", items: [{ productoId: "prod_u7", cantidad: 1 }] },
      },
      productos: { prod_u7: makeProductoGlobal(1) },
      reservasInventario: {},
      movimientosInventario: {},
    });

    const results = await Promise.allSettled([
      inventoryReservationService.reserveForOrder({
        ordenId: "ord7u1",
        usuarioId: "user_1",
        idempotencyPrefix: "pa7u1",
      }),
      inventoryReservationService.reserveForOrder({
        ordenId: "ord7u2",
        usuarioId: "user_2",
        idempotencyPrefix: "pa7u2",
      }),
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
  });

  // Escenario 8 ----------------------------------------------------------------
  it("8. Misma clave idempotencia (mismo ordenId): devuelve reserva anterior sin re-aplicar efectos", async () => {
    fakeFirestore.reset({
      ordenes: { ord8: makeOrden("prod_idem", 1) },
      productos: { prod_idem: makeProductoGlobal(5) },
      reservasInventario: {},
      movimientosInventario: {},
    });

    await inventoryReservationService.reserveForOrder({
      ordenId: "ord8",
      idempotencyPrefix: "pa8",
    });
    const stockAfterFirst = (
      fakeFirestore.getCollectionData("productos").prod_idem as {
        inventarioGlobal: { reservada: number; disponible: number };
      }
    ).inventarioGlobal;

    await inventoryReservationService.reserveForOrder({
      ordenId: "ord8",
      idempotencyPrefix: "pa8",
    });
    const stockAfterSecond = (
      fakeFirestore.getCollectionData("productos").prod_idem as {
        inventarioGlobal: { reservada: number; disponible: number };
      }
    ).inventarioGlobal;

    expect(stockAfterSecond.reservada).toBe(stockAfterFirst.reservada);
    expect(stockAfterSecond.disponible).toBe(stockAfterFirst.disponible);

    const activas = Object.values(fakeFirestore.getCollectionData("reservasInventario")).filter(
      (r) => r.estado === "activa",
    );
    expect(activas).toHaveLength(1);
  });

  // Escenario 9 ----------------------------------------------------------------
  it("9. Claves idempotencia distintas, stock suficiente: ambas aceptadas", async () => {
    fakeFirestore.reset({
      ordenes: {
        ord9k1: makeOrden("prod_k9", 1),
        ord9k2: makeOrden("prod_k9", 1),
      },
      productos: { prod_k9: makeProductoGlobal(5) },
      reservasInventario: {},
      movimientosInventario: {},
    });

    const results = await Promise.allSettled([
      inventoryReservationService.reserveForOrder({ ordenId: "ord9k1", idempotencyPrefix: "pa9k1" }),
      inventoryReservationService.reserveForOrder({ ordenId: "ord9k2", idempotencyPrefix: "pa9k2" }),
    ]);

    expect(results.every((r) => r.status === "fulfilled")).toBe(true);

    const activas = Object.values(fakeFirestore.getCollectionData("reservasInventario")).filter(
      (r) => r.estado === "activa",
    );
    expect(activas).toHaveLength(2);

    const p = fakeFirestore.getCollectionData("productos").prod_k9 as {
      inventarioGlobal: { reservada: number; disponible: number };
    };
    expect(p.inventarioGlobal.reservada).toBe(2);
    expect(p.inventarioGlobal.disponible).toBe(3);
  });

  // Escenario 10 ---------------------------------------------------------------
  it("10. Webhook pago exitoso duplicado: exactamente 1 movimiento de venta", async () => {
    fakeFirestore.reset({
      ordenes: { ord10: makeOrden("prod_p10", 1) },
      productos: {
        prod_p10: {
          existencias: 0,
          tallaIds: [],
          inventarioPorTalla: [],
          inventarioGlobal: { fisica: 1, reservada: 1, noDisponible: 0, entrante: 0, disponible: 0 },
        },
      },
      reservasInventario: {
        res10: makeReservaActiva("ord10", "prod_p10"),
      },
      movimientosInventario: {},
    });

    await Promise.all([
      inventoryReservationService.confirmOrderReservations("ord10", "user10"),
      inventoryReservationService.confirmOrderReservations("ord10", "user10"),
    ]);

    const ventas = Object.values(fakeFirestore.getCollectionData("movimientosInventario")).filter(
      (m) => m.tipo === "venta",
    );
    expect(ventas).toHaveLength(1);

    const reserva = fakeFirestore.getCollectionData("reservasInventario").res10;
    expect(reserva.estado).toBe(EstadoReservaInventario.CONFIRMADA);

    const p = fakeFirestore.getCollectionData("productos").prod_p10 as {
      inventarioGlobal: { fisica: number; reservada: number; disponible: number };
    };
    expect(p.inventarioGlobal).toMatchObject({ fisica: 0, reservada: 0, disponible: 0 });
  });

  // Escenario 11 ---------------------------------------------------------------
  it("11. Eventos fuera de orden (liberar → confirmar tardio): confirmar es no-op", async () => {
    fakeFirestore.reset({
      ordenes: { ord11: makeOrden("prod_oof", 1) },
      productos: {
        prod_oof: {
          existencias: 2,
          tallaIds: [],
          inventarioPorTalla: [],
          inventarioGlobal: { fisica: 3, reservada: 1, noDisponible: 0, entrante: 0, disponible: 2 },
        },
      },
      reservasInventario: { res11: makeReservaActiva("ord11", "prod_oof") },
      movimientosInventario: {},
    });

    // Libera primero (pago fallido)
    await inventoryReservationService.releaseOrderReservations({
      ordenId: "ord11",
      motivo: "Pago fallido",
    });

    const p_release = fakeFirestore.getCollectionData("productos").prod_oof as {
      inventarioGlobal: { reservada: number; disponible: number };
    };
    expect(p_release.inventarioGlobal.reservada).toBe(0);
    expect(p_release.inventarioGlobal.disponible).toBe(3);

    // Luego llega webhook tardio de pago exitoso -> no-op
    await inventoryReservationService.confirmOrderReservations("ord11", "user11");

    const ventas = Object.values(fakeFirestore.getCollectionData("movimientosInventario")).filter(
      (m) => m.tipo === "venta",
    );
    expect(ventas).toHaveLength(0);

    const p_final = fakeFirestore.getCollectionData("productos").prod_oof as {
      inventarioGlobal: { fisica: number; reservada: number; disponible: number };
    };
    expect(p_final.inventarioGlobal).toMatchObject({ fisica: 3, reservada: 0, disponible: 3 });
  });

  // Escenario 12 ---------------------------------------------------------------
  it("12. Pago fallido: reserva LIBERADA, stock restaurado, sin movimiento de venta", async () => {
    fakeFirestore.reset({
      ordenes: { ord12: makeOrden("prod_f12", 1) },
      productos: {
        prod_f12: {
          existencias: 4,
          tallaIds: [],
          inventarioPorTalla: [],
          inventarioGlobal: { fisica: 5, reservada: 1, noDisponible: 0, entrante: 0, disponible: 4 },
        },
      },
      reservasInventario: { res12: makeReservaActiva("ord12", "prod_f12") },
      movimientosInventario: {},
    });

    await inventoryReservationService.releaseOrderReservations({
      ordenId: "ord12",
      motivo: "Pago fallido",
    });

    const res = fakeFirestore.getCollectionData("reservasInventario").res12;
    expect(res.estado).toBe(EstadoReservaInventario.LIBERADA);

    const p = fakeFirestore.getCollectionData("productos").prod_f12 as {
      inventarioGlobal: { fisica: number; reservada: number; disponible: number };
    };
    expect(p.inventarioGlobal).toMatchObject({ fisica: 5, reservada: 0, disponible: 5 });

    const ventas = Object.values(fakeFirestore.getCollectionData("movimientosInventario")).filter(
      (m) => m.tipo === "venta",
    );
    expect(ventas).toHaveLength(0);

    const liberas = Object.values(fakeFirestore.getCollectionData("movimientosInventario")).filter(
      (m) => m.tipo === "liberacion_reserva",
    );
    expect(liberas).toHaveLength(1);
  });

  // Escenario 13 ---------------------------------------------------------------
  it("13. Pago cancelado: reserva LIBERADA, unidad disponible para otro usuario", async () => {
    fakeFirestore.reset({
      ordenes: {
        ord13a: makeOrden("prod_c13", 1),
        ord13b: makeOrden("prod_c13", 1),
      },
      productos: {
        prod_c13: {
          existencias: 0,
          tallaIds: [],
          inventarioPorTalla: [],
          inventarioGlobal: { fisica: 1, reservada: 1, noDisponible: 0, entrante: 0, disponible: 0 },
        },
      },
      reservasInventario: { res13: makeReservaActiva("ord13a", "prod_c13") },
      movimientosInventario: {},
    });

    await inventoryReservationService.releaseOrderReservations({
      ordenId: "ord13a",
      motivo: "Pago cancelado por usuario",
    });

    const res = fakeFirestore.getCollectionData("reservasInventario").res13;
    expect(res.estado).toBe(EstadoReservaInventario.LIBERADA);

    // Stock disponible de nuevo
    const p = fakeFirestore.getCollectionData("productos").prod_c13 as {
      inventarioGlobal: { disponible: number };
    };
    expect(p.inventarioGlobal.disponible).toBe(1);

    // Otro usuario puede reservar
    const nextReserve = await inventoryReservationService.reserveForOrder({
      ordenId: "ord13b",
      idempotencyPrefix: "pa13b",
    });
    expect(nextReserve).toHaveLength(1);
    expect(nextReserve[0].estado).toBe(EstadoReservaInventario.ACTIVA);
  });

  // Escenario 14 ---------------------------------------------------------------
  it("14. Sesion expirada: expireDueReservations marca EXPIRADA y restaura stock", async () => {
    fakeFirestore.reset({
      ordenes: { ord14: makeOrden("prod_exp14", 1) },
      productos: {
        prod_exp14: {
          existencias: 2,
          tallaIds: [],
          inventarioPorTalla: [],
          inventarioGlobal: { fisica: 3, reservada: 1, noDisponible: 0, entrante: 0, disponible: 2 },
        },
      },
      reservasInventario: {
        res14: {
          ...makeReservaActiva("ord14", "prod_exp14"),
          expiraEn: EXPIRED_AT,
        },
      },
      movimientosInventario: {},
    });

    const count = await inventoryReservationService.expireDueReservations(100);
    expect(count).toBe(1);

    const res = fakeFirestore.getCollectionData("reservasInventario").res14;
    expect(res.estado).toBe(EstadoReservaInventario.EXPIRADA);

    const p = fakeFirestore.getCollectionData("productos").prod_exp14 as {
      inventarioGlobal: { reservada: number; disponible: number };
    };
    expect(p.inventarioGlobal.reservada).toBe(0);
    expect(p.inventarioGlobal.disponible).toBe(3);
  });

  // Escenario 15 ---------------------------------------------------------------
  it("15. Error durante transaccion (producto no existe): excepcion, sin cambios de inventario", async () => {
    fakeFirestore.reset({
      ordenes: { ord15: { items: [{ productoId: "PROD_GHOST", cantidad: 1 }] } },
      productos: {},
      reservasInventario: {},
      movimientosInventario: {},
    });

    await expect(
      inventoryReservationService.reserveForOrder({
        ordenId: "ord15",
        idempotencyPrefix: "pa15",
      }),
    ).rejects.toThrow(/Producto con ID PROD_GHOST no encontrado/i);

    expect(Object.keys(fakeFirestore.getCollectionData("reservasInventario"))).toHaveLength(0);
    expect(Object.keys(fakeFirestore.getCollectionData("movimientosInventario"))).toHaveLength(0);
  });

  // Escenario 16 ---------------------------------------------------------------
  it("16. 50 solicitudes concurrentes: disponible nunca negativo, exactamente UNITS aceptadas", async () => {
    const UNITS = 10;
    const REQUESTS = 50;
    const ordenes: Record<string, DocData> = {};
    for (let i = 0; i < REQUESTS; i++) ordenes["ord16_" + i] = makeOrden("prod_s16", 1);

    fakeFirestore.reset({
      ordenes,
      productos: { prod_s16: makeProductoGlobal(UNITS) },
      reservasInventario: {},
      movimientosInventario: {},
    });

    const results = await Promise.allSettled(
      Array.from({ length: REQUESTS }, (_, i) =>
        inventoryReservationService.reserveForOrder({
          ordenId: "ord16_" + i,
          idempotencyPrefix: "pa16_" + i,
        }),
      ),
    );

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(UNITS);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(REQUESTS - UNITS);

    const p = fakeFirestore.getCollectionData("productos").prod_s16 as {
      inventarioGlobal: { fisica: number; reservada: number; disponible: number };
    };
    // Invariante critica: nunca negativo
    expect(p.inventarioGlobal.disponible).toBeGreaterThanOrEqual(0);
    expect(p.inventarioGlobal.reservada).toBeLessThanOrEqual(p.inventarioGlobal.fisica);
    expect(p.inventarioGlobal.disponible).toBe(0);
    expect(p.inventarioGlobal.reservada).toBe(UNITS);
  });

  // Escenario 17 ---------------------------------------------------------------
  it("17. Liberacion automatica de reservas vencidas: todas expiradas y stock restaurado", async () => {
    fakeFirestore.reset({
      ordenes: {
        ord17a: makeOrden("prod_v17", 1),
        ord17b: makeOrden("prod_v17", 1),
        ord17c: makeOrden("prod_v17", 1),
      },
      productos: {
        prod_v17: {
          existencias: 0,
          tallaIds: [],
          inventarioPorTalla: [],
          inventarioGlobal: { fisica: 3, reservada: 3, noDisponible: 0, entrante: 0, disponible: 0 },
        },
      },
      reservasInventario: {
        res17a: { ...makeReservaActiva("ord17a", "prod_v17"), expiraEn: EXPIRED_AT },
        res17b: { ...makeReservaActiva("ord17b", "prod_v17"), expiraEn: EXPIRED_AT },
        res17c: { ...makeReservaActiva("ord17c", "prod_v17"), expiraEn: EXPIRED_AT },
      },
      movimientosInventario: {},
    });

    const expired = await inventoryReservationService.expireDueReservations(100);
    expect(expired).toBe(3);

    Object.values(fakeFirestore.getCollectionData("reservasInventario")).forEach((r) => {
      expect(r.estado).toBe(EstadoReservaInventario.EXPIRADA);
    });

    const p = fakeFirestore.getCollectionData("productos").prod_v17 as {
      inventarioGlobal: { fisica: number; reservada: number; disponible: number };
    };
    expect(p.inventarioGlobal).toMatchObject({ fisica: 3, reservada: 0, disponible: 3 });
  });

  // Escenario 18 ---------------------------------------------------------------
  it("18. Confirmar reserva ya liberada: no-op, sin movimiento de venta, stock sin cambio", async () => {
    fakeFirestore.reset({
      ordenes: { ord18: makeOrden("prod_c18", 1) },
      productos: { prod_c18: makeProductoGlobal(5) },
      reservasInventario: {
        res18: {
          ...makeReservaActiva("ord18", "prod_c18"),
          estado: EstadoReservaInventario.LIBERADA,
        },
      },
      movimientosInventario: {},
    });

    await inventoryReservationService.confirmOrderReservations("ord18", "user18");

    const ventas = Object.values(fakeFirestore.getCollectionData("movimientosInventario")).filter(
      (m) => m.tipo === "venta",
    );
    expect(ventas).toHaveLength(0);

    const p = fakeFirestore.getCollectionData("productos").prod_c18 as {
      inventarioGlobal: { fisica: number; reservada: number; disponible: number };
    };
    expect(p.inventarioGlobal).toMatchObject({ fisica: 5, reservada: 0, disponible: 5 });
  });

  // Escenario 19 ---------------------------------------------------------------
  it("19. Liberar reserva ya confirmada: no-op, sin movimiento de liberacion, stock sin cambio", async () => {
    fakeFirestore.reset({
      ordenes: { ord19: makeOrden("prod_c19", 1) },
      productos: {
        prod_c19: {
          existencias: 0,
          tallaIds: [],
          inventarioPorTalla: [],
          inventarioGlobal: { fisica: 0, reservada: 0, noDisponible: 0, entrante: 0, disponible: 0 },
        },
      },
      reservasInventario: {
        res19: {
          ...makeReservaActiva("ord19", "prod_c19"),
          estado: EstadoReservaInventario.CONFIRMADA,
        },
      },
      movimientosInventario: {},
    });

    await inventoryReservationService.releaseOrderReservations({
      ordenId: "ord19",
      motivo: "Intento tardio de liberar reserva ya confirmada",
    });

    const liberas = Object.values(fakeFirestore.getCollectionData("movimientosInventario")).filter(
      (m) => m.tipo === "liberacion_reserva",
    );
    expect(liberas).toHaveLength(0);

    const p = fakeFirestore.getCollectionData("productos").prod_c19 as {
      inventarioGlobal: { fisica: number; reservada: number; disponible: number };
    };
    expect(p.inventarioGlobal).toMatchObject({ fisica: 0, reservada: 0, disponible: 0 });
  });

  // Escenario 20 ---------------------------------------------------------------
  it("20. Ultima unidad, 100 iteraciones: siempre exactamente 1 ganador", async () => {
    const ITERATIONS = 100;

    for (let iter = 0; iter < ITERATIONS; iter++) {
      fakeFirestore.reset({
        ordenes: {
          ["ord20a_" + iter]: makeOrden("prod_last100", 1),
          ["ord20b_" + iter]: makeOrden("prod_last100", 1),
        },
        productos: { prod_last100: makeProductoGlobal(1) },
        reservasInventario: {},
        movimientosInventario: {},
      });

      const results = await Promise.allSettled([
        inventoryReservationService.reserveForOrder({
          ordenId: "ord20a_" + iter,
          idempotencyPrefix: "pa20a_" + iter,
        }),
        inventoryReservationService.reserveForOrder({
          ordenId: "ord20b_" + iter,
          idempotencyPrefix: "pa20b_" + iter,
        }),
      ]);

      const okCount = results.filter((r) => r.status === "fulfilled").length;
      const failCount = results.filter((r) => r.status === "rejected").length;

      expect(okCount).toBe(1);
      expect(failCount).toBe(1);

      const p = fakeFirestore.getCollectionData("productos").prod_last100 as {
        inventarioGlobal: { fisica: number; reservada: number; disponible: number };
      };
      expect(p.inventarioGlobal.fisica).toBe(1);
      expect(p.inventarioGlobal.reservada).toBe(1);
      expect(p.inventarioGlobal.disponible).toBe(0);

      const activas = Object.values(
        fakeFirestore.getCollectionData("reservasInventario"),
      ).filter((r) => r.estado === "activa");
      expect(activas).toHaveLength(1);

      const movs = Object.values(
        fakeFirestore.getCollectionData("movimientosInventario"),
      ).filter((m) => m.tipo === "venta");
      expect(movs).toHaveLength(0);
    }
  }, 60_000);
});
