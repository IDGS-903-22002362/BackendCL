/**
 * Seguridad del POS contra el router real.
 *
 * Cada caso ataca una superficie concreta: App Check, autorización por capacidad,
 * ownership (IDOR), asignación masiva, manipulación de precios, descuentos y autorizadores,
 * arqueo ciego, enumeración de recursos, tamaño de payload y rate limiting.
 *
 * El arnés debe importarse primero: registra los mocks de infraestructura.
 */

import {
  appDb,
  buildPosTestApp,
  posLogRecords,
  resetPosTestState,
  tiendaDb,
} from "./helpers/pos-test-harness";
import {
  ADMIN_UID,
  api,
  CASHIER_TWO_UID,
  CASHIER_UID,
  CLIENT_UID,
  denominationsFor,
  expectStatus,
  openRegisterWithShift,
  seedCatalog,
  seedStaff,
  SENIOR_UID,
  SUPERVISOR_UID,
} from "./helpers/pos-scenario";

const app = buildPosTestApp();
const client = api(app);

describe("POS · seguridad", () => {
  const own = { registerId: "", shiftId: "", saleId: "", cutId: "" };
  const foreign = { registerId: "", shiftId: "", saleId: "" };

  beforeAll(async () => {
    resetPosTestState();
    seedStaff();
    seedCatalog();

    const first = await openRegisterWithShift(app, {
      code: "CAJA01",
      cashierUid: CASHIER_UID,
    });
    own.registerId = first.registerId;
    own.shiftId = first.shiftId;

    const second = await openRegisterWithShift(app, {
      code: "CAJA02",
      cashierUid: CASHIER_TWO_UID,
    });
    foreign.registerId = second.registerId;
    foreign.shiftId = second.shiftId;

    const ownSale = await client.post("/api/pos/v1/sales", CASHIER_UID, {});
    expectStatus(ownSale, 201);
    own.saleId = ownSale.body.sale.id;

    const foreignSale = await client.post("/api/pos/v1/sales", CASHIER_TWO_UID, {});
    expectStatus(foreignSale, 201);
    foreign.saleId = foreignSale.body.sale.id;
  });

  // ------------------------------------------------------------- App Check

  it("rechaza un JWT válido que no presenta App Check", async () => {
    const response = await client.get("/api/pos/v1/context", CASHIER_UID, {
      appCheck: false,
    });

    expect(response.status).toBe(401);
    expect(response.body.code).toBe("APP_CHECK_REQUIRED");
    expect(response.headers["content-type"]).toContain("application/problem+json");
  });

  it("rechaza un token de App Check inválido y uno malformado", async () => {
    const invalid = await client.get("/api/pos/v1/context", CASHIER_UID, {
      appCheck: "token-que-no-existe",
    });
    expect(invalid.status).toBe(401);
    expect(invalid.body.code).toBe("APP_CHECK_REQUIRED");

    const malformed = await client.get("/api/pos/v1/context", CASHIER_UID, {
      appCheck: "token con espacios, y comas",
    });
    expect(malformed.status).toBe(401);
    expect(malformed.body.code).toBe("APP_CHECK_REQUIRED");
  });

  it("rechaza peticiones sin sesión autenticada", async () => {
    const response = await client.get("/api/pos/v1/context", "no-existe");
    expect(response.status).toBe(401);
  });

  // ------------------------------------------------ acceso y escalamiento

  it("niega el acceso al POS a un rol del ecommerce sin permiso", async () => {
    const response = await client.get("/api/pos/v1/context", CLIENT_UID);
    expect(response.status).toBe(403);
    expect(response.body.code).toBe("POS_ACCESS_DENIED");
  });

  it("no permite escalar privilegios enviando rol o capacidades en el cuerpo", async () => {
    const response = await client.post("/api/pos/v1/sales", CASHIER_UID, {
      posRole: "ADMIN",
      capabilities: ["cut.approve"],
    });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe("POS_VALIDATION_ERROR");
    const issues = response.body.errors as Array<{ code: string; message: string }>;
    expect(issues[0].code).toBe("unrecognized_keys");
    expect(issues[0].message).toContain("posRole");
    expect(issues[0].message).toContain("capabilities");

    // El rol efectivo sigue viniendo del backend, no del cuerpo.
    const capabilities = await client.get("/api/pos/v1/capabilities", CASHIER_UID);
    expectStatus(capabilities, 200);
    expect(capabilities.body.posRole).toBe("CASHIER");
    expect(capabilities.body.capabilities).not.toContain("cut.approve");
  });

  it("bloquea al operador POS desactivado aunque su rol del ecommerce siga activo", async () => {
    const clearCache = (): void => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      require("../src/modules/pos/services/pos-authorization.service").clearOperatorCache();
    };

    try {
      tiendaDb.seed("posOperators", CASHIER_UID, {
        displayName: "Ana Cajera",
        posRole: "ADMIN",
        active: false,
        defaultRegisterId: null,
        updatedBy: "seed",
      });
      clearCache();

      const response = await client.get("/api/pos/v1/capabilities", CASHIER_UID);
      expect(response.status).toBe(403);
      expect(response.body.code).toBe("POS_ACCESS_DENIED");
    } finally {
      tiendaDb.remove("posOperators", CASHIER_UID);
      clearCache();
    }

    // Tras retirar el registro, el cajero recupera exactamente su rol base, no el elevado.
    const restored = await client.get("/api/pos/v1/capabilities", CASHIER_UID);
    expectStatus(restored, 200);
    expect(restored.body.posRole).toBe("CASHIER");
  });

  it("niega operaciones administrativas a un cajero", async () => {
    const created = await client.post("/api/pos/v1/registers", CASHIER_UID, {
      code: "CAJA99",
      name: "Caja intrusa",
    });
    expect(created.status).toBe(403);
    expect(created.body.code).toBe("POS_PERMISSION_DENIED");

    const settings = await client.get("/api/pos/v1/settings", CASHIER_UID);
    expect(settings.status).toBe(403);

    const operators = await client.get("/api/pos/v1/operators", CASHIER_UID);
    expect(operators.status).toBe(403);

    const audit = await client.get("/api/pos/v1/audit-events", CASHIER_UID);
    expect(audit.status).toBe(403);
  });

  it("permite al admin asignar rol POS solo a EMPLEADO y rechaza mass assignment", async () => {
    const elevated = await client.put(
      `/api/pos/v1/operators/${CASHIER_UID}`,
      ADMIN_UID,
      {
        posRole: "SUPERVISOR",
        active: true,
        reason: "Elevación temporal de prueba",
        capabilities: ["pos.config.manage"],
        baseRole: "ADMIN",
      },
    );
    expect(elevated.status).toBe(400);

    const ok = await client.put(
      `/api/pos/v1/operators/${CASHIER_UID}`,
      ADMIN_UID,
      {
        posRole: "SUPERVISOR",
        active: true,
        reason: "Elevación temporal de prueba",
      },
    );
    expectStatus(ok, 200);
    expect(ok.body.operator.posRole).toBe("SUPERVISOR");

    const caps = await client.get("/api/pos/v1/capabilities", CASHIER_UID);
    expectStatus(caps, 200);
    expect(caps.body.posRole).toBe("SUPERVISOR");

    const denyAdminTarget = await client.put(
      `/api/pos/v1/operators/${ADMIN_UID}`,
      ADMIN_UID,
      {
        posRole: "CASHIER",
        active: true,
        reason: "No se puede degradar un ADMIN vía posOperators",
      },
    );
    expect(denyAdminTarget.status).toBe(400);

    // Restaura el privilegio mínimo para no contaminar el resto de la suite.
    const restored = await client.put(
      `/api/pos/v1/operators/${CASHIER_UID}`,
      ADMIN_UID,
      {
        posRole: "CASHIER",
        active: true,
        reason: "Restaurar rol de cajero tras la prueba",
      },
    );
    expectStatus(restored, 200);
  });

  it("registra el intento denegado en la auditoría append-only", async () => {
    await client.get("/api/pos/v1/audit-events", CASHIER_UID);

    const denied = tiendaDb
      .listAll("posAuditEvents")
      .filter((event) => event.eventType === "PERMISSION_DENIED");

    expect(denied.length).toBeGreaterThan(0);
    expect(denied[denied.length - 1]).toMatchObject({
      actorUid: CASHIER_UID,
      result: "DENIED",
    });
  });

  // --------------------------------------------------------------- IDOR

  it("oculta la venta de otro cajero como recurso inexistente", async () => {
    const response = await client.get(
      `/api/pos/v1/sales/${foreign.saleId}`,
      CASHIER_UID,
    );
    expect(response.status).toBe(404);
    expect(response.body.code).toBe("POS_RESOURCE_NOT_FOUND");

    // Misma respuesta para un ID inexistente: no se puede distinguir uno de otro.
    const missing = await client.get(
      "/api/pos/v1/sales/venta-que-no-existe",
      CASHIER_UID,
    );
    expect(missing.status).toBe(404);
    expect(missing.body.code).toBe(response.body.code);
    expect(missing.body.detail).toBe(response.body.detail);
  });

  it("impide modificar la venta de otro cajero", async () => {
    const response = await client.post(
      `/api/pos/v1/sales/${foreign.saleId}/items`,
      CASHIER_UID,
      { productoId: "prod-llavero", quantity: 1 },
    );
    expect(response.status).toBe(404);

    const cancelled = await client.post(
      `/api/pos/v1/sales/${foreign.saleId}/cancel`,
      CASHIER_UID,
      { reason: "Intento de cancelar venta ajena" },
    );
    expect(cancelled.status).toBe(404);
  });

  it("oculta el turno y el listado de otro cajero", async () => {
    const shift = await client.get(
      `/api/pos/v1/shifts/${foreign.shiftId}`,
      CASHIER_UID,
    );
    expect(shift.status).toBe(404);

    // Pedir explícitamente el turno de otro cajero se rechaza, no se degrada en silencio.
    const filtered = await client.get("/api/pos/v1/shifts", CASHIER_UID, {
      query: { cashierUid: CASHIER_TWO_UID },
    });
    expect(filtered.status).toBe(403);
    expect(filtered.body.code).toBe("POS_PERMISSION_DENIED");

    // Sin filtro, el listado se acota al propio cajero.
    const list = await client.get("/api/pos/v1/shifts", CASHIER_UID);
    expectStatus(list, 200);
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0].cashierUid).toBe(CASHIER_UID);
  });

  it("un supervisor sí puede leer los turnos de todos", async () => {
    const list = await client.get("/api/pos/v1/shifts", SUPERVISOR_UID);
    expectStatus(list, 200);
    expect(
      (list.body.items as Array<{ cashierUid: string }>).map((row) => row.cashierUid),
    ).toEqual(expect.arrayContaining([CASHIER_UID, CASHIER_TWO_UID]));
  });

  // ------------------------------------------ manipulación de importes

  it("ignora precio, descuento y totales enviados por el cliente", async () => {
    const response = await client.post(
      `/api/pos/v1/sales/${own.saleId}/items`,
      CASHIER_UID,
      {
        productoId: "prod-jersey",
        quantity: 1,
        unitPriceMinor: 1,
        discountMinor: 189_949,
        lineTotalMinor: 1,
      },
    );

    expect(response.status).toBe(400);
    expect(response.body.code).toBe("POS_VALIDATION_ERROR");

    // La línea legítima conserva el precio del catálogo.
    const legit = await client.post(
      `/api/pos/v1/sales/${own.saleId}/items`,
      CASHIER_UID,
      { productoId: "prod-jersey", quantity: 1 },
    );
    expectStatus(legit, 201);
    expect(legit.body.sale.items[0].unitPriceMinor).toBe(189_950);
    expect(legit.body.sale.totals.totalMinor).toBe(189_950);
  });

  it("rechaza cantidades no enteras, negativas o fuera de rango", async () => {
    for (const quantity of [0, -1, 1.5, 1e6, Number.NaN]) {
      const response = await client.post(
        `/api/pos/v1/sales/${own.saleId}/items`,
        CASHIER_UID,
        { productoId: "prod-llavero", quantity },
      );
      expect(response.status).toBe(400);
      expect(response.body.code).toBe("POS_VALIDATION_ERROR");
    }
  });

  it("rechaza fechas y estados enviados por el cliente", async () => {
    const response = await client.post("/api/pos/v1/sales", CASHIER_UID, {
      createdAt: "2020-01-01T00:00:00.000Z",
      status: "PAID",
      folio: "V-FALSO-00001",
    });
    expect(response.status).toBe(400);
    expect(response.body.code).toBe("POS_VALIDATION_ERROR");
  });

  it("no permite cobrar menos efectivo del que exige el total", async () => {
    const preview = await client.post(
      `/api/pos/v1/sales/${own.saleId}/checkout-preview`,
      CASHIER_UID,
    );
    expectStatus(preview, 200);

    const insufficient = await client.post(
      `/api/pos/v1/sales/${own.saleId}/payments/cash`,
      CASHIER_UID,
      { receivedMinor: 100 },
    );
    expect(insufficient.status).toBe(422);
    expect(insufficient.body.code).toBe("CASH_RECEIVED_INSUFFICIENT");

    // El importe aplicado tampoco puede forzarse por debajo del pendiente sin quedar pendiente.
    const partial = await client.post(
      `/api/pos/v1/sales/${own.saleId}/payments/cash`,
      CASHIER_UID,
      { amountMinor: 100, receivedMinor: 100 },
    );
    expect(partial.status).toBe(201);
    expect(partial.body.sale.status).toBe("PAYMENT_PENDING");
    expect(partial.body.pendingMinor).toBe(189_850);
  });

  // ------------------------------------------------- descuento manual

  it("no permite descuento manual sin capacidad ni autoautorización", async () => {
    const sale = await client.post("/api/pos/v1/sales", CASHIER_UID, {});
    expectStatus(sale, 201);
    const saleId = sale.body.sale.id as string;
    await client.post(`/api/pos/v1/sales/${saleId}/items`, CASHIER_UID, {
      productoId: "prod-jersey",
      quantity: 1,
    });

    // El cajero no tiene la capacidad.
    const denied = await client.post(
      `/api/pos/v1/sales/${saleId}/manual-discount`,
      CASHIER_UID,
      { amountMinor: 10_000, reason: "Cliente frecuente" },
    );
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe("POS_PERMISSION_DENIED");
  });

  it("exige autorizador distinto cuando el descuento excede el límite del actor", async () => {
    const seniorRegister = await openRegisterWithShift(app, {
      code: "CAJA03",
      cashierUid: SENIOR_UID,
    });
    expect(seniorRegister.shiftId).toBeTruthy();

    const sale = await client.post("/api/pos/v1/sales", SENIOR_UID, {});
    expectStatus(sale, 201);
    const saleId = sale.body.sale.id as string;
    await client.post(`/api/pos/v1/sales/${saleId}/items`, SENIOR_UID, {
      productoId: "prod-jersey",
      quantity: 1,
    });

    // Dentro de su límite ($50): se autoriza solo.
    const withinLimit = await client.post(
      `/api/pos/v1/sales/${saleId}/manual-discount`,
      SENIOR_UID,
      { amountMinor: 5_000, reason: "Producto con detalle menor" },
    );
    expectStatus(withinLimit, 200);
    expect(withinLimit.body.sale.manualDiscount).toMatchObject({
      amountMinor: 5_000,
      requestedBy: SENIOR_UID,
      authorizedBy: SENIOR_UID,
    });

    // Por encima de su límite ($50) y dentro del de supervisora ($500), sin autorizador.
    const missingAuthorizer = await client.post(
      `/api/pos/v1/sales/${saleId}/manual-discount`,
      SENIOR_UID,
      { amountMinor: 20_000, reason: "Descuento grande sin autorizar" },
    );
    expect(missingAuthorizer.status).toBe(403);
    expect(missingAuthorizer.body.code).toBe("AUTHORIZER_REQUIRED");

    // Autoautorizándose.
    const selfAuthorized = await client.post(
      `/api/pos/v1/sales/${saleId}/manual-discount`,
      SENIOR_UID,
      {
        amountMinor: 20_000,
        reason: "Descuento grande autoautorizado",
        authorizedBy: SENIOR_UID,
      },
    );
    expect(selfAuthorized.status).toBe(403);
    expect(selfAuthorized.body.code).toBe("SELF_APPROVAL_FORBIDDEN");

    // Con un autorizador que tampoco tiene la capacidad.
    const weakAuthorizer = await client.post(
      `/api/pos/v1/sales/${saleId}/manual-discount`,
      SENIOR_UID,
      {
        amountMinor: 20_000,
        reason: "Descuento autorizado por un cajero",
        authorizedBy: CASHIER_UID,
      },
    );
    expect(weakAuthorizer.status).toBe(403);

    // Con un supervisor real sí procede, y queda registrado quién autorizó.
    const authorized = await client.post(
      `/api/pos/v1/sales/${saleId}/manual-discount`,
      SENIOR_UID,
      {
        amountMinor: 20_000,
        reason: "Descuento autorizado por supervisora",
        authorizedBy: SUPERVISOR_UID,
      },
    );
    expectStatus(authorized, 200);
    expect(authorized.body.sale.manualDiscount).toMatchObject({
      amountMinor: 20_000,
      requestedBy: SENIOR_UID,
      authorizedBy: SUPERVISOR_UID,
    });

    // Ni siquiera con autorizador puede superarse el límite del propio autorizador.
    const aboveAuthorizerLimit = await client.post(
      `/api/pos/v1/sales/${saleId}/manual-discount`,
      SENIOR_UID,
      {
        amountMinor: 60_000,
        reason: "Descuento por encima del límite de la supervisora",
        authorizedBy: SUPERVISOR_UID,
      },
    );
    expect(aboveAuthorizerLimit.status).toBe(422);
    expect(aboveAuthorizerLimit.body.code).toBe("MANUAL_DISCOUNT_LIMIT_EXCEEDED");
  });

  // ---------------------------------------------------- arqueo ciego

  it("no revela efectivo esperado al cajero antes ni durante el conteo", async () => {
    const state = await client.get(
      `/api/pos/v1/registers/${own.registerId}`,
      CASHIER_UID,
    );
    expectStatus(state, 200);
    expect(state.body.expectedCashMinor).toBeNull();
    expect(state.body.shift.totals.cashSalesMinor).toBe(0);

    const report = await client.get("/api/pos/v1/reports/shifts", CASHIER_UID);
    expectStatus(report, 200);
    expect(report.body.rows[0].expectedCashMinor).toBeNull();
    expect(report.body.rows[0].countedCashMinor).toBeNull();
    expect(report.body.rows[0].differenceMinor).toBeNull();

    // El arqueo exige que no queden ventas en proceso: se resuelven las de las pruebas previas.
    const sales = await client.get("/api/pos/v1/sales", CASHIER_UID);
    expectStatus(sales, 200);
    for (const sale of sales.body.items as Array<{ id: string; status: string }>) {
      if (sale.status === "DRAFT" || sale.status === "SUSPENDED") {
        const cancelled = await client.post(
          `/api/pos/v1/sales/${sale.id}/cancel`,
          CASHIER_UID,
          { reason: "Limpieza de borradores antes del arqueo" },
        );
        expectStatus(cancelled, 200);
      }
      if (sale.status === "PAYMENT_PENDING") {
        const completed = await client.post(
          `/api/pos/v1/sales/${sale.id}/payments/cash`,
          CASHIER_UID,
          { receivedMinor: 189_850 },
        );
        expectStatus(completed, 201);
        expect(completed.body.sale.status).toBe("PAID");
      }
    }

    const started = await client.post(
      `/api/pos/v1/shifts/${own.shiftId}/start-count`,
      CASHIER_UID,
    );
    expectStatus(started, 201);
    own.cutId = started.body.cut.id;
    expect(started.body.cut.blindForActor).toBe(false);

    const submitted = await client.post(
      `/api/pos/v1/shifts/${own.shiftId}/cash-counts`,
      CASHIER_UID,
      { denominations: denominationsFor(289_950) },
    );
    expectStatus(submitted, 201);
    expect(submitted.body.count.countedCashMinor).toBe(289_950);
    expect(submitted.body.cut.status).toBe("APPROVED");
    expect(submitted.body.cut.totals.differenceMinor).toBe(0);
  });

  it("rechaza campos desconocidos en el payload de conteo", async () => {
    const response = await client.post(
      `/api/pos/v1/shifts/${foreign.shiftId}/cash-counts`,
      CASHIER_TWO_UID,
      {
        denominations: denominationsFor(100_000),
        differenceMinor: 0,
      },
    );
    expect(response.status).toBe(400);
    expect(response.body.code).toBe("POS_VALIDATION_ERROR");
  });

  it("no permite que el cajero reabra su propio corte", async () => {
    const reopen = await client.post(
      `/api/pos/v1/cuts/${own.cutId}/reopen`,
      CASHIER_UID,
      { reason: "Quiero volver a contar" },
    );
    expect(reopen.status).toBe(403);
  });

  it("cierra de forma autónoma el corte del supervisor sin paso de aprobación", async () => {
    const supervisorRegister = await openRegisterWithShift(app, {
      code: "CAJA04",
      cashierUid: SUPERVISOR_UID,
    });

    const started = await client.post(
      `/api/pos/v1/shifts/${supervisorRegister.shiftId}/start-count`,
      SUPERVISOR_UID,
    );
    expectStatus(started, 201);

    const submitted = await client.post(
      `/api/pos/v1/shifts/${supervisorRegister.shiftId}/cash-counts`,
      SUPERVISOR_UID,
      { denominations: denominationsFor(100_000) },
    );
    expectStatus(submitted, 201);
    expect(submitted.body.cut.status).toBe("APPROVED");
    expect(submitted.body.cut.approverUid).toBe(SUPERVISOR_UID);

    const reapprove = await client.post(
      `/api/pos/v1/cuts/${submitted.body.cut.id}/approve`,
      SUPERVISOR_UID,
    );
    expect(reapprove.status).toBeGreaterThanOrEqual(400);
  });

  // ------------------------------------------------------- transporte

  it("exige Idempotency-Key en los comandos críticos", async () => {
    const response = await client.post(
      `/api/pos/v1/registers/${foreign.registerId}/close`,
      SUPERVISOR_UID,
      undefined,
      { idempotencyKey: "" },
    );
    expect(response.status).toBe(400);
    expect(response.body.code).toBe("IDEMPOTENCY_KEY_REQUIRED");
  });

  it("rechaza payloads desproporcionados antes de procesarlos", async () => {
    const response = await client.post("/api/pos/v1/sales", CASHIER_UID, {
      note: "x".repeat(200_000),
    });
    expect(response.status).toBe(400);
    expect(response.body.code).toBe("POS_VALIDATION_ERROR");
    expect(response.body.detail).toContain("límite");
  });

  it("rechaza rangos de reporte y límites de página abusivos", async () => {
    const hugeRange = await client.get("/api/pos/v1/reports/shifts", ADMIN_UID, {
      query: { from: "2020-01-01", to: "2030-12-31" },
    });
    expect(hugeRange.status).toBeGreaterThanOrEqual(400);

    const hugeLimit = await client.get("/api/pos/v1/shifts", ADMIN_UID, {
      query: { limit: 5000 },
    });
    expect(hugeLimit.status).toBe(400);
  });

  it("aplica rate limiting a la consulta pública de tickets", async () => {
    const paths = Array.from({ length: 31 }, () => "/api/pos/v1/tickets/" + "0".repeat(32));
    let limited = 0;
    for (const path of paths) {
      const response = await client.get(path, CASHIER_UID, {
        appCheck: false,
        deviceId: "device-rate-limit",
      });
      if (response.status === 429) {
        limited += 1;
        expect(response.body.code).toBe("RATE_LIMITED");
      }
    }
    expect(limited).toBeGreaterThan(0);
  });

  // ----------------------------------------------------- fuga de datos

  it("no filtra tokens, cabeceras ni datos sensibles en logs ni auditoría", () => {
    const logged = JSON.stringify(posLogRecords);
    expect(logged).not.toContain("pos-test-appcheck-token");
    expect(logged).not.toContain("Bearer");

    const audited = JSON.stringify(tiendaDb.listAll("posAuditEvents"));
    expect(audited).not.toContain("pos-test-appcheck-token");
    expect(audited).not.toContain("Bearer");
    // La IP se guarda como hash, nunca en claro.
    expect(audited).not.toContain("127.0.0.1");

    // El directorio de usuarios vive en la base de la app y no se copia a documentos POS.
    expect(appDb.listAll("usuariosApp").length).toBeGreaterThan(0);
    expect(audited).not.toContain("@pruebas.local");
  });

  it("no devuelve stack traces ni rutas internas en errores", async () => {
    const response = await client.get("/api/pos/v1/sales/no-existe", CASHIER_UID);
    expect(response.status).toBe(404);
    expect(response.body).not.toHaveProperty("stack");
    expect(JSON.stringify(response.body)).not.toContain("functions/src");
    expect(response.body).toMatchObject({
      type: expect.stringContaining("problems/pos"),
      title: expect.any(String),
      status: 404,
      code: "POS_RESOURCE_NOT_FOUND",
    });
    expect(response.body.requestId).toMatch(/^test-req-\d+$/);
  });
});
