jest.mock("../src/services/ai/ai-chat.service", () => ({
  __esModule: true,
  default: {
    sendMessage: jest.fn(),
    sendMessageStream: jest.fn(),
    assertMessageExecutionReady: jest.fn(),
  },
}));

import { sendMessage } from "../src/controllers/ai/chat.controller";
import aiChatService from "../src/services/ai/ai-chat.service";
import { RolUsuario } from "../src/models/usuario.model";
import { AiRuntimeError } from "../src/services/ai/ai.error";

const mockedAiChatService = aiChatService as jest.Mocked<typeof aiChatService>;

describe("chat.controller.sendMessage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("emite eventos SSE compatibles para el frontend", async () => {
    mockedAiChatService.assertMessageExecutionReady.mockResolvedValue(
      undefined,
    );
    mockedAiChatService.sendMessageStream.mockImplementation(
      async function* () {
        yield { type: "status", data: { status: "processing" } };
        yield {
          type: "final",
          data: {
            text: "Hola, en que te ayudo?",
            toolCalls: [],
            model: "gemini-test",
            latencyMs: 123,
          },
        };
      },
    );

    const writes: string[] = [];
    const req = {
      body: {
        sessionId: "session-1",
        message: "hola",
        stream: true,
      },
      query: {
        stream: "true",
      },
      headers: {
        accept: "text/event-stream",
      },
      user: {
        uid: "user-1",
        rol: RolUsuario.CLIENTE,
        aiToolScopes: [],
      },
      requestId: "req-1",
    } as any;

    const res = {
      writeHead: jest.fn(),
      flushHeaders: jest.fn(),
      write: jest.fn((chunk: string) => {
        writes.push(chunk);
      }),
      end: jest.fn(),
      status: jest.fn(),
      json: jest.fn(),
    } as any;

    await sendMessage(req, res);

    expect(res.writeHead).toHaveBeenCalledWith(
      200,
      expect.objectContaining({
        "Content-Type": "text/event-stream",
        "X-Accel-Buffering": "no",
      }),
    );
    expect(res.flushHeaders).toHaveBeenCalled();
    expect(writes.join("")).toContain("event: status");
    expect(writes.join("")).toContain("event: final");
    expect(writes.join("")).toContain("event: done");
    expect(writes.join("")).not.toContain("event: message");

    const statusIndex = writes.findIndex((chunk) =>
      chunk.includes("event: status"),
    );
    const finalIndex = writes.findIndex((chunk) =>
      chunk.includes("event: final"),
    );
    const doneIndex = writes.findIndex((chunk) =>
      chunk.includes("event: done"),
    );
    expect(statusIndex).toBeGreaterThanOrEqual(0);
    expect(finalIndex).toBeGreaterThan(statusIndex);
    expect(doneIndex).toBeGreaterThan(finalIndex);
    expect(res.end).toHaveBeenCalled();
  });

  it("emite code estable cuando el stream falla por modelo no soportado", async () => {
    mockedAiChatService.assertMessageExecutionReady.mockResolvedValue(
      undefined,
    );
    mockedAiChatService.sendMessageStream.mockImplementation(
      async function* () {
        yield { type: "status", data: { status: "processing" } };
        yield {
          type: "error",
          data: {
            code: "AI_MODEL_UNSUPPORTED",
            message: "Modelo no soportado",
          },
        };
      },
    );

    const writes: string[] = [];
    const req = {
      body: {
        sessionId: "session-1",
        message: "hola",
        stream: true,
      },
      query: {
        stream: "true",
      },
      headers: {
        accept: "text/event-stream",
      },
      user: {
        uid: "user-1",
        rol: RolUsuario.CLIENTE,
        aiToolScopes: [],
      },
      requestId: "req-1",
    } as any;

    const res = {
      writeHead: jest.fn(),
      flushHeaders: jest.fn(),
      write: jest.fn((chunk: string) => {
        writes.push(chunk);
      }),
      end: jest.fn(),
      status: jest.fn(),
      json: jest.fn(),
    } as any;

    await sendMessage(req, res);

    expect(res.writeHead).toHaveBeenCalledWith(
      200,
      expect.objectContaining({
        "Content-Type": "text/event-stream",
      }),
    );
    expect(writes.join("")).toContain("event: error");
    expect(writes.join("")).toContain('"code":"AI_MODEL_UNSUPPORTED"');
    expect(writes.join("")).toContain("event: done");
  });

  it("devuelve JSON controlado si falla antes de abrir stream", async () => {
    mockedAiChatService.assertMessageExecutionReady.mockRejectedValue(
      new AiRuntimeError(
        "AI_INVALID_CONFIGURATION",
        "Configuracion invalida",
        400,
      ),
    );

    const req = {
      body: {
        sessionId: "session-1",
        message: "hola",
        stream: true,
      },
      query: {
        stream: "true",
      },
      headers: {
        accept: "text/event-stream",
      },
      user: {
        uid: "user-1",
        rol: RolUsuario.CLIENTE,
        aiToolScopes: [],
      },
      requestId: "req-1",
    } as any;

    const res = {
      writeHead: jest.fn(),
      flushHeaders: jest.fn(),
      write: jest.fn(),
      end: jest.fn(),
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    } as any;

    await sendMessage(req, res);

    expect(res.writeHead).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: {
        code: "AI_INVALID_CONFIGURATION",
        message: "Configuracion invalida",
      },
    });
  });

  it("devuelve JSON consistente cuando falla el envio", async () => {
    mockedAiChatService.sendMessage.mockRejectedValue(
      new AiRuntimeError("AI_MODEL_UNSUPPORTED", "Modelo no soportado", 502),
    );

    const req = {
      body: {
        sessionId: "session-1",
        message: "hola",
      },
      query: {},
      headers: {
        accept: "application/json",
      },
      user: {
        uid: "user-1",
        rol: RolUsuario.CLIENTE,
        aiToolScopes: [],
      },
      requestId: "req-1",
    } as any;

    const res = {
      writeHead: jest.fn(),
      flushHeaders: jest.fn(),
      write: jest.fn(),
      end: jest.fn(),
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    } as any;

    await sendMessage(req, res);

    expect(res.status).toHaveBeenCalledWith(502);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: {
        code: "AI_MODEL_UNSUPPORTED",
        message: "Modelo no soportado",
      },
    });
  });
});
