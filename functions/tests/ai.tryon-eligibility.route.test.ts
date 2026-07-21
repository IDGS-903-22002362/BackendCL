import { NextFunction, Request, Response } from "express";

const mockPass = (_req: Request, _res: Response, next: NextFunction) => next();

jest.mock("../src/middleware/ai-app-check.middleware", () => ({
  aiAppCheckMiddleware: (req: Request, res: Response, next: NextFunction) => {
    if (req.header("x-firebase-appcheck") !== "valid-app-check") {
      return res.status(401).json({ success: false, code: "AI_APP_CHECK_FAILED" });
    }
    return next();
  },
}));

jest.mock("../src/utils/middlewares", () => ({
  authMiddleware: (req: Request, res: Response, next: NextFunction) => {
    if (req.header("authorization") !== "Bearer valid-user") {
      return res.status(401).json({ success: false, message: "No autenticado" });
    }
    req.user = { uid: "user_1", rol: "CLIENTE" } as never;
    return next();
  },
}));

jest.mock("../src/middleware/ai-rate-limit.middleware", () => ({
  aiAdminChatRateLimiter: mockPass,
  aiChatRateLimiter: mockPass,
  aiPublicChatRateLimiter: mockPass,
  aiUploadRateLimiter: mockPass,
}));

jest.mock("../src/middleware/ai-tryon.middleware", () => ({
  aiTryOnPollRateLimiter: mockPass,
  aiTryOnUserRateLimiter: mockPass,
  requireTryOnEnabled: mockPass,
}));

jest.mock("../src/middleware/multipart.middleware", () => ({
  parseMultipartImages: () => mockPass,
}));

jest.mock("../src/middleware/ai-authz.middleware", () => ({
  requireAiAdmin: mockPass,
}));

const mockNotUsed = (_req: Request, res: Response) => res.status(204).send();

jest.mock("../src/controllers/ai/chat.controller", () => ({
  createPublicSession: mockNotUsed,
  sendPublicMessage: mockNotUsed,
  createSession: mockNotUsed,
  listSessions: mockNotUsed,
  getSessionDetail: mockNotUsed,
  sendMessage: mockNotUsed,
  createAdminSession: mockNotUsed,
  listAdminSessions: mockNotUsed,
  getAdminSessionDetail: mockNotUsed,
  sendAdminMessage: mockNotUsed,
}));

jest.mock("../src/controllers/ai/files.controller", () => ({
  uploadUserImage: mockNotUsed,
  deleteUserImage: mockNotUsed,
}));

jest.mock("../src/controllers/ai/admin.controller", () => ({
  getMetrics: mockNotUsed,
  listJobs: mockNotUsed,
}));

jest.mock("../src/controllers/ai/tryon.controller", () => ({
  getTryOnEligibility: (req: Request, res: Response) =>
    res.status(200).json({
      success: true,
      data: {
        userId: req.user?.uid,
        productId: req.body.productId,
        sessionId: req.body.sessionId,
      },
    }),
  createTryOnJob: mockNotUsed,
  listTryOnJobs: mockNotUsed,
  getTryOnJob: mockNotUsed,
  getTryOnDownloadLink: mockNotUsed,
  streamTryOnImage: mockNotUsed,
}));

import express from "express";
import aiRouter from "../src/routes/ai.routes";

// supertest is already a dev dependency; this repository does not ship its
// ambient declaration package, so keep the focused route harness local.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const request = require("supertest");

describe("POST /api/ai/tryon/eligibility route guards", () => {
  const app = express();
  app.use(express.json());
  app.use("/api/ai", aiRouter);

  it("requiere App Check antes de autenticacion", async () => {
    const response = await request(app)
      .post("/api/ai/tryon/eligibility")
      .set("Authorization", "Bearer valid-user")
      .send({ productId: "prod_1" });

    expect(response.status).toBe(401);
    expect(response.body.code).toBe("AI_APP_CHECK_FAILED");
  });

  it("requiere usuario autenticado aun con App Check valido", async () => {
    const response = await request(app)
      .post("/api/ai/tryon/eligibility")
      .set("X-Firebase-AppCheck", "valid-app-check")
      .send({ productId: "prod_1" });

    expect(response.status).toBe(401);
    expect(response.body.message).toBe("No autenticado");
  });

  it("permite solo identificadores validados y usa el uid autenticado", async () => {
    const ok = await request(app)
      .post("/api/ai/tryon/eligibility")
      .set("X-Firebase-AppCheck", "valid-app-check")
      .set("Authorization", "Bearer valid-user")
      .send({
        productId: "prod_1",
        userImageAssetId: "asset_1",
        sessionId: "session_1",
      });

    const missingSession = await request(app)
      .post("/api/ai/tryon/eligibility")
      .set("X-Firebase-AppCheck", "valid-app-check")
      .set("Authorization", "Bearer valid-user")
      .send({ productId: "prod_1", userImageAssetId: "asset_1" });

    const injected = await request(app)
      .post("/api/ai/tryon/eligibility")
      .set("X-Firebase-AppCheck", "valid-app-check")
      .set("Authorization", "Bearer valid-user")
      .send({ productId: "prod_1", price: 1, eligible: true });

    expect(ok.status).toBe(200);
    expect(ok.body.data).toEqual({
      userId: "user_1",
      productId: "prod_1",
      sessionId: "session_1",
    });
    expect(missingSession.status).toBe(400);
    expect(injected.status).toBe(400);
  });
});
