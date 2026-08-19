/**
 * Flujo A del POS, de extremo a extremo contra el router real.
 *
 * Abrir caja, iniciar turno, vender, cobrar en efectivo, descontar inventario, emitir
 * ticket, arquear a ciegas, aprobar el corte, cerrar turno, cerrar caja y cerrar el día.
 *
 * El arnés debe importarse primero: registra los mocks de infraestructura.
 */

import { buildPosTestApp, resetPosTestState, tiendaDb } from "./helpers/pos-test-harness";
import {
  ADMIN_UID,
  api,
  CASHIER_UID,
  denominationsFor,
  expectStatus,
  openRegisterWithShift,
  seedCatalog,
  seedStaff,
  SUPERVISOR_UID,
} from "./helpers/pos-scenario";

const app = buildPosTestApp();
const client = api(app);

describe("POS · flujo operativo completo", () => {
  const state = {
    registerId: "",
    sessionId: "",
    shiftId: "",
    saleId: "",
    cutId: "",
    operationalDate: "",
    totalMinor: 0,
  };

  beforeAll(async () => {
    resetPosTestState();
    seedStaff();
    seedCatalog();
    const opened = await openRegisterWithShift(app, {
      code: "CAJA01",
      cashierUid: CASHIER_UID,
      openingFloatMinor: 100_000,
    });
    state.registerId = opened.registerId;
    state.sessionId = opened.sessionId;
    state.shiftId = opened.shiftId;
    state.operationalDate = opened.operationalDate;
  });

  it("expone contexto y capacidades del cajero sin filtrar límites sensibles", async () => {
    const context = await client.get("/api/pos/v1/context", CASHIER_UID);
    expectStatus(context, 200);

    expect(context.body.operationalDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(context.body.appCheckVerified).toBe(true);
    expect(context.body.activeShift.id).toBe(state.shiftId);
    expect(context.body.register.register.id).toBe(state.registerId);
    // El cajero no debe recibir el efectivo esperado: rompería el arqueo ciego.
    expect(context.body.register.expectedCashMinor).toBeNull();
    expect(context.body.settings.denominationsMinor).toContain(100_000);
    // Un cajero no debe conocer los umbrales de diferencia ni los límites de aprobación.
    expect(context.body.settings.supervisorDifferenceLimitMinor).toBeUndefined();
    expect(context.body.settings.adminDifferenceLimitMinor).toBeUndefined();
    expect(context.body.settings.cutToleranceMinor).toBeUndefined();

    const capabilities = await client.get("/api/pos/v1/capabilities", CASHIER_UID);
    expectStatus(capabilities, 200);
    expect(capabilities.body.capabilities).toContain("pos.sale.create");
    expect(capabilities.body.capabilities).not.toContain("cut.approve");
    expect(capabilities.body.posRole).toBe("CASHIER");
  });

  it("registra el fondo inicial como movimiento de efectivo del turno", async () => {
    const movements = await client.get("/api/pos/v1/cash-movements", CASHIER_UID, {
      query: { shiftId: state.shiftId },
    });
    expectStatus(movements, 200);

    expect(movements.body.items).toHaveLength(1);
    expect(movements.body.items[0]).toMatchObject({
      type: "OPENING_FLOAT",
      status: "APPROVED",
      amountMinor: 100_000,
    });
  });

  it("calcula precios y totales en el backend al agregar productos", async () => {
    const created = await client.post("/api/pos/v1/sales", CASHIER_UID, {
      customerName: "Mostrador",
    });
    expectStatus(created, 201);
    state.saleId = created.body.sale.id;
    expect(created.body.sale.status).toBe("DRAFT");

    const added = await client.post(
      `/api/pos/v1/sales/${state.saleId}/items`,
      CASHIER_UID,
      { productoId: "prod-jersey", quantity: 1 },
    );
    expectStatus(added, 201);

    const item = added.body.sale.items[0];
    expect(item).toMatchObject({
      productoId: "prod-jersey",
      clave: "JER-2026",
      quantity: 1,
      unitPriceMinor: 189_950,
      lineTotalMinor: 189_950,
    });
    expect(added.body.sale.totals).toMatchObject({
      subtotalMinor: 189_950,
      discountMinor: 0,
      totalMinor: 189_950,
    });
    state.totalMinor = added.body.sale.totals.totalMinor;
  });

  it("no descuenta inventario mientras la venta no está pagada", () => {
    const producto = tiendaDb.read("productos", "prod-jersey");
    expect(producto?.existencias).toBe(10);
  });

  it("pasa a cobro y paga en efectivo calculando el cambio", async () => {
    const preview = await client.post(
      `/api/pos/v1/sales/${state.saleId}/checkout-preview`,
      CASHIER_UID,
    );
    expectStatus(preview, 200);
    expect(preview.body.sale.status).toBe("PAYMENT_PENDING");
    expect(preview.body.changes).toEqual([]);
    expect(preview.body.pendingMinor).toBe(189_950);
    expect(preview.body.allowedMethods).toEqual(
      expect.arrayContaining(["CASH", "CARD_EXTERNAL"]),
    );

    const paid = await client.post(
      `/api/pos/v1/sales/${state.saleId}/payments/cash`,
      CASHIER_UID,
      { receivedMinor: 200_000 },
    );
    expectStatus(paid, 201);

    expect(paid.body.sale.status).toBe("PAID");
    expect(paid.body.changeMinor).toBe(10_050);
    expect(paid.body.pendingMinor).toBe(0);
    expect(paid.body.payments[0]).toMatchObject({
      method: "CASH",
      status: "APPROVED",
      amountMinor: 189_950,
      receivedMinor: 200_000,
      changeMinor: 10_050,
    });
  });

  it("descuenta inventario compartido y registra el movimiento con origen pos", () => {
    const producto = tiendaDb.read("productos", "prod-jersey");
    expect(producto?.existencias).toBe(9);
    expect(producto?.inventarioGlobal).toMatchObject({ fisica: 9, disponible: 9 });

    const movimientos = tiendaDb
      .listAll("movimientosInventario")
      .filter((movimiento) => movimiento.productoId === "prod-jersey");
    expect(movimientos).toHaveLength(1);
    expect(movimientos[0]).toMatchObject({
      origen: "pos",
      productoId: "prod-jersey",
      cantidadAnterior: 10,
      cantidadNueva: 9,
      diferencia: -1,
      ventaPosId: state.saleId,
      posRegisterId: state.registerId,
      posShiftId: state.shiftId,
      usuarioId: CASHIER_UID,
    });
  });

  it("suma la venta en efectivo al ledger del turno", async () => {
    const movements = await client.get("/api/pos/v1/cash-movements", CASHIER_UID, {
      query: { shiftId: state.shiftId, type: "CASH_SALE" },
    });
    expectStatus(movements, 200);

    expect(movements.body.items).toHaveLength(1);
    // El ledger registra el importe aplicado, nunca el recibido: el cambio no infla el cajón.
    expect(movements.body.items[0].amountMinor).toBe(189_950);
  });

  it("emite ticket comercial no fiscal y cuenta las reimpresiones", async () => {
    const ticket = await client.get(
      `/api/pos/v1/sales/${state.saleId}/ticket`,
      CASHIER_UID,
    );
    expectStatus(ticket, 200);

    expect(ticket.body.ticket).toMatchObject({
      saleId: state.saleId,
      currency: "MXN",
      reprintCount: 0,
      changeMinor: 10_050,
      receivedMinor: 200_000,
    });
    expect(ticket.body.ticket.folio).toMatch(/^V-CAJA01-\d{8}-\d{5}$/);
    expect(ticket.body.ticket.ticketToken).toMatch(/^[a-f0-9]{32}$/);
    expect(ticket.body.ticket.legend).toContain("no es un comprobante fiscal");
    expect(ticket.body.ticket.items[0]).toMatchObject({
      clave: "JER-2026",
      quantity: 1,
      lineTotalMinor: 189_950,
    });
    expect(JSON.stringify(ticket.body)).not.toContain("uuid");

    const reprint = await client.post(
      `/api/pos/v1/sales/${state.saleId}/ticket/reprint`,
      CASHIER_UID,
      { reason: "El cliente pidió otra copia" },
    );
    expectStatus(reprint, 200);
    expect(reprint.body.ticket.reprintCount).toBe(1);

    // Consulta pública por token: sin autenticación y sin identidad del cajero.
    const lookup = await client.get(
      `/api/pos/v1/tickets/${ticket.body.ticket.ticketToken}`,
      CASHIER_UID,
      { appCheck: false },
    );
    expectStatus(lookup, 200);
    expect(lookup.body.ticket.cashier.uid).toBe("");
    expect(lookup.body.ticket.folio).toBe(ticket.body.ticket.folio);
  });

  it("cierra el corte de forma autónoma y revela totales al cajero", async () => {
    const started = await client.post(
      `/api/pos/v1/shifts/${state.shiftId}/start-count`,
      CASHIER_UID,
    );
    expectStatus(started, 201);
    state.cutId = started.body.cut.id;
    expect(started.body.cut.blindForActor).toBe(false);
    expect(started.body.cut.status).toBe("COUNTING");

    const preview = await client.get(
      `/api/pos/v1/shifts/${state.shiftId}/cut-preview`,
      CASHIER_UID,
    );
    expectStatus(preview, 200);
    expect(preview.body.preview.totals.expectedCashMinor).toBe(289_950);
    expect(preview.body.preview.blocking.canStartOrContinue).toBe(true);

    // Esperado real: fondo 100000 + venta en efectivo 189950 = 289950.
    const submitted = await client.post(
      `/api/pos/v1/shifts/${state.shiftId}/cash-counts`,
      CASHIER_UID,
      { denominations: denominationsFor(289_950) },
    );
    expectStatus(submitted, 201);

    expect(submitted.body.count.blindForActor).toBe(false);
    expect(submitted.body.count.countedCashMinor).toBe(289_950);
    expect(submitted.body.count.version).toBe(1);
    expect(submitted.body.cut.status).toBe("APPROVED");
    expect(submitted.body.cut.approverUid).toBe(CASHIER_UID);
    expect(submitted.body.cut.totals).toMatchObject({
      openingFloatMinor: 100_000,
      expectedCashMinor: 289_950,
      countedCashMinor: 289_950,
      differenceMinor: 0,
      salesCount: 1,
      netSalesMinor: 189_950,
    });

    const ownView = await client.get(`/api/pos/v1/cuts/${state.cutId}`, CASHIER_UID);
    expectStatus(ownView, 200);
    expect(ownView.body.cut.totals.differenceMinor).toBe(0);
  });

  it("el supervisor consulta el corte cerrado y el cajero no puede reaprobarlo", async () => {
    const supervisorView = await client.get(
      `/api/pos/v1/cuts/${state.cutId}`,
      SUPERVISOR_UID,
    );
    expectStatus(supervisorView, 200);
    expect(supervisorView.body.cut.blindForActor).toBe(false);
    expect(supervisorView.body.cut.totals).toMatchObject({
      openingFloatMinor: 100_000,
      expectedCashMinor: 289_950,
      countedCashMinor: 289_950,
      differenceMinor: 0,
      salesCount: 1,
      netSalesMinor: 189_950,
    });
    const breakdown = supervisorView.body.cut.totals.paymentBreakdown as Array<{
      method: string;
      amountMinor: number;
    }>;
    expect(breakdown).toEqual(
      expect.arrayContaining([
        {
          method: "CASH",
          count: 1,
          amountMinor: 189_950,
          refundedMinor: 0,
          netMinor: 189_950,
        },
      ]),
    );
    expect(
      breakdown.reduce((total, row) => total + row.amountMinor, 0),
    ).toBe(189_950);
    expect(supervisorView.body.cut.classification).toBe("BALANCED");

    const selfApproval = await client.post(
      `/api/pos/v1/cuts/${state.cutId}/approve`,
      CASHIER_UID,
    );
    expect(selfApproval.status).toBeGreaterThanOrEqual(400);
  });

  it("el corte ya quedó aprobado al enviar el conteo", async () => {
    const cashierView = await client.get(
      `/api/pos/v1/cuts/${state.cutId}`,
      CASHIER_UID,
    );
    expectStatus(cashierView, 200);
    expect(cashierView.body.cut.status).toBe("APPROVED");
    expect(cashierView.body.cut.blindForActor).toBe(false);
    expect(cashierView.body.cut.totals.differenceMinor).toBe(0);
  });

  it("cierra turno y caja, y deja la sesión consolidada", async () => {
    const ended = await client.post(
      `/api/pos/v1/shifts/${state.shiftId}/end`,
      CASHIER_UID,
    );
    expectStatus(ended, 200);
    expect(ended.body.shift.status).toBe("CLOSED");

    const closed = await client.post(
      `/api/pos/v1/registers/${state.registerId}/close`,
      SUPERVISOR_UID,
    );
    expectStatus(closed, 200);
    expect(closed.body.register.status).toBe("AVAILABLE");
    expect(closed.body.register.activeSessionId).toBeNull();
    expect(closed.body.session.status).toBe("CLOSED");
  });

  it("cierra el día una sola vez y conserva los totales consolidados", async () => {
    const readiness = await client.get(
      `/api/pos/v1/daily-close/${state.operationalDate}/readiness`,
      ADMIN_UID,
    );
    expectStatus(readiness, 200);
    expect(readiness.body.blockers).toEqual([]);
    expect(readiness.body.ready).toBe(true);

    const closed = await client.post(
      `/api/pos/v1/daily-close/${state.operationalDate}/close`,
      ADMIN_UID,
      undefined,
      { idempotencyKey: "daily-close-1" },
    );
    expectStatus(closed, 201);
    expect(closed.body.dailyClose.status).toBe("CLOSED");
    expect(closed.body.dailyClose.operationalDate).toBe(state.operationalDate);
    expect(closed.body.dailyClose.totals).toMatchObject({
      registerCount: 1,
      shiftCount: 1,
      salesCount: 1,
      grossSalesMinor: 189_950,
      netSalesMinor: 189_950,
      refundsMinor: 0,
      expectedCashMinor: 289_950,
      countedCashMinor: 289_950,
      differenceMinor: 0,
      shortageMinor: 0,
      overageMinor: 0,
    });
    const breakdown = closed.body.dailyClose.totals.paymentBreakdown as Array<{
      method: string;
      amountMinor: number;
    }>;
    expect(breakdown).toEqual(
      expect.arrayContaining([
        {
          method: "CASH",
          count: 1,
          amountMinor: 189_950,
          refundedMinor: 0,
          netMinor: 189_950,
        },
      ]),
    );
    expect(breakdown.reduce((total, row) => total + row.amountMinor, 0)).toBe(
      189_950,
    );

    // Reintento con la misma clave: mismo resultado, sin duplicar el cierre.
    const replay = await client.post(
      `/api/pos/v1/daily-close/${state.operationalDate}/close`,
      ADMIN_UID,
      undefined,
      { idempotencyKey: "daily-close-1" },
    );
    expect(replay.status).toBe(201);
    expect(replay.headers["idempotency-replayed"]).toBe("true");
    expect(replay.body.dailyClose.id).toBe(closed.body.dailyClose.id);

    // Otro administrador con otra clave no puede crear un segundo cierre del mismo día.
    const second = await client.post(
      `/api/pos/v1/daily-close/${state.operationalDate}/close`,
      ADMIN_UID,
      undefined,
      { idempotencyKey: "daily-close-2" },
    );
    expect(second.status).toBeGreaterThanOrEqual(400);
    expect(tiendaDb.listAll("posDailyClosures")).toHaveLength(1);
  });

  it("deja rastro de auditoría append-only de todo el flujo", async () => {
    const events = await client.get("/api/pos/v1/audit-events", ADMIN_UID, {
      query: { limit: 100 },
    });
    expectStatus(events, 200);

    const types = (events.body.items as Array<{ eventType: string }>).map(
      (event) => event.eventType,
    );
    for (const expected of [
      "REGISTER_CREATED",
      "REGISTER_OPENED",
      "SHIFT_STARTED",
      "SALE_CREATED",
      "SALE_CHECKOUT_STARTED",
      "PAYMENT_REGISTERED",
      "SALE_PAID",
      "CASH_COUNT_STARTED",
      "CASH_COUNT_SUBMITTED",
      "CUT_APPROVED",
      "SHIFT_ENDED",
      "REGISTER_CLOSED",
      "DAILY_CLOSE_CREATED",
    ]) {
      expect(types).toContain(expected);
    }

    // La auditoría no expone tokens ni cabeceras: la IP se guarda como hash.
    const serialized = JSON.stringify(events.body);
    expect(serialized).not.toContain("Bearer");
    expect(serialized).not.toContain("pos-test-appcheck-token");
  });

  it("reporta el turno con totales consistentes y respeta el alcance", async () => {
    const report = await client.get("/api/pos/v1/reports/shifts", SUPERVISOR_UID, {
      query: { from: state.operationalDate, to: state.operationalDate },
    });
    expectStatus(report, 200);

    expect(report.body.rows).toHaveLength(1);
    expect(report.body.rows[0]).toMatchObject({
      shiftId: state.shiftId,
      cashierUid: CASHIER_UID,
      registerCode: "CAJA01",
      status: "CLOSED",
      salesCount: 1,
      netSalesMinor: 189_950,
      cashSalesMinor: 189_950,
      cardSalesMinor: 0,
      // Al cerrar el turno, el corte aprobado pasa a CLOSED y ya no admite ediciones.
      cutStatus: "CLOSED",
      classification: "BALANCED",
      expectedCashMinor: 289_950,
      differenceMinor: 0,
    });

    // Un cajero no puede pedir el reporte de otro cajero.
    const foreign = await client.get("/api/pos/v1/reports/shifts", CASHIER_UID, {
      query: { cashierUid: SUPERVISOR_UID },
    });
    expect(foreign.status).toBe(403);
  });
});
