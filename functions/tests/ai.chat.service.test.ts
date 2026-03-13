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

import aiChatService from "../src/services/ai/ai-chat.service";
import aiSessionService from "../src/services/ai/memory/session.service";
import aiMessageService from "../src/services/ai/memory/message.service";
import aiToolCallService from "../src/services/ai/memory/tool-call.service";

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

    const result = await aiChatService.getSessionDetail("missing-session");

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
    } as never);
    mockedMessageService.listMessagesBySession.mockResolvedValue([
      { id: "msg-1" },
    ] as never);
    mockedToolCallService.listToolCallsBySession.mockResolvedValue([
      { id: "tool-1" },
    ] as never);

    const result = await aiChatService.getSessionDetail("session-1");

    expect(result).toEqual({
      session: { id: "session-1", userId: "user-1" },
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
});
