/**
 * Escenarios reutilizables para las pruebas de integración del POS.
 *
 * Todo se construye llamando a la API real: no se inyectan documentos operativos a mano
 * (cajas abiertas, turnos, ventas). Solo el catálogo, el personal y las ofertas se siembran,
 * porque son datos del ecommerce que el POS consume.
 */

import type { Express } from "express";
import request from "supertest";
import {
  nextIdempotencyKey,
  posHeaders,
  registerTestUser,
  seedPosOperator,
  seedProduct,
} from "./pos-test-harness";

export const CASHIER_UID = "cajero01";
export const CASHIER_TWO_UID = "cajero02";
export const SENIOR_UID = "cajerosenior01";
export const SUPERVISOR_UID = "supervisor01";
export const SUPERVISOR_TWO_UID = "supervisor02";
export const ADMIN_UID = "admin01";
export const SUPER_ADMIN_UID = "superadmin01";
export const CLIENT_UID = "cliente01";

export interface RequestOptions {
  idempotencyKey?: string;
  appCheck?: string | false;
  deviceId?: string;
  query?: Record<string, string | number | boolean>;
}

/** Cliente HTTP con las cabeceras del POS ya puestas (auth, App Check, dispositivo). */
export function api(app: Express) {
  return {
    get(path: string, uid: string, options: RequestOptions = {}) {
      return request(app)
        .get(path)
        .query(options.query ?? {})
        .set(posHeaders({ uid, ...options }));
    },
    post(path: string, uid: string, body?: unknown, options: RequestOptions = {}) {
      return request(app)
        .post(path)
        .set(
          posHeaders({
            uid,
            idempotencyKey: options.idempotencyKey ?? nextIdempotencyKey(),
            appCheck: options.appCheck,
            deviceId: options.deviceId,
          }),
        )
        .send((body ?? {}) as object);
    },
    patch(path: string, uid: string, body?: unknown, options: RequestOptions = {}) {
      return request(app)
        .patch(path)
        .set(
          posHeaders({
            uid,
            idempotencyKey: options.idempotencyKey ?? nextIdempotencyKey(),
            appCheck: options.appCheck,
            deviceId: options.deviceId,
          }),
        )
        .send((body ?? {}) as object);
    },
    delete(path: string, uid: string, options: RequestOptions = {}) {
      return request(app)
        .delete(path)
        .set(
          posHeaders({
            uid,
            idempotencyKey: options.idempotencyKey ?? nextIdempotencyKey(),
            appCheck: options.appCheck,
            deviceId: options.deviceId,
          }),
        );
    },
    put(path: string, uid: string, body?: unknown, options: RequestOptions = {}) {
      return request(app)
        .put(path)
        .set(
          posHeaders({
            uid,
            idempotencyKey: options.idempotencyKey ?? nextIdempotencyKey(),
            appCheck: options.appCheck,
            deviceId: options.deviceId,
          }),
        )
        .send((body ?? {}) as object);
    },
  };
}

/** Personal del POS: roles del ecommerce más los roles POS elevados en `posOperators`. */
export function seedStaff(): void {
  registerTestUser({ uid: CASHIER_UID, rol: "EMPLEADO", nombre: "Ana Cajera" });
  registerTestUser({ uid: CASHIER_TWO_UID, rol: "EMPLEADO", nombre: "Beto Cajero" });
  registerTestUser({ uid: SENIOR_UID, rol: "EMPLEADO", nombre: "Carla Senior" });
  registerTestUser({ uid: SUPERVISOR_UID, rol: "EMPLEADO", nombre: "Diana Supervisora" });
  registerTestUser({ uid: SUPERVISOR_TWO_UID, rol: "EMPLEADO", nombre: "Elena Supervisora" });
  registerTestUser({ uid: ADMIN_UID, rol: "ADMIN", nombre: "Fabián Admin" });
  registerTestUser({ uid: SUPER_ADMIN_UID, rol: "SUPER_ADMIN", nombre: "Gaby Super" });
  registerTestUser({ uid: CLIENT_UID, rol: "CLIENTE", nombre: "Hugo Cliente" });

  seedPosOperator({ uid: SENIOR_UID, posRole: "SENIOR_CASHIER" });
  seedPosOperator({ uid: SUPERVISOR_UID, posRole: "SUPERVISOR" });
  seedPosOperator({ uid: SUPERVISOR_TWO_UID, posRole: "SUPERVISOR" });
}

/** Catálogo mínimo: un producto sin tallas, uno con tallas y uno de precio bajo. */
export function seedCatalog(): void {
  seedProduct({
    id: "prod-jersey",
    clave: "JER-2026",
    descripcion: "Jersey local 2026",
    precioPublico: 1899.5,
    existencias: 10,
  });
  seedProduct({
    id: "prod-playera",
    clave: "PLY-BLANCA",
    descripcion: "Playera blanca",
    precioPublico: 499,
    sizes: [
      { tallaId: "talla-m", cantidad: 4 },
      { tallaId: "talla-g", cantidad: 2 },
    ],
  });
  seedProduct({
    id: "prod-llavero",
    clave: "LLV-01",
    descripcion: "Llavero escudo",
    precioPublico: 89,
    existencias: 3,
  });
}

export interface OpenRegisterResult {
  registerId: string;
  sessionId: string;
  shiftId: string;
  operationalDate: string;
}

/** Crea la caja (admin) y la abre con el cajero indicado, devolviendo sesión y turno. */
export async function openRegisterWithShift(
  app: Express,
  input: {
    code: string;
    name?: string;
    cashierUid: string;
    openingFloatMinor?: number;
    allowCash?: boolean;
    allowCardExternal?: boolean;
  },
): Promise<OpenRegisterResult> {
  const client = api(app);

  const created = await client.post("/api/pos/v1/registers", ADMIN_UID, {
    code: input.code,
    name: input.name ?? `Caja ${input.code}`,
    allowCash: input.allowCash ?? true,
    allowCardExternal: input.allowCardExternal ?? true,
    terminalId: "term01",
  });
  expectStatus(created, 201);
  const registerId = created.body.register.id as string;

  const opened = await client.post(
    `/api/pos/v1/registers/${registerId}/open`,
    input.cashierUid,
    { openingFloatMinor: input.openingFloatMinor ?? 100_000 },
  );
  expectStatus(opened, 201);

  return {
    registerId,
    sessionId: opened.body.session.id as string,
    shiftId: opened.body.shift.id as string,
    operationalDate: opened.body.session.operationalDate as string,
  };
}

/** Venta pagada en efectivo de una sola línea. Devuelve la venta final y el ticket. */
export async function sellForCash(
  app: Express,
  input: {
    cashierUid: string;
    productoId: string;
    tallaId?: string;
    quantity?: number;
    receivedMinor?: number;
  },
): Promise<{ saleId: string; totalMinor: number; itemId: string }> {
  const client = api(app);

  const sale = await client.post("/api/pos/v1/sales", input.cashierUid, {});
  expectStatus(sale, 201);
  const saleId = sale.body.sale.id as string;

  const item = await client.post(
    `/api/pos/v1/sales/${saleId}/items`,
    input.cashierUid,
    {
      productoId: input.productoId,
      tallaId: input.tallaId ?? null,
      quantity: input.quantity ?? 1,
    },
  );
  expectStatus(item, 201);
  const itemId = item.body.sale.items[0].itemId as string;
  const totalMinor = item.body.sale.totals.totalMinor as number;

  const preview = await client.post(
    `/api/pos/v1/sales/${saleId}/checkout-preview`,
    input.cashierUid,
  );
  expectStatus(preview, 200);

  const payment = await client.post(
    `/api/pos/v1/sales/${saleId}/payments/cash`,
    input.cashierUid,
    { receivedMinor: input.receivedMinor ?? totalMinor },
  );
  expectStatus(payment, 201);

  return { saleId, totalMinor, itemId };
}

/** Denominaciones que suman exactamente el importe pedido con las monedas por defecto. */
export function denominationsFor(
  amountMinor: number,
): Array<{ denominationMinor: number; pieces: number }> {
  const available = [
    100_000, 50_000, 20_000, 10_000, 5_000, 2_000, 1_000, 500, 200, 100, 50,
  ];
  const result: Array<{ denominationMinor: number; pieces: number }> = [];
  let remaining = amountMinor;
  for (const denominationMinor of available) {
    const pieces = Math.floor(remaining / denominationMinor);
    if (pieces > 0) {
      result.push({ denominationMinor, pieces });
      remaining -= pieces * denominationMinor;
    }
  }
  if (remaining !== 0) {
    throw new Error(
      `El importe ${amountMinor} no es representable con las denominaciones por defecto.`,
    );
  }
  return result.length > 0 ? result : [{ denominationMinor: 100, pieces: 0 }];
}

/** Mensaje de error legible cuando una respuesta no trae el status esperado. */
export function expectStatus(
  response: { status: number; body: unknown },
  expected: number,
): void {
  if (response.status !== expected) {
    throw new Error(
      `Se esperaba HTTP ${expected} y se recibió ${response.status}: ${JSON.stringify(
        response.body,
      )}`,
    );
  }
}
