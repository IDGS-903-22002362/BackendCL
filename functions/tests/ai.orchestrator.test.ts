jest.mock("../src/services/ai/adapters/gemini.adapter", () => ({
  __esModule: true,
  default: {
    generate: jest.fn(),
    generateStructured: jest.fn(),
  },
}));

jest.mock("../src/services/ai/planning/chat-planner.service", () => ({
  __esModule: true,
  default: {
    plan: jest.fn(),
  },
}));

jest.mock("../src/services/ai/memory/session.service", () => ({
  __esModule: true,
  default: {
    getSessionById: jest.fn(),
    updateSessionSummary: jest.fn(),
    updateConversationState: jest.fn(),
    touchSession: jest.fn(),
    touchGuestSession: jest.fn(),
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

import aiOrchestrator from "../src/services/ai/adapters/ai-orchestrator";
import geminiAdapter from "../src/services/ai/adapters/gemini.adapter";
import chatPlannerService from "../src/services/ai/planning/chat-planner.service";
import aiSessionService from "../src/services/ai/memory/session.service";
import aiMessageService from "../src/services/ai/memory/message.service";
import aiToolCallService from "../src/services/ai/memory/tool-call.service";
import toolRegistryService from "../src/services/ai/rbac/tool-registry.service";
import roleToolMapperService from "../src/services/ai/rbac/role-tool-mapper.service";
import { RolUsuario } from "../src/models/usuario.model";
import {
  AiMessageRole,
  AiSessionMode,
  AiToolCallStatus,
} from "../src/models/ai/ai.model";
import { z } from "zod";

const mockedGeminiAdapter = geminiAdapter as jest.Mocked<typeof geminiAdapter>;
const mockedPlanner = chatPlannerService as jest.Mocked<typeof chatPlannerService>;
const mockedSessionService = aiSessionService as jest.Mocked<
  typeof aiSessionService
>;
const mockedMessageService = aiMessageService as jest.Mocked<
  typeof aiMessageService
>;
const mockedToolCallService = aiToolCallService as jest.Mocked<
  typeof aiToolCallService
>;
const mockedToolRegistryService = toolRegistryService as jest.Mocked<
  typeof toolRegistryService
>;
const mockedRoleToolMapperService = roleToolMapperService as jest.Mocked<
  typeof roleToolMapperService
>;

const createSearchProductsTool = () => ({
  name: "search_products",
  description: "Buscar",
  schema: z
    .object({
      query: z.string().min(1),
      filters: z.record(z.unknown()).optional(),
    })
    .strict(),
  roles: [RolUsuario.CLIENTE],
  public: true,
  execute: jest.fn(),
});

describe("AiOrchestrator.handleMessage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedSessionService.getSessionById.mockResolvedValue({
      id: "session-1",
      userId: "user-1",
      mode: AiSessionMode.AUTHENTICATED,
      summary: "",
      conversationState: {},
    } as never);
    mockedMessageService.listMessagesBySession.mockResolvedValue([] as never);
    mockedToolRegistryService.getAllowedTools.mockReturnValue([] as never);
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

    let toolCallCounter = 0;
    mockedToolCallService.createToolCall.mockImplementation(
      async (payload: { status: string }) =>
        ({
          id: `tool-call-${toolCallCounter += 1}`,
          status: payload.status || AiToolCallStatus.SUCCESS,
        }) as never,
    );
  });

  it("ejecuta el plan estructurado, llama tools permitidas y responde con gemini", async () => {
    const tool = createSearchProductsTool();
    tool.execute.mockResolvedValue({
      products: [
        {
          id: "jersey-2024-local",
          descripcion: "Jersey Oficial Club Leon 2024 Local",
          precioPublico: 1299,
          canonicalLink: "https://clubleon.mx/productos/jersey-2024-local",
        },
      ],
    });
    mockedToolRegistryService.getAllowedTools.mockReturnValue([tool] as never);
    mockedToolRegistryService.getToolByName.mockReturnValue(tool as never);
    mockedPlanner.plan.mockResolvedValue({
      normalized: {
        originalText: "que playeras tienes",
        normalizedText: "que playeras tienes",
        tokens: ["que", "playeras", "tienes"],
        filters: { categoryIds: ["jersey"] },
        references: [],
        topics: [],
        asksForRecommendation: false,
        asksForComparison: false,
        asksForStoreLocation: false,
        mentionsImage: false,
      },
      plan: {
        intent: "product_search",
        confidence: 0.91,
        requiresTools: true,
        toolCalls: [
          {
            toolName: "search_products",
            arguments: {
              query: "que playeras tienes",
              filters: { categoryIds: ["jersey"] },
            },
          },
        ],
        needsClarification: false,
        clarificationQuestion: null,
        sessionUpdates: {
          currentIntent: "product_search",
          activeFilters: { categoryIds: ["jersey"] },
          tone: "commercial",
          preferredLanguage: "es-MX",
        },
        finalAnswer: "Voy a revisar productos reales.",
      },
    } as never);
    mockedGeminiAdapter.generate.mockResolvedValue({
      text: "Tengo disponible el Jersey Oficial Club Leon 2024 Local por $1299 MXN. Aqui lo puedes ver: https://clubleon.mx/productos/jersey-2024-local",
      functionCalls: [],
      response: {} as never,
    });

    const result = await aiOrchestrator.handleMessage({
      sessionId: "session-1",
      userId: "user-1",
      role: RolUsuario.CLIENTE,
      message: "que playeras tienes",
      aiToolScopes: [],
      requestId: "req-1",
      sessionMode: AiSessionMode.AUTHENTICATED,
    });

    expect(tool.execute).toHaveBeenCalledWith(
      {
        query: "que playeras tienes",
        filters: { categoryIds: ["jersey"] },
      },
      expect.objectContaining({
        userId: "user-1",
        sessionId: "session-1",
      }),
    );
    expect(result.text).toContain("Jersey Oficial Club Leon 2024 Local");
    expect(mockedSessionService.updateConversationState).toHaveBeenCalled();
    expect(mockedToolCallService.createToolCall).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: "search_products",
        status: AiToolCallStatus.SUCCESS,
      }),
    );
  });

  it("responde con aclaracion cuando el plan no tiene suficiente contexto", async () => {
    mockedPlanner.plan.mockResolvedValue({
      normalized: {
        originalText: "hay en m",
        normalizedText: "hay en m",
        tokens: ["hay", "en", "m"],
        filters: { sizeIds: ["m"] },
        references: [],
        topics: [],
        asksForRecommendation: false,
        asksForComparison: false,
        asksForStoreLocation: false,
        mentionsImage: false,
      },
      plan: {
        intent: "inventory_check",
        confidence: 0.42,
        requiresTools: false,
        toolCalls: [],
        needsClarification: true,
        clarificationQuestion:
          "Te ayudo. ¿De cual producto hablas exactamente: el jersey local, visitante, infantil u otra opcion?",
        sessionUpdates: {
          currentIntent: "inventory_check",
          activeFilters: { sizeIds: ["m"] },
          pendingClarification: {
            type: "product",
            question:
              "Te ayudo. ¿De cual producto hablas exactamente: el jersey local, visitante, infantil u otra opcion?",
          },
        },
        finalAnswer:
          "Te ayudo. ¿De cual producto hablas exactamente: el jersey local, visitante, infantil u otra opcion?",
      },
    } as never);

    const result = await aiOrchestrator.handleMessage({
      sessionId: "session-1",
      userId: "user-1",
      role: RolUsuario.CLIENTE,
      message: "hay en m",
      aiToolScopes: [],
      requestId: "req-2",
      sessionMode: AiSessionMode.AUTHENTICATED,
    });

    expect(result.text).toContain("¿De cual producto hablas");
    expect(mockedGeminiAdapter.generate).not.toHaveBeenCalled();
    expect(mockedToolCallService.createToolCall).not.toHaveBeenCalled();
  });
});
