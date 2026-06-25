import { Request, Response, NextFunction } from "express";
import { optionalAppCheckMiddleware } from "../src/utils/middlewares";

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
      path: "/api/checkout/attempts",
      originalUrl: "/api/checkout/attempts",
      method: "POST",
      header: jest.fn().mockReturnValue(undefined),
    } as unknown as Request;
    const res = createMockResponse();
    const next = jest.fn() as NextFunction;

    await optionalAppCheckMiddleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });
});
