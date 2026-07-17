import { NextFunction, Request, Response } from "express";

const verifyTokenMock = jest.fn();
const logInfoMock = jest.fn();
const logWarnMock = jest.fn();

jest.mock("firebase-admin/app-check", () => ({
  getAppCheck: () => ({
    verifyToken: (...args: unknown[]) => verifyTokenMock(...args),
  }),
}));

jest.mock("../src/config/firebase.admin", () => ({
  admin: {
    app: jest.fn(() => ({ name: "APP_OFICIAL" })),
  },
}));

jest.mock("../src/utils/logger", () => ({
  __esModule: true,
  default: {
    child: () => ({
      info: (...args: unknown[]) => logInfoMock(...args),
      warn: (...args: unknown[]) => logWarnMock(...args),
    }),
  },
}));

import {
  aiAppCheckMiddleware,
  resolveAiAppCheckMode,
} from "../src/middleware/ai-app-check.middleware";

const createRequest = (input: {
  appCheckToken?: string;
  authorization?: string;
} = {}): Request =>
  ({
    path: "/chat/messages",
    originalUrl: "/api/ai/chat/messages",
    method: "POST",
    requestId: "request-1",
    header: jest.fn((name: string) => {
      const normalized = name.toLowerCase();
      if (normalized === "x-firebase-appcheck") {
        return input.appCheckToken;
      }
      if (normalized === "authorization") {
        return input.authorization;
      }
      return undefined;
    }),
  }) as unknown as Request;

const createResponse = (): Response & { statusCode: number; body?: unknown } => {
  const response = {
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
  };

  return response as Response & { statusCode: number; body?: unknown };
};

describe("aiAppCheckMiddleware", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
    delete process.env.K_SERVICE;
    delete process.env.FUNCTION_NAME;
    delete process.env.FUNCTIONS_EMULATOR;
    delete process.env.FIREBASE_EMULATOR_HUB;
    delete process.env.IS_LOCAL;
    delete process.env.AI_APP_CHECK_ALLOW_LOCAL_BYPASS;
    delete process.env.APP_CHECK_ENFORCED;
    process.env.NODE_ENV = "test";
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("verifica con Firebase Admin y permite un token valido", async () => {
    process.env.AI_APP_CHECK_MODE = "enforce";
    verifyTokenMock.mockResolvedValue({ appId: "web-app" });
    const req = createRequest({ appCheckToken: "valid-token.value" });
    const res = createResponse();
    const next = jest.fn() as NextFunction;

    await aiAppCheckMiddleware(req, res, next);

    expect(verifyTokenMock).toHaveBeenCalledWith("valid-token.value");
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(200);
  });

  it("rechaza token ausente en modo enforce con respuesta uniforme", async () => {
    process.env.AI_APP_CHECK_MODE = "enforce";
    const res = createResponse();
    const next = jest.fn() as NextFunction;

    await aiAppCheckMiddleware(createRequest(), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({
      success: false,
      message: "Solicitud no autorizada",
      code: "AI_APP_CHECK_FAILED",
    });
  });

  it("rechaza token invalido o expirado sin registrar su valor", async () => {
    process.env.AI_APP_CHECK_MODE = "enforce";
    verifyTokenMock.mockRejectedValue({ code: "app-check/token-expired" });
    const token = "expired-token.value";
    const res = createResponse();
    const next = jest.fn() as NextFunction;

    await aiAppCheckMiddleware(createRequest({ appCheckToken: token }), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
    const serializedLogs = JSON.stringify([
      ...logInfoMock.mock.calls,
      ...logWarnMock.mock.calls,
    ]);
    expect(serializedLogs).toContain("expired");
    expect(serializedLogs).not.toContain(token);
  });

  it("rechaza un header manipulado antes de llamar Firebase Admin", async () => {
    process.env.AI_APP_CHECK_MODE = "enforce";
    const res = createResponse();
    const next = jest.fn() as NextFunction;

    await aiAppCheckMiddleware(
      createRequest({ appCheckToken: "valid-token.value, attacker-token" }),
      res,
      next,
    );

    expect(verifyTokenMock).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });

  it("no permite que un JWT Bearer valido omita App Check invalido", async () => {
    process.env.AI_APP_CHECK_MODE = "enforce";
    verifyTokenMock.mockRejectedValue({ code: "app-check/invalid-token" });
    const res = createResponse();
    const next = jest.fn() as NextFunction;

    await aiAppCheckMiddleware(
      createRequest({
        appCheckToken: "invalid-token.value",
        authorization: "Bearer valid-jwt",
      }),
      res,
      next,
    );

    expect(verifyTokenMock).toHaveBeenCalledWith("invalid-token.value");
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });

  it("observa sin rechazar cuando el rollout esta en modo observe", async () => {
    process.env.AI_APP_CHECK_MODE = "observe";
    const res = createResponse();
    const next = jest.fn() as NextFunction;

    await aiAppCheckMiddleware(createRequest(), res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(200);
    expect(logInfoMock).toHaveBeenCalledWith(
      "ai_app_check_request",
      expect.objectContaining({
        metric: "ai_app_check_requests_total",
        outcome: "observed",
        reason: "missing",
      }),
    );
  });

  it("permite bypass solo en desarrollo local controlado", async () => {
    process.env.AI_APP_CHECK_MODE = "enforce";
    process.env.AI_APP_CHECK_ALLOW_LOCAL_BYPASS = "true";
    process.env.IS_LOCAL = "true";
    process.env.NODE_ENV = "development";
    const res = createResponse();
    const next = jest.fn() as NextFunction;

    await aiAppCheckMiddleware(createRequest(), res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(verifyTokenMock).not.toHaveBeenCalled();
  });

  it("ignora el bypass local en produccion y falla cerrado por defecto", async () => {
    delete process.env.AI_APP_CHECK_MODE;
    process.env.AI_APP_CHECK_ALLOW_LOCAL_BYPASS = "true";
    process.env.IS_LOCAL = "true";
    process.env.K_SERVICE = "api";
    const res = createResponse();
    const next = jest.fn() as NextFunction;

    expect(resolveAiAppCheckMode()).toBe("enforce");
    await aiAppCheckMiddleware(createRequest(), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });
});
