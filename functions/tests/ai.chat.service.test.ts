jest.mock("../src/services/ai/memory/session.service", () => ({
  __esModule: true,
  default: {
    getSessionById: jest.fn(),
  },
}));

jest.mock("../src/services/ai/memory/message.service", () => ({
  __esModule: true,
  default: {
    listMessagesBySession: jest.fn(),
  },
}));

jest.mock("../src/services/ai/memory/tool-call.service", () => ({
  __esModule: true,
  default: {
    listToolCallsBySession: jest.fn(),
  },
}));

jest.mock("../src/services/ai/adapters/ai-orchestrator", () => ({
  __esModule: true,
  default: {
    handleMessage: jest.fn(),
  },
}));

jest.mock("../src/config/ai.config", () => ({
  __esModule: true,
  assertAiConfig: jest.fn(),
  default: {
    gemini: {
      primaryModel: "gemini-test",
      maxContextMessages: 12,
      maxSummaryChars: 2500,
    },
  },
}));

import aiChatService from "../src/services/ai/ai-chat.service";
import aiSessionService from "../src/services/ai/memory/session.service";
import aiMessageService from "../src/services/ai/memory/message.service";
import aiToolCallService from "../src/services/ai/memory/tool-call.service";
import { AiSessionMode } from "../src/models/ai/ai.model";
import { RolUsuario } from "../src/models/usuario.model";

const mockedSessionService = aiSessionService as jest.Mocked<
  typeof aiSessionService
>;
const mockedMessageService = aiMessageService as jest.Mocked<
  typeof aiMessageService
>;
const mockedToolCallService = aiToolCallService as jest.Mocked<
  typeof aiToolCallService
>;

describe("AiChatService.getSessionDetail", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("retorna session null y evita queries secundarias cuando la sesion no existe", async () => {
    mockedSessionService.getSessionById.mockResolvedValue(null);

    const result = await aiChatService.getSessionDetail(
      "missing-session",
      "user-1",
    );

    expect(result).toEqual({
      session: null,
      messages: [],
      toolCalls: [],
    });
    expect(mockedMessageService.listMessagesBySession).not.toHaveBeenCalled();
    expect(mockedToolCallService.listToolCallsBySession).not.toHaveBeenCalled();
  });

  it("retorna detalle completo cuando la sesion existe", async () => {
    mockedSessionService.getSessionById.mockResolvedValue({
      id: "session-1",
      userId: "user-1",
      mode: AiSessionMode.AUTHENTICATED,
    } as never);
    mockedMessageService.listMessagesBySession.mockResolvedValue([
      { id: "msg-1" },
    ] as never);
    mockedToolCallService.listToolCallsBySession.mockResolvedValue([
      { id: "tool-1" },
    ] as never);

    const result = await aiChatService.getSessionDetail("session-1", "user-1");

    expect(result).toEqual({
      session: {
        id: "session-1",
        userId: "user-1",
        mode: AiSessionMode.AUTHENTICATED,
      },
      messages: [{ id: "msg-1" }],
      toolCalls: [{ id: "tool-1" }],
    });
    expect(mockedMessageService.listMessagesBySession).toHaveBeenCalledWith(
      "session-1",
    );
    expect(mockedToolCallService.listToolCallsBySession).toHaveBeenCalledWith(
      "session-1",
    );
  });

  it.each([
    {
      mode: AiSessionMode.GUEST,
      ownerId: "guest:owner",
      requesterId: "user-1",
    },
    {
      mode: AiSessionMode.AUTHENTICATED,
      ownerId: "user-2",
      requesterId: "user-1",
    },
  ])("bloquea detalle de sesion guest o ajena", async (session) => {
    mockedSessionService.getSessionById.mockResolvedValue({
      id: "session-denied",
      userId: session.ownerId,
      mode: session.mode,
    } as never);

    await expect(
      aiChatService.getSessionDetail("session-denied", session.requesterId),
    ).resolves.toEqual({ session: null, messages: [], toolCalls: [] });
    expect(mockedMessageService.listMessagesBySession).not.toHaveBeenCalled();
    expect(mockedToolCallService.listToolCallsBySession).not.toHaveBeenCalled();
  });

  it("impide que ADMIN opere la sesion autenticada de otro usuario", async () => {
    mockedSessionService.getSessionById.mockResolvedValue({
      id: "customer-session",
      userId: "customer-1",
      mode: AiSessionMode.AUTHENTICATED,
    } as never);

    await expect(
      aiChatService.assertMessageExecutionReady({
        sessionId: "customer-session",
        userId: "admin-1",
        role: RolUsuario.ADMIN,
        message: "actualiza el precio",
      }),
    ).rejects.toMatchObject({ code: "AI_FORBIDDEN", statusCode: 403 });
  });
});
