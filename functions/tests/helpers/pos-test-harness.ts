/**
 * Arnés de pruebas del módulo POS.
 *
 * Monta el router real (`src/modules/pos/routes/pos.routes`) sobre una app Express y
 * sustituye únicamente la frontera de infraestructura:
 *
 * - Firestore (`tiendacl` y `(default)`) por el doble en memoria de `fake-firestore`, con
 *   transacciones, versión optimista y detección de conflictos reales.
 * - App Check por un verificador que acepta un token conocido, para poder probar tanto el
 *   modo `enforce` como el rechazo.
 * - `authMiddleware` por una resolución de token contra un directorio de usuarios de prueba,
 *   equivalente a verificar un ID token de Firebase.
 *
 * Todo lo demás (validadores, capacidades, servicios, repositorios, precios, inventario,
 * auditoría, idempotencia) es el código de producción sin modificar.
 *
 * IMPORTANTE: los archivos de prueba deben importar este arnés ANTES de cualquier módulo de
 * `src/` que toque Firestore, porque aquí se registran los mocks de módulo.
 */

/// <reference path="../../src/types/express.d.ts" />

import express, { type Express, type Request, type Response } from "express";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { FakeFirestore } from "./fake-firestore";

// --------------------------------------------------------------------- entorno

process.env.NODE_ENV = "test";
process.env.TZ = "UTC";
// App Check exigido en todas las pruebas: el bypass local queda deshabilitado a propósito.
process.env.POS_APP_CHECK_MODE = "enforce";
delete process.env.POS_APP_CHECK_ALLOW_LOCAL_BYPASS;
delete process.env.RATE_LIMIT_DISTRIBUTED;
delete process.env.K_SERVICE;
delete process.env.FUNCTION_NAME;

export const VALID_APP_CHECK_TOKEN = "pos-test-appcheck-token";
export const TEST_APP_ID = "pos-test-app";

export const tiendaDb = new FakeFirestore();
export const appDb = new FakeFirestore();

interface TestUser {
  uid: string;
  email: string;
  nombre: string;
  rol: string;
  activo: boolean;
}

const testUsers = new Map<string, TestUser>();

// ----------------------------------------------------------------- mocks módulo

jest.mock("../../src/config/firebase", () => ({
  firestoreTienda: tiendaDb,
  storageTienda: {
    bucket: () => {
      throw new Error("Storage no disponible en pruebas");
    },
  },
}));

jest.mock("../../src/config/app.firebase", () => ({
  firestoreApp: appDb,
  authAppOficial: {
    verifyIdToken: async () => {
      throw new Error("verifyIdToken no disponible en pruebas");
    },
  },
  messagingAppOficial: {},
  storageAppOficial: {},
}));

jest.mock("../../src/config/firebase.admin", () => ({
  admin: {
    apps: [],
    app: () => ({ name: "APP_OFICIAL" }),
    initializeApp: () => ({ name: "APP_OFICIAL" }),
    credential: { cert: () => ({}) },
    firestore: { FieldValue, Timestamp },
  },
}));

jest.mock("firebase-admin/app-check", () => ({
  getAppCheck: () => ({
    verifyToken: async (token: string) => {
      if (token !== VALID_APP_CHECK_TOKEN) {
        throw new Error("App Check token inválido");
      }
      return { appId: TEST_APP_ID, token: { exp: Date.now() + 60_000 } };
    },
  }),
}));

/**
 * Registro de logs en memoria. Sustituye únicamente el sumidero: los servicios construyen sus
 * payloads reales, así que las pruebas pueden verificar que no se filtran datos sensibles.
 */
export interface LogRecord {
  level: "debug" | "info" | "warn" | "error";
  message: string;
  context: Record<string, unknown>;
}

export const posLogRecords: LogRecord[] = [];

jest.mock("../../src/utils/logger", () => {
  const record = (level: LogRecord["level"]) =>
    (message: string, context?: Record<string, unknown>): void => {
      posLogRecords.push({ level, message, context: context ?? {} });
    };
  const instance = {
    debug: record("debug"),
    info: record("info"),
    warn: record("warn"),
    error: record("error"),
    child: () => instance,
  };
  return { __esModule: true, logger: instance, default: instance };
});

jest.mock("../../src/utils/middlewares", () => ({
  authMiddleware: (req: Request, res: Response, next: () => void): void => {
    const header = req.header("authorization") ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
    const user = token ? testUsers.get(token) : undefined;
    if (!user) {
      res.status(401).json({ success: false, message: "Token inválido" });
      return;
    }
    if (!user.activo) {
      res.status(403).json({ success: false, message: "Usuario inactivo" });
      return;
    }
    req.user = {
      uid: user.uid,
      email: user.email,
      nombre: user.nombre,
      rol: user.rol,
      activo: user.activo,
    } as Request["user"];
    next();
  },
  validarCampos: (_req: Request, _res: Response, next: () => void): void => next(),
}));

// ------------------------------------------------------------------- app y estado

let requestSequence = 0;

/** App Express mínima con el router POS real montado en su ruta de producción. */
export function buildPosTestApp(): Express {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const posRoutes = require("../../src/modules/pos/routes/pos.routes")
    .default as express.Router;

  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "2mb" }));
  app.use((req, _res, next) => {
    requestSequence += 1;
    req.requestId = `test-req-${requestSequence}`;
    next();
  });
  app.use("/api/pos/v1", posRoutes);
  return app;
}

/** Limpia bases, usuarios y cachés de proceso entre pruebas. */
export function resetPosTestState(): void {
  tiendaDb.reset();
  appDb.reset();
  testUsers.clear();
  posLogRecords.length = 0;

  // Cachés en memoria de los servicios: sin esto una prueba filtra estado a la siguiente.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require("../../src/modules/pos/services/pos-settings.service").posSettingsService.invalidateCache();
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require("../../src/modules/pos/services/pos-authorization.service").clearOperatorCache();
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require("../../src/modules/pos/services/pos-inventory.service").clearPosSizeCache();
}

// ------------------------------------------------------------------- directorio

/**
 * Registra un usuario autenticable. El token de prueba es el propio UID: el arnés lo
 * resuelve igual que `authMiddleware` resolvería un ID token de Firebase.
 */
export function registerTestUser(user: {
  uid: string;
  rol: string;
  nombre?: string;
  email?: string;
  activo?: boolean;
  /** Alta también en el directorio `usuariosApp`, necesaria para resolver autorizadores. */
  inDirectory?: boolean;
}): TestUser {
  const record: TestUser = {
    uid: user.uid,
    email: user.email ?? `${user.uid}@pruebas.local`,
    nombre: user.nombre ?? user.uid,
    rol: user.rol,
    activo: user.activo ?? true,
  };
  testUsers.set(user.uid, record);
  if (user.inDirectory !== false) {
    appDb.seed("usuariosApp", user.uid, { ...record });
  }
  return record;
}

/** Alta en `posOperators`: rol POS explícito por encima del rol del ecommerce. */
export function seedPosOperator(input: {
  uid: string;
  posRole: string;
  active?: boolean;
  displayName?: string;
}): void {
  tiendaDb.seed("posOperators", input.uid, {
    displayName: input.displayName ?? input.uid,
    posRole: input.posRole,
    active: input.active ?? true,
    defaultRegisterId: null,
    updatedBy: "seed",
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  });
}

// -------------------------------------------------------------------- catálogo

export function seedProduct(input: {
  id: string;
  clave: string;
  descripcion: string;
  precioPublico: number;
  existencias?: number;
  activo?: boolean;
  categoriaId?: string;
  lineaId?: string;
  sizes?: Array<{ tallaId: string; cantidad: number }>;
}): void {
  const base: Record<string, unknown> = {
    clave: input.clave,
    descripcion: input.descripcion,
    precioPublico: input.precioPublico,
    activo: input.activo ?? true,
    personalizable: false,
    categoriaId: input.categoriaId ?? null,
    lineaId: input.lineaId ?? null,
  };

  if (input.sizes && input.sizes.length > 0) {
    const total = input.sizes.reduce((sum, size) => sum + size.cantidad, 0);
    base.tallaIds = input.sizes.map((size) => size.tallaId);
    base.inventarioPorTalla = input.sizes.map((size) => ({
      tallaId: size.tallaId,
      cantidad: size.cantidad,
      fisica: size.cantidad,
      reservada: 0,
      noDisponible: 0,
      entrante: 0,
    }));
    base.existencias = total;
    base.disponible = total > 0;
  } else {
    const existencias = input.existencias ?? 0;
    base.tallaIds = [];
    base.inventarioPorTalla = [];
    base.existencias = existencias;
    base.disponible = existencias > 0;
    base.inventarioGlobal = {
      fisica: existencias,
      reservada: 0,
      noDisponible: 0,
      entrante: 0,
      disponible: existencias,
    };
  }

  tiendaDb.seed("productos", input.id, base);
}

export function seedSize(id: string, codigo: string): void {
  tiendaDb.seed("tallas", id, { codigo, nombre: codigo, activo: true });
}

/** Oferta del ecommerce: el POS la consume por el servicio compartido, no la duplica. */
export function seedOffer(input: {
  id: string;
  titulo: string;
  productoIds: string[];
  tipoDescuento: "porcentaje" | "monto";
  valorDescuento: number;
  prioridad?: number;
  combinable?: boolean;
}): void {
  const now = new Date();
  const desde = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const hasta = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  tiendaDb.seed("ofertas", input.id, {
    titulo: input.titulo,
    descripcion: input.titulo,
    estado: true,
    aplicaA: "productos",
    productoIds: input.productoIds,
    categoriaIds: [],
    lineaIds: [],
    tallaIds: [],
    tipoDescuento: input.tipoDescuento,
    valorDescuento: input.valorDescuento,
    prioridad: input.prioridad ?? 1,
    combinable: input.combinable ?? false,
    fechaInicio: Timestamp.fromDate(desde),
    fechaFin: Timestamp.fromDate(hasta),
    createdAt: Timestamp.fromDate(desde),
    updatedAt: Timestamp.fromDate(desde),
    deletedAt: null,
  });
}

// --------------------------------------------------------------------- cabeceras

export interface PosHeaderOptions {
  uid: string;
  idempotencyKey?: string;
  appCheck?: string | false;
  deviceId?: string;
}

export function posHeaders(options: PosHeaderOptions): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${options.uid}`,
    "x-pos-device-id": options.deviceId ?? "test-device-01",
  };
  if (options.appCheck !== false) {
    headers["x-firebase-appcheck"] = options.appCheck ?? VALID_APP_CHECK_TOKEN;
  }
  if (options.idempotencyKey) {
    headers["Idempotency-Key"] = options.idempotencyKey;
  }
  return headers;
}

let idempotencyCounter = 0;

/** Clave de idempotencia única por llamada, salvo que la prueba quiera repetirla. */
export function nextIdempotencyKey(prefix = "idem"): string {
  idempotencyCounter += 1;
  return `${prefix}-${idempotencyCounter}`;
}
