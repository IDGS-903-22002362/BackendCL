/**
 * Concurrencia del POS contra el router real.
 *
 * Todas las carreras se lanzan con `Promise.all` sobre el mismo doble de Firestore, que
 * simula el control optimista real: relee versiones al confirmar y aborta la transacción
 * cuando otra escribió antes. Se verifica que exactamente una operación gane y que el
 * estado final no quede corrupto (sin inventario negativo, sin pagos duplicados, sin dos
 * cierres del mismo día).
 *
 * El arnés debe importarse primero: registra los mocks de infraestructura.
 */

import {
  buildPosTestApp,
  resetPosTestState,
  tiendaDb,
} from "./helpers/pos-test-harness";
import {
  ADMIN_UID,
  api,
  CASHIER_TWO_UID,
  CASHIER_UID,
  denominationsFor,
  expectStatus,
  openRegisterWithShift,
  seedCatalog,
  seedStaff,
  SENIOR_UID,
  SUPER_ADMIN_UID,
  SUPERVISOR_TWO_UID,
  SUPERVISOR_UID,
} from "./helpers/pos-scenario";

const app = buildPosTestApp();
const client = api(app);

/** Prepara una venta en `PAYMENT_PENDING` lista para cobrar. */
async function pendingSale(
  cashierUid: string,
  productoId: string,
  quantity = 1,
): Promise<{ saleId: string; totalMinor: number; itemId: string }> {
  const sale = await client.post("/api/pos/v1/sales", cashierUid, {});
  expectStatus(sale, 201);
  const saleId = sale.body.sale.id as string;

  const item = await client.post(`/api/pos/v1/sales/${saleId}/items`, cashierUid, {
    productoId,
    quantity,
  });
  expectStatus(item, 201);

  const preview = await client.post(
    `/api/pos/v1/sales/${saleId}/checkout-preview`,
    cashierUid,
  );
  expectStatus(preview, 200);

  return {
    saleId,
    totalMinor: item.body.sale.totals.totalMinor as number,
    itemId: item.body.sale.items[0].itemId as string,
  };
}

const statusesOf = (responses: Array<{ status: number }>): number[] =>
  responses.map((response) => response.status).sort((a, b) => a - b);

describe("POS · concurrencia", () => {
  beforeEach(() => {
    resetPosTestState();
    seedStaff();
    seedCatalog();
  });

  it("solo una de dos aperturas simultáneas de la misma caja gana", async () => {
    const created = await client.post("/api/pos/v1/registers", ADMIN_UID, {
      code: "CAJA01",
      name: "Caja 01",
    });
    expectStatus(created, 201);
    const registerId = created.body.register.id as string;

    const [first, second] = await Promise.all([
      client.post(`/api/pos/v1/registers/${registerId}/open`, CASHIER_UID, {
        openingFloatMinor: 100_000,
      }),
      client.post(`/api/pos/v1/registers/${registerId}/open`, CASHIER_TWO_UID, {
        openingFloatMinor: 100_000,
      }),
    ]);

    const results = [first, second];
    expect(results.filter((response) => response.status === 201)).toHaveLength(1);
    const loser = results.find((response) => response.status !== 201)!;
    expect(loser.status).toBeGreaterThanOrEqual(409);

    // Una sola sesión abierta y un solo turno activo en la caja.
    const sessions = tiendaDb
      .listAll("posRegisterSessions")
      .filter((session) => session.registerId === registerId);
    expect(sessions).toHaveLength(1);
    const shifts = tiendaDb
      .listAll("posShifts")
      .filter((shift) => shift.registerId === registerId);
    expect(shifts).toHaveLength(1);
  });

  it("un cajero no puede tener dos turnos activos en cajas distintas", async () => {
    const first = await client.post("/api/pos/v1/registers", ADMIN_UID, {
      code: "CAJA01",
      name: "Caja 01",
    });
    expectStatus(first, 201);
    const second = await client.post("/api/pos/v1/registers", ADMIN_UID, {
      code: "CAJA02",
      name: "Caja 02",
    });
    expectStatus(second, 201);

    const responses = await Promise.all([
      client.post(
        `/api/pos/v1/registers/${first.body.register.id}/open`,
        CASHIER_UID,
        { openingFloatMinor: 100_000 },
      ),
      client.post(
        `/api/pos/v1/registers/${second.body.register.id}/open`,
        CASHIER_UID,
        { openingFloatMinor: 100_000 },
      ),
    ]);

    expect(responses.filter((response) => response.status === 201)).toHaveLength(1);
    const active = tiendaDb
      .listAll("posShifts")
      .filter((shift) => shift.cashierUid === CASHIER_UID && shift.status === "ACTIVE");
    expect(active).toHaveLength(1);
  });

  it("cuatro cajas compiten por tres unidades y solo tres ventas se confirman", async () => {
    const cashiers = [CASHIER_UID, CASHIER_TWO_UID, SENIOR_UID, SUPERVISOR_UID];
    const sales: Array<{ cashierUid: string; saleId: string; totalMinor: number }> = [];

    for (const [index, cashierUid] of cashiers.entries()) {
      await openRegisterWithShift(app, {
        code: `CAJA0${index + 1}`,
        cashierUid,
      });
      const sale = await pendingSale(cashierUid, "prod-llavero");
      sales.push({ cashierUid, saleId: sale.saleId, totalMinor: sale.totalMinor });
    }

    // prod-llavero tiene 3 unidades: la cuarta venta debe fallar por inventario.
    const responses = await Promise.all(
      sales.map((sale) =>
        client.post(
          `/api/pos/v1/sales/${sale.saleId}/payments/cash`,
          sale.cashierUid,
          { receivedMinor: sale.totalMinor },
        ),
      ),
    );

    const paid = responses.filter((response) => response.status === 201);
    const rejected = responses.filter((response) => response.status !== 201);
    expect(paid).toHaveLength(3);
    expect(rejected).toHaveLength(1);
    expect(["INSUFFICIENT_STOCK", "CONCURRENT_MODIFICATION"]).toContain(
      rejected[0].body.code,
    );

    // Inventario exacto, nunca negativo, y un movimiento por unidad vendida.
    const producto = tiendaDb.read("productos", "prod-llavero");
    expect(producto?.existencias).toBe(0);
    expect(producto?.inventarioGlobal).toMatchObject({ fisica: 0, disponible: 0 });

    const movimientos = tiendaDb
      .listAll("movimientosInventario")
      .filter((movimiento) => movimiento.productoId === "prod-llavero");
    expect(movimientos).toHaveLength(3);

    // Ninguna venta pagada quedó sin descuento de inventario.
    const paidSales = tiendaDb
      .listAll("posSales")
      .filter((sale) => sale.status === "PAID");
    expect(paidSales).toHaveLength(3);
  });

  it("dos solicitudes de pago de la misma venta no duplican el cobro", async () => {
    await openRegisterWithShift(app, { code: "CAJA01", cashierUid: CASHIER_UID });
    const sale = await pendingSale(CASHIER_UID, "prod-jersey");

    const responses = await Promise.all([
      client.post(`/api/pos/v1/sales/${sale.saleId}/payments/cash`, CASHIER_UID, {
        receivedMinor: sale.totalMinor,
      }),
      client.post(`/api/pos/v1/sales/${sale.saleId}/payments/cash`, CASHIER_UID, {
        receivedMinor: sale.totalMinor,
      }),
    ]);

    expect(responses.filter((response) => response.status === 201)).toHaveLength(1);

    const payments = tiendaDb
      .listAll("posPayments")
      .filter((payment) => payment.saleId === sale.saleId);
    expect(payments).toHaveLength(1);

    const producto = tiendaDb.read("productos", "prod-jersey");
    expect(producto?.existencias).toBe(9);
  });

  it("el reintento con la misma Idempotency-Key devuelve el resultado original", async () => {
    await openRegisterWithShift(app, { code: "CAJA01", cashierUid: CASHIER_UID });
    const sale = await pendingSale(CASHIER_UID, "prod-jersey");

    const body = { receivedMinor: sale.totalMinor };
    const options = { idempotencyKey: "pago-unico" };

    const first = await client.post(
      `/api/pos/v1/sales/${sale.saleId}/payments/cash`,
      CASHIER_UID,
      body,
      options,
    );
    expectStatus(first, 201);
    expect(first.headers["idempotency-replayed"]).toBe("false");

    const replay = await client.post(
      `/api/pos/v1/sales/${sale.saleId}/payments/cash`,
      CASHIER_UID,
      body,
      options,
    );
    expect(replay.status).toBe(201);
    expect(replay.headers["idempotency-replayed"]).toBe("true");
    expect(replay.body.payments[0].id).toBe(first.body.payments[0].id);

    // Un solo pago, un solo descuento de inventario.
    expect(
      tiendaDb.listAll("posPayments").filter((p) => p.saleId === sale.saleId),
    ).toHaveLength(1);
    expect(tiendaDb.read("productos", "prod-jersey")?.existencias).toBe(9);
  });

  it("la misma Idempotency-Key con otro payload responde conflicto", async () => {
    await openRegisterWithShift(app, { code: "CAJA01", cashierUid: CASHIER_UID });
    const sale = await pendingSale(CASHIER_UID, "prod-jersey");

    const first = await client.post(
      `/api/pos/v1/sales/${sale.saleId}/payments/cash`,
      CASHIER_UID,
      { amountMinor: 1_000, receivedMinor: 1_000 },
      { idempotencyKey: "pago-conflictivo" },
    );
    expectStatus(first, 201);

    const conflict = await client.post(
      `/api/pos/v1/sales/${sale.saleId}/payments/cash`,
      CASHIER_UID,
      { amountMinor: 2_000, receivedMinor: 2_000 },
      { idempotencyKey: "pago-conflictivo" },
    );
    expect(conflict.status).toBe(409);
    expect(conflict.body.code).toBe("IDEMPOTENCY_CONFLICT");

    expect(
      tiendaDb.listAll("posPayments").filter((p) => p.saleId === sale.saleId),
    ).toHaveLength(1);
  });

  it("dos peticiones concurrentes con la misma clave producen un solo efecto", async () => {
    await openRegisterWithShift(app, { code: "CAJA01", cashierUid: CASHIER_UID });
    const sale = await pendingSale(CASHIER_UID, "prod-jersey");

    const send = () =>
      client.post(
        `/api/pos/v1/sales/${sale.saleId}/payments/cash`,
        CASHIER_UID,
        { receivedMinor: sale.totalMinor },
        { idempotencyKey: "pago-simultaneo" },
      );

    const responses = await Promise.all([send(), send()]);

    // Una gana; la otra recibe replay o "en progreso", nunca un segundo cobro.
    expect(responses.some((response) => response.status === 201)).toBe(true);
    expect(
      tiendaDb.listAll("posPayments").filter((p) => p.saleId === sale.saleId),
    ).toHaveLength(1);
    expect(tiendaDb.read("productos", "prod-jersey")?.existencias).toBe(9);
  });

  it("el envío del conteo deja el corte APPROVED de forma atómica", async () => {
    const opened = await openRegisterWithShift(app, {
      code: "CAJA01",
      cashierUid: CASHIER_UID,
    });

    const started = await client.post(
      `/api/pos/v1/shifts/${opened.shiftId}/start-count`,
      CASHIER_UID,
    );
    expectStatus(started, 201);

    const submitted = await client.post(
      `/api/pos/v1/shifts/${opened.shiftId}/cash-counts`,
      CASHIER_UID,
      { denominations: denominationsFor(100_000) },
    );
    expectStatus(submitted, 201);
    const cutId = submitted.body.cut.id as string;

    expect(submitted.body.cut.status).toBe("APPROVED");
    expect(submitted.body.cut.approverUid).toBe(CASHIER_UID);

    const cut = tiendaDb.read("posCuts", cutId);
    expect(cut?.status).toBe("APPROVED");
    expect(cut?.approverUid).toBe(CASHIER_UID);

    // Un approve posterior no debe mutar el corte ya cerrado.
    const approve = await client.post(`/api/pos/v1/cuts/${cutId}/approve`, SUPERVISOR_UID, {
      observations: "Sin diferencia",
    });
    expect(approve.status).toBeGreaterThanOrEqual(400);
  });

  it("dos administradores no crean dos cierres del mismo día", async () => {
    const opened = await openRegisterWithShift(app, {
      code: "CAJA01",
      cashierUid: CASHIER_UID,
    });

    const started = await client.post(
      `/api/pos/v1/shifts/${opened.shiftId}/start-count`,
      CASHIER_UID,
    );
    expectStatus(started, 201);
    const submitted = await client.post(
      `/api/pos/v1/shifts/${opened.shiftId}/cash-counts`,
      CASHIER_UID,
      { denominations: denominationsFor(100_000) },
    );
    expectStatus(submitted, 201);
    expect(submitted.body.cut.status).toBe("APPROVED");

    const ended = await client.post(
      `/api/pos/v1/shifts/${opened.shiftId}/end`,
      CASHIER_UID,
    );
    expectStatus(ended, 200);
    const closed = await client.post(
      `/api/pos/v1/registers/${opened.registerId}/close`,
      SUPERVISOR_UID,
    );
    expectStatus(closed, 200);

    const responses = await Promise.all([
      client.post(
        `/api/pos/v1/daily-close/${opened.operationalDate}/close`,
        ADMIN_UID,
        undefined,
        { idempotencyKey: "cierre-admin-1" },
      ),
      client.post(
        `/api/pos/v1/daily-close/${opened.operationalDate}/close`,
        SUPER_ADMIN_UID,
        undefined,
        { idempotencyKey: "cierre-admin-2" },
      ),
    ]);

    expect(responses.filter((response) => response.status === 201)).toHaveLength(1);
    expect(tiendaDb.listAll("posDailyClosures")).toHaveLength(1);
    expect(tiendaDb.listAll("posDailyClosures")[0].status).toBe("CLOSED");
  });

  it("dos devoluciones simultáneas no devuelven la misma unidad dos veces", async () => {
    await openRegisterWithShift(app, { code: "CAJA01", cashierUid: CASHIER_UID });
    // Cada supervisora devuelve desde su propio turno: el reembolso sale de su cajón.
    await openRegisterWithShift(app, { code: "CAJA02", cashierUid: SUPERVISOR_UID });
    await openRegisterWithShift(app, {
      code: "CAJA03",
      cashierUid: SUPERVISOR_TWO_UID,
    });
    const sale = await pendingSale(CASHIER_UID, "prod-jersey");
    const paid = await client.post(
      `/api/pos/v1/sales/${sale.saleId}/payments/cash`,
      CASHIER_UID,
      { receivedMinor: sale.totalMinor },
    );
    expectStatus(paid, 201);

    const body = {
      items: [
        {
          itemId: sale.itemId,
          quantity: 1,
          physicalCondition: "RETURNED_RESELLABLE",
        },
      ],
      reason: "El cliente devolvió la prenda",
    };

    const responses = await Promise.all([
      client.post(`/api/pos/v1/sales/${sale.saleId}/returns`, SUPERVISOR_UID, body),
      client.post(`/api/pos/v1/sales/${sale.saleId}/returns`, SUPERVISOR_TWO_UID, body),
    ]);

    expectStatus(responses[0], 201);
    expect(responses.filter((response) => response.status === 201)).toHaveLength(1);
    const rejected = responses.find((response) => response.status !== 201)!;
    expect([
      "RETURN_QUANTITY_EXCEEDED",
      "CONCURRENT_MODIFICATION",
      "RETURN_ALREADY_PROCESSED",
    ]).toContain(rejected.body.code);

    expect(tiendaDb.listAll("posReturns")).toHaveLength(1);
  });

  it("una transferencia solo puede recibirse una vez", async () => {
    // Caja origen operada por la cajera senior (puede solicitar transferencias) y caja
    // destino operada por la supervisora, única que puede confirmar su recepción.
    const source = await openRegisterWithShift(app, {
      code: "CAJA01",
      cashierUid: SENIOR_UID,
    });
    const target = await openRegisterWithShift(app, {
      code: "CAJA02",
      cashierUid: SUPERVISOR_UID,
    });
    expect(source.shiftId).not.toBe(target.shiftId);

    const movement = await client.post("/api/pos/v1/cash-movements", SENIOR_UID, {
      type: "TRANSFER_OUT",
      amountMinor: 20_000,
      reason: "Transferencia a la caja 02",
      targetRegisterId: target.registerId,
    });
    expectStatus(movement, 201);
    const movementId = movement.body.movement.id as string;

    const approved = await client.post(
      `/api/pos/v1/cash-movements/${movementId}/approve`,
      SUPERVISOR_UID,
    );
    expectStatus(approved, 200);

    const dispatched = await client.post(
      `/api/pos/v1/cash-movements/${movementId}/confirm-delivery`,
      SENIOR_UID,
    );
    expectStatus(dispatched, 200);
    expect(dispatched.body.movement.status).toBe("IN_TRANSIT");

    const responses = await Promise.all([
      client.post(
        `/api/pos/v1/cash-movements/${movementId}/confirm-receipt`,
        SUPERVISOR_UID,
        { confirmedMinor: 20_000 },
      ),
      client.post(
        `/api/pos/v1/cash-movements/${movementId}/confirm-receipt`,
        SUPERVISOR_TWO_UID,
        { confirmedMinor: 20_000 },
      ),
    ]);

    expectStatus(responses[0], 200);
    expect(responses.filter((response) => response.status === 200)).toHaveLength(1);

    // Un solo TRANSFER_IN en la caja destino: el dinero no se duplica.
    const incoming = tiendaDb
      .listAll("posCashMovements")
      .filter((entry) => entry.type === "TRANSFER_IN");
    expect(incoming).toHaveLength(1);
    expect(incoming[0]).toMatchObject({
      registerId: target.registerId,
      amountMinor: 20_000,
      status: "RECEIVED",
    });
  });

  it("el arqueo no se puede enviar dos veces para el mismo intento", async () => {
    const opened = await openRegisterWithShift(app, {
      code: "CAJA01",
      cashierUid: CASHIER_UID,
    });
    const started = await client.post(
      `/api/pos/v1/shifts/${opened.shiftId}/start-count`,
      CASHIER_UID,
    );
    expectStatus(started, 201);

    const denominations = denominationsFor(100_000);
    const responses = await Promise.all([
      client.post(`/api/pos/v1/shifts/${opened.shiftId}/cash-counts`, CASHIER_UID, {
        denominations,
      }),
      client.post(`/api/pos/v1/shifts/${opened.shiftId}/cash-counts`, CASHIER_UID, {
        denominations,
      }),
    ]);

    expect(statusesOf(responses)[0]).toBe(201);
    expect(responses.filter((response) => response.status === 201)).toHaveLength(1);

    // Un solo conteo persistido, versión 1: el anterior nunca se sobrescribe.
    const counts = tiendaDb
      .listAll("posCashCounts")
      .filter((count) => count.shiftId === opened.shiftId);
    expect(counts).toHaveLength(1);
    expect(counts[0].version).toBe(1);
  });
});
