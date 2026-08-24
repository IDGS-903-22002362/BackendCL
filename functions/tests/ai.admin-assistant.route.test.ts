import { NextFunction, Request, Response } from "express";

const mockPass = (_req: Request, _res: Response, next: NextFunction) => next();

let currentUser: { uid: string; rol: string } | null = null;

jest.mock("../src/middleware/ai-app-check.middleware", () => ({
  aiAppCheckMiddleware: (req: Request, res: Response, next: NextFunction) => {
    if (req.header("x-firebase-appcheck") !== "valid-app-check") {
      return res
        .status(401)
        .json({ success: false, code: "AI_APP_CHECK_FAILED" });
    }
    return next();
  },
}));

jest.mock("../src/utils/middlewares", () => ({
  authMiddleware: (req: Request, res: Response, next: NextFunction) => {
    if (!currentUser) {
      return res
        .status(401)
        .json({ success: false, message: "No autenticado" });
    }
    req.user = currentUser as never;
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
  getTryOnEligibility: mockNotUsed,
  createTryOnJob: mockNotUsed,
  listTryOnJobs: mockNotUsed,
  getTryOnJob: mockNotUsed,
  getTryOnDownloadLink: mockNotUsed,
  streamTryOnImage: mockNotUsed,
}));

jest.mock("../src/services/ai/analytics/admin-report.service", () => ({
  __esModule: true,
  default: {
    createSession: jest.fn(),
    listSessions: jest.fn(),
    getOwnedSession: jest.fn(),
    listTurns: jest.fn(),
    ask: jest.fn(),
    askStream: jest.fn(),
  },
}));

import express from "express";
import aiRouter from "../src/routes/ai.routes";
import adminAssistantService from "../src/services/ai/analytics/admin-report.service";

const service = adminAssistantService as jest.Mocked<
  typeof adminAssistantService
>;

// supertest ya es dependencia de desarrollo; el repo no incluye sus tipos.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const request = require("supertest");

const app = express();
app.use(express.json());
app.use("/api/ai", aiRouter);

const APP_CHECK = ["X-Firebase-AppCheck", "valid-app-check"] as const;

beforeEach(() => {
  jest.clearAllMocks();
  currentUser = { uid: "admin_1", rol: "ADMIN" };
});

describe("Rutas del Asistente Administrativo", () => {
  it("exige App Check antes que cualquier otra validacion", async () => {
    const response = await request(app)
      .post("/api/ai/admin/assistant/messages")
      .send({ sessionId: "s1", question: "¿Cuanto vendimos hoy?" });

    expect(response.status).toBe(401);
    expect(response.body.code).toBe("AI_APP_CHECK_FAILED");
    expect(service.ask).not.toHaveBeenCalled();
  });

  it("exige usuario autenticado", async () => {
    currentUser = null;

    const response = await request(app)
      .post("/api/ai/admin/assistant/messages")
      .set(...APP_CHECK)
      .send({ sessionId: "s1", question: "¿Cuanto vendimos hoy?" });

    expect(response.status).toBe(401);
    expect(service.ask).not.toHaveBeenCalled();
  });

  it("bloquea a un cliente autenticado que no es administrador", async () => {
    currentUser = { uid: "user_1", rol: "CLIENTE" };

    const response = await request(app)
      .post("/api/ai/admin/assistant/messages")
      .set(...APP_CHECK)
      .send({ sessionId: "s1", question: "¿Cuanto vendimos hoy?" });

    expect(response.status).toBe(403);
    expect(service.ask).not.toHaveBeenCalled();
  });

  it("bloquea a un empleado sin rol admin", async () => {
    currentUser = { uid: "emp_1", rol: "EMPLEADO" };

    const response = await request(app)
      .get("/api/ai/admin/assistant/sessions")
      .set(...APP_CHECK);

    expect(response.status).toBe(403);
    expect(service.listSessions).not.toHaveBeenCalled();
  });

  it("valida la consulta antes de llamar al agente", async () => {
    const tooShort = await request(app)
      .post("/api/ai/admin/assistant/messages")
      .set(...APP_CHECK)
      .send({ sessionId: "s1", question: "ok" });

    const missingSession = await request(app)
      .post("/api/ai/admin/assistant/messages")
      .set(...APP_CHECK)
      .send({ question: "¿Cuanto vendimos hoy?" });

    expect(tooShort.status).toBe(400);
    expect(missingSession.status).toBe(400);
    expect(service.ask).not.toHaveBeenCalled();
  });

  it("responde 404 cuando la sesion no pertenece al administrador", async () => {
    service.getOwnedSession.mockResolvedValue(null);

    const response = await request(app)
      .post("/api/ai/admin/assistant/messages")
      .set(...APP_CHECK)
      .send({ sessionId: "de-otro-admin", question: "¿Cuanto vendimos hoy?" });

    expect(response.status).toBe(404);
    expect(service.getOwnedSession).toHaveBeenCalledWith(
      "de-otro-admin",
      "admin_1",
    );
    expect(service.ask).not.toHaveBeenCalled();
  });

  it("ejecuta el agente con el uid autenticado, ignorando el body", async () => {
    service.getOwnedSession.mockResolvedValue({
      id: "s1",
      userId: "admin_1",
      title: "Ventas",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      turnCount: 0,
    } as never);
    service.ask.mockResolvedValue({
      turnId: "t1",
      report: { summary: "ok", confidence: "alta", blocks: [] },
      trace: { toolsUsed: [] },
    } as never);

    const response = await request(app)
      .post("/api/ai/admin/assistant/messages")
      .set(...APP_CHECK)
      .send({
        sessionId: "s1",
        question: "¿Cuanto vendimos hoy?",
        userId: "otro_admin",
      });

    expect(response.status).toBe(200);
    expect(service.ask).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: "s1", userId: "admin_1" }),
    );
    expect(response.body.data.report.summary).toBe("ok");
  });

  it("crea sesiones solo para el administrador autenticado", async () => {
    service.createSession.mockResolvedValue({
      id: "s2",
      userId: "admin_1",
    } as never);

    const response = await request(app)
      .post("/api/ai/admin/assistant/sessions")
      .set(...APP_CHECK)
      .send({ title: "Informe semanal" });

    expect(response.status).toBe(201);
    expect(service.createSession).toHaveBeenCalledWith({
      userId: "admin_1",
      title: "Informe semanal",
    });
  });
});
