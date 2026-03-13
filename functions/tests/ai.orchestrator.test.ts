jest.mock("../src/services/ai/adapters/gemini.adapter", () => ({
  __esModule: true,
  default: {
    generate: jest.fn(),
  },
}));

jest.mock("../src/services/ai/memory/session.service", () => ({
  __esModule: true,
  default: {
    getSessionById: jest.fn(),
    updateSessionSummary: jest.fn(),
    touchSession: jest.fn(),
  },
}));

jest.mock("../src/services/ai/memory/message.service", () => ({
  __esModule: true,
  default: {
    createMessage: jest.fn(),
    listMessagesBySession: jest.fn(),
  },
}));

jest.mock("../src/services/ai/memory/tool-call.service", () => ({
  __esModule: true,
  default: {
    createToolCall: jest.fn(),
  },
}));

jest.mock("../src/services/ai/rbac/tool-registry.service", () => ({
  __esModule: true,
  default: {
    getAllowedTools: jest.fn(),
    getToolByName: jest.fn(),
  },
}));

jest.mock("../src/services/ai/rbac/role-tool-mapper.service", () => ({
  __esModule: true,
  default: {
    getCapabilities: jest.fn(),
  },
}));

import aiOrchestrator, {
  AI_ASSISTANT_USER_ID,
} from "../src/services/ai/adapters/ai-orchestrator";
import geminiAdapter from "../src/services/ai/adapters/gemini.adapter";
import aiSessionService from "../src/services/ai/memory/session.service";
import aiMessageService from "../src/services/ai/memory/message.service";
import toolRegistryService from "../src/services/ai/rbac/tool-registry.service";
import roleToolMapperService from "../src/services/ai/rbac/role-tool-mapper.service";
import { RolUsuario } from "../src/models/usuario.model";
import { AiMessageRole } from "../src/models/ai/ai.model";

const mockedGeminiAdapter = geminiAdapter as jest.Mocked<typeof geminiAdapter>;
const mockedSessionService = aiSessionService as jest.Mocked<
  typeof aiSessionService
>;
const mockedMessageService = aiMessageService as jest.Mocked<
  typeof aiMessageService
>;
const mockedToolRegistryService = toolRegistryService as jest.Mocked<
  typeof toolRegistryService
>;
const mockedRoleToolMapperService = roleToolMapperService as jest.Mocked<
  typeof roleToolMapperService
>;

describe("AiOrchestrator.handleMessage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedSessionService.getSessionById.mockResolvedValue({
      id: "session-1",
      userId: "user-1",
      summary: "",
    } as never);
    mockedMessageService.listMessagesBySession.mockResolvedValue([] as never);
    mockedToolRegistryService.getAllowedTools.mockReturnValue([]);
    mockedRoleToolMapperService.getCapabilities.mockReturnValue([] as never);
    mockedMessageService.createMessage
      .mockResolvedValueOnce({
        id: "user-msg-1",
        role: AiMessageRole.USER,
      } as never)
      .mockResolvedValueOnce({
        id: "assistant-msg-1",
        role: AiMessageRole.ASSISTANT,
      } as never);
  });

  it("usa un remitente de asistente estable y texto fallback cuando Gemini responde vacio", async () => {
    mockedGeminiAdapter.generate.mockResolvedValue({
      text: "   ",
      functionCalls: [],
      response: {} as never,
    });

    const result = await aiOrchestrator.handleMessage({
      sessionId: "session-1",
      userId: "user-1",
      role: RolUsuario.CLIENTE,
      message: "hola",
      aiToolScopes: [],
      requestId: "req-1",
    });

    expect(result.text).toBe(
      "No pude generar una respuesta en este momento. Intenta nuevamente.",
    );
    expect(mockedMessageService.createMessage).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        sessionId: "session-1",
        userId: AI_ASSISTANT_USER_ID,
        role: AiMessageRole.ASSISTANT,
        content:
          "No pude generar una respuesta en este momento. Intenta nuevamente.",
        toolCallIds: [],
      }),
    );
    expect(mockedSessionService.updateSessionSummary).toHaveBeenCalledWith(
      "session-1",
      expect.stringContaining(
        "Asistente: No pude generar una respuesta en este momento. Intenta nuevamente.",
      ),
    );
  });
});
