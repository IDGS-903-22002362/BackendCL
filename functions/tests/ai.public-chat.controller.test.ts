jest.mock("../src/services/ai/ai-chat.service", () => ({
  __esModule: true,
  default: {
    createPublicSession: jest.fn(),
    sendPublicMessage: jest.fn(),
    sendPublicMessageStream: jest.fn(),
    assertPublicMessageExecutionReady: jest.fn(),
  },
}));

import {
  createPublicSession,
  sendPublicMessage,
} from "../src/controllers/ai/chat.controller";
import aiChatService from "../src/services/ai/ai-chat.service";

const mockedAiChatService = aiChatService as jest.Mocked<typeof aiChatService>;

describe("public chat controller", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("crea una sesion guest y devuelve publicAccessToken", async () => {
    mockedAiChatService.createPublicSession.mockResolvedValue({
      session: { id: "guest-session-1" },
      publicAccessToken: "token-publico",
    } as never);

    const req = {
      body: {
        channel: "web_guest",
        title: "Consulta rapida",
      },
    } as any;
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    } as any;

    await createPublicSession(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: {
        session: { id: "guest-session-1" },
        publicAccessToken: "token-publico",
      },
    });
  });

  it("envia mensaje guest en JSON", async () => {
    mockedAiChatService.sendPublicMessage.mockResolvedValue({
      text: "Tengo disponible el jersey local y el visitante.",
      toolCalls: [],
      model: "gemini-test",
      latencyMs: 80,
    } as never);

    const req = {
      body: {
        sessionId: "guest-session-1",
        publicAccessToken: "token-publico",
        message: "que jerseys tienes",
      },
      query: {},
      headers: { accept: "application/json" },
      requestId: "req-public-1",
    } as any;
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    } as any;

    await sendPublicMessage(req, res);

    expect(mockedAiChatService.sendPublicMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "guest-session-1",
        publicAccessToken: "token-publico",
      }),
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });
});
