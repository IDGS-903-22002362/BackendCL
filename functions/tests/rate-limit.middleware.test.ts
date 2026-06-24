import { Request, Response, NextFunction } from "express";
import { createSimpleRateLimiter } from "../src/middleware/rate-limit.middleware";
import * as rateLimitStore from "../src/services/rate-limit-store.service";

describe("createSimpleRateLimiter", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("cae a memoria local si Firestore falla", async () => {
    jest.spyOn(rateLimitStore, "isDistributedRateLimitEnabled").mockReturnValue(true);
    jest
      .spyOn(rateLimitStore, "consumeDistributedRateLimit")
      .mockRejectedValue(new Error("firestore unavailable"));

    const limiter = createSimpleRateLimiter({
      keyPrefix: "fallback",
      windowMs: 60_000,
      maxRequests: 1,
    });

    const req = {
      ip: "203.0.113.10",
      headers: {},
      user: { uid: "uid_test" },
      header: jest.fn().mockReturnValue(undefined),
    } as unknown as Request;
    const res = {
      statusCode: 200,
      headers: {} as Record<string, string>,
      setHeader(name: string, value: string) {
        this.headers[name] = value;
        return this;
      },
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json() {
        return this;
      },
    } as Response & { statusCode: number; headers: Record<string, string> };
    const next = jest.fn() as NextFunction;

    await limiter(req, res, next);
    await limiter(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(429);
  });
});
