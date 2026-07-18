import { Request, Response, NextFunction } from "express";
import { optionalAppCheckMiddleware } from "../src/utils/middlewares";
import { paymentStaffMiddleware } from "../src/middleware/payments-auth.middleware";
import { RolUsuario } from "../src/models/usuario.model";

jest.mock("firebase-admin/app-check", () => ({
  getAppCheck: () => ({
    verifyToken: jest.fn(async (token: string) => {
      if (token === "valid-token") {
        return { appId: "test-app" };
      }
      throw new Error("invalid");
    }),
  }),
}));

function createMockResponse() {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  } as Response & { statusCode: number; body: unknown };

  return res;
}

describe("optionalAppCheckMiddleware", () => {
  const originalEnforced = process.env.APP_CHECK_ENFORCED;

  afterEach(() => {
    process.env.APP_CHECK_ENFORCED = originalEnforced;
    jest.clearAllMocks();
  });

  it("omite webhooks de Stripe", async () => {
    const req = {
      path: "/api/stripe/webhook",
      originalUrl: "/api/stripe/webhook",
      method: "POST",
      header: jest.fn(),
    } as unknown as Request;
    const res = createMockResponse();
    const next = jest.fn() as NextFunction;

    await optionalAppCheckMiddleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
  });

  it("en modo observacion permite requests sin token", async () => {
    process.env.APP_CHECK_ENFORCED = "false";

    const req = {
      path: "/api/checkout/attempts",
      originalUrl: "/api/checkout/attempts",
      method: "POST",
      header: jest.fn().mockReturnValue(undefined),
    } as unknown as Request;
    const res = createMockResponse();
    const next = jest.fn() as NextFunction;

    await optionalAppCheckMiddleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
  });

  it("rechaza requests sin token cuando APP_CHECK_ENFORCED=true", async () => {
    process.env.APP_CHECK_ENFORCED = "true";

    const req = {
      path: "/notificaciones/subscribe",
      originalUrl: "/api/notificaciones/subscribe",
      method: "POST",
      header: jest.fn().mockReturnValue(undefined),
    } as unknown as Request;
    const res = createMockResponse();
    const next = jest.fn() as NextFunction;

    await optionalAppCheckMiddleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });

  it("omite App Check en lookup de email (anti-enumeracion interna)", async () => {
    process.env.APP_CHECK_ENFORCED = "true";

    const req = {
      path: "/usuarios/exists/email",
      originalUrl: "/usuarios/exists/email?email=test@example.com",
      method: "GET",
      header: jest.fn().mockReturnValue(undefined),
    } as unknown as Request;
    const res = createMockResponse();
    const next = jest.fn() as NextFunction;

    await optionalAppCheckMiddleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
  });

  it("permite GET publico de catalogo sin token cuando APP_CHECK_ENFORCED=true", async () => {
    process.env.APP_CHECK_ENFORCED = "true";

    const req = {
      path: "/productos",
      originalUrl: "/api/productos",
      method: "GET",
      header: jest.fn().mockReturnValue(undefined),
    } as unknown as Request;
    const res = createMockResponse();
    const next = jest.fn() as NextFunction;

    await optionalAppCheckMiddleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
  });

  it("omite App Check cuando hay Authorization Bearer", async () => {
    process.env.APP_CHECK_ENFORCED = "true";

    const req = {
      path: "/inventario/resumen-operativo",
      originalUrl: "/api/inventario/resumen-operativo",
      method: "GET",
      header: jest.fn((name: string) =>
        name.toLowerCase() === "authorization" ? "Bearer jwt-token" : undefined,
      ),
    } as unknown as Request;
    const res = createMockResponse();
    const next = jest.fn() as NextFunction;

    await optionalAppCheckMiddleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
  });

  it("permite POST publico de ofertas calcular-precios sin token", async () => {
    process.env.APP_CHECK_ENFORCED = "true";

    const req = {
      path: "/ofertas/calcular-precios",
      originalUrl: "/api/ofertas/calcular-precios",
      method: "POST",
      header: jest.fn().mockReturnValue(undefined),
    } as unknown as Request;
    const res = createMockResponse();
    const next = jest.fn() as NextFunction;

    await optionalAppCheckMiddleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
  });

  it("permite GET de tallas sin token", async () => {
    process.env.APP_CHECK_ENFORCED = "true";

    const req = {
      path: "/tallas",
      originalUrl: "/api/tallas",
      method: "GET",
      header: jest.fn().mockReturnValue(undefined),
    } as unknown as Request;
    const res = createMockResponse();
    const next = jest.fn() as NextFunction;

    await optionalAppCheckMiddleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
  });
});

describe("firebase rules static validation", () => {
  const fs = require("fs") as typeof import("fs");
  const path = require("path") as typeof import("path");

  const firestoreRules = fs.readFileSync(
    path.resolve(__dirname, "../../firestore.rules"),
    "utf8",
  );
  const storageRules = fs.readFileSync(
    path.resolve(__dirname, "../../storage.rules"),
    "utf8",
  );

  it("firestore denies default access", () => {
    expect(firestoreRules).toMatch(/allow read, write: if false/);

    const publicReadCollections = Array.from(
      firestoreRules.matchAll(
        /match \/([^/]+)\/\{[^}]+\}\s*\{\s*allow read: if true;/g,
      ),
      (match) => match[1],
    );

    expect(publicReadCollections).toEqual([
      "liga_mx_contexto_actual",
      "liga_mx_calendarios_actuales",
      "liga_mx_clasificaciones_actuales",
      "liga_mx_plantillas_actuales",
      "liga_mx_jugadores_actuales",
      "liga_mx_partidos_actuales",
      "liga_mx_detalles_partido_actuales",
    ]);
  });

  it("storage denies all client access", () => {
    expect(storageRules).toMatch(/allow read,\s*write: if false/);
  });
});

describe("paymentStaffMiddleware", () => {
  const createStaffMockResponse = () => {
    const res: Record<string, jest.Mock> = {
      status: jest.fn(),
      json: jest.fn(),
    };
    res.status.mockReturnValue(res);
    return res;
  };

  it("allows SUPER_ADMIN in addition to ADMIN and EMPLEADO", () => {
    const req = {
      user: { uid: "sa1", rol: RolUsuario.SUPER_ADMIN },
    } as Parameters<typeof paymentStaffMiddleware>[0];
    const res = createStaffMockResponse();
    const next = jest.fn();

    paymentStaffMiddleware(req, res as never, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("rejects CLIENTE", () => {
    const req = {
      user: { uid: "c1", rol: RolUsuario.CLIENTE },
    } as Parameters<typeof paymentStaffMiddleware>[0];
    const res = createStaffMockResponse();
    const next = jest.fn();

    paymentStaffMiddleware(req, res as never, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });
});
