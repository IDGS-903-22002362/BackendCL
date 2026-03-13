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

import aiConfig from "../src/config/ai.config";
import aiOrchestrator, {
  AI_ASSISTANT_USER_ID,
} from "../src/services/ai/adapters/ai-orchestrator";
import geminiAdapter from "../src/services/ai/adapters/gemini.adapter";
import aiSessionService from "../src/services/ai/memory/session.service";
import aiMessageService from "../src/services/ai/memory/message.service";
import aiToolCallService from "../src/services/ai/memory/tool-call.service";
import toolRegistryService from "../src/services/ai/rbac/tool-registry.service";
import roleToolMapperService from "../src/services/ai/rbac/role-tool-mapper.service";
import { RolUsuario } from "../src/models/usuario.model";
import { AiMessageRole, AiToolCallStatus } from "../src/models/ai/ai.model";
import { AiRuntimeError } from "../src/services/ai/ai.error";
import { z } from "zod";

const mockedGeminiAdapter = geminiAdapter as jest.Mocked<typeof geminiAdapter>;
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
    })
    .strict(),
  roles: [RolUsuario.CLIENTE],
  execute: jest.fn(),
});

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

    let toolCallCounter = 0;
    mockedToolCallService.createToolCall.mockImplementation(
      async (payload: { status: string }) =>
        ({
          id: `tool-call-${toolCallCounter += 1}`,
          status: payload.status || AiToolCallStatus.SUCCESS,
        }) as never,
    );
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

  it("reintenta sin tools cuando Gemini rechaza el schema o la configuracion de tools", async () => {
    mockedToolRegistryService.getAllowedTools.mockReturnValue([
      createSearchProductsTool() as never,
    ]);
    mockedGeminiAdapter.generate
      .mockRejectedValueOnce(
        new AiRuntimeError(
          "AI_INVALID_CONFIGURATION",
          "Schema invalido de tool calling",
          400,
        ),
      )
      .mockResolvedValueOnce({
        text: "Respuesta fallback",
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

    expect(result.text).toBe("Respuesta fallback");
    expect(mockedGeminiAdapter.generate).toHaveBeenCalledTimes(2);
    expect(mockedGeminiAdapter.generate).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        tools: expect.any(Array),
      }),
    );
    expect(mockedGeminiAdapter.generate).toHaveBeenNthCalledWith(
      1,
      expect.not.objectContaining({
        allowedFunctionNames: expect.anything(),
      }),
    );
    expect(mockedGeminiAdapter.generate).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        model: expect.any(String),
        contents: expect.any(Array),
        systemInstruction: expect.any(String),
      }),
    );
    expect(mockedGeminiAdapter.generate).toHaveBeenNthCalledWith(
      2,
      expect.not.objectContaining({
        tools: expect.anything(),
      }),
    );
  });

  it("envia function responses reales y obtiene texto final despues de ejecutar tools", async () => {
    const tool = createSearchProductsTool();
    tool.execute.mockResolvedValue({
      products: [{ id: "jersey-2024", descripcion: "Jersey Oficial 2024" }],
    });
    mockedToolRegistryService.getAllowedTools.mockReturnValue([tool as never]);
    mockedToolRegistryService.getToolByName.mockReturnValue(tool as never);
    mockedGeminiAdapter.generate
      .mockResolvedValueOnce({
        text: "",
        functionCalls: [
          {
            id: "call-1",
            name: "search_products",
            args: { query: "jersey oficial 2024" },
          },
        ],
        response: {} as never,
      })
      .mockResolvedValueOnce({
        text: "El Jersey Oficial 2024 destaca por su diseño local y disponibilidad actual en catalogo.",
        functionCalls: [],
        response: {} as never,
      });

    const result = await aiOrchestrator.handleMessage({
      sessionId: "session-1",
      userId: "user-1",
      role: RolUsuario.CLIENTE,
      message: "Explícame las características del jersey",
      aiToolScopes: [],
      requestId: "req-1",
    });

    expect(result.text).toContain("Jersey Oficial 2024");
    expect(tool.execute).toHaveBeenCalledWith(
      { query: "jersey oficial 2024" },
      expect.objectContaining({
        userId: "user-1",
      }),
    );
    expect(mockedGeminiAdapter.generate).toHaveBeenCalledTimes(2);
    const secondCall = mockedGeminiAdapter.generate.mock.calls[1][0] as {
      contents: Array<{
        role: string;
        parts: Array<Record<string, unknown>>;
      }>;
    };
    expect(secondCall.contents).toHaveLength(3);
    expect(secondCall.contents[1]).toMatchObject({
      role: "model",
    });
    expect(secondCall.contents[1].parts[0]).toEqual(
      expect.objectContaining({
        functionCall: expect.objectContaining({
          name: "search_products",
        }),
      }),
    );
    expect(secondCall.contents[2]).toMatchObject({
      role: "user",
    });
    expect(secondCall.contents[2].parts[0]).toEqual(
      expect.objectContaining({
        functionResponse: expect.objectContaining({
          name: "search_products",
        }),
      }),
    );
  });

  it("corta loops repetidos sin reejecutar tools y sintetiza sin tools", async () => {
    const tool = createSearchProductsTool();
    tool.execute.mockResolvedValue({
      products: [{ id: "jersey-2024" }],
    });
    mockedToolRegistryService.getAllowedTools.mockReturnValue([tool as never]);
    mockedToolRegistryService.getToolByName.mockReturnValue(tool as never);
    mockedGeminiAdapter.generate
      .mockResolvedValueOnce({
        text: "",
        functionCalls: [
          {
            id: "call-1",
            name: "search_products",
            args: { query: "jersey oficial 2024" },
          },
        ],
        response: {} as never,
      })
      .mockResolvedValueOnce({
        text: "",
        functionCalls: [
          {
            id: "call-2",
            name: "search_products",
            args: { query: "jersey oficial 2024" },
          },
        ],
        response: {} as never,
      })
      .mockResolvedValueOnce({
        text: "Con la informacion disponible, el jersey local 2024 ya fue identificado.",
        functionCalls: [],
        response: {} as never,
      });

    const result = await aiOrchestrator.handleMessage({
      sessionId: "session-1",
      userId: "user-1",
      role: RolUsuario.CLIENTE,
      message: "Háblame del jersey local",
      aiToolScopes: [],
      requestId: "req-1",
    });

    expect(result.text).toContain("jersey local 2024");
    expect(tool.execute).toHaveBeenCalledTimes(1);
    expect(mockedGeminiAdapter.generate).toHaveBeenCalledTimes(3);
    expect(mockedGeminiAdapter.generate).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        contents: expect.any(Array),
      }),
    );
    expect(mockedGeminiAdapter.generate).toHaveBeenNthCalledWith(
      3,
      expect.not.objectContaining({
        tools: expect.anything(),
      }),
    );
  });

  it("sintetiza una respuesta final al alcanzar maxToolSteps en lugar de lanzar 500", async () => {
    const tool = createSearchProductsTool();
    tool.execute.mockResolvedValue({
      products: [{ id: "jersey-2024" }],
    });
    mockedToolRegistryService.getAllowedTools.mockReturnValue([tool as never]);
    mockedToolRegistryService.getToolByName.mockReturnValue(tool as never);

    const toolResponses = Array.from(
      { length: aiConfig.gemini.maxToolSteps },
      (_, index) => ({
        text: "",
        functionCalls: [
          {
            id: `call-${index + 1}`,
            name: "search_products",
            args: { query: `jersey oficial ${index + 1}` },
          },
        ],
        response: {} as never,
      }),
    );
    for (const response of toolResponses) {
      mockedGeminiAdapter.generate.mockResolvedValueOnce(response);
    }
    mockedGeminiAdapter.generate.mockResolvedValueOnce({
      text: "Respuesta final sintetizada despues de consultar tools.",
      functionCalls: [],
      response: {} as never,
    });

    const result = await aiOrchestrator.handleMessage({
      sessionId: "session-1",
      userId: "user-1",
      role: RolUsuario.CLIENTE,
      message: "Resume lo encontrado del jersey",
      aiToolScopes: [],
      requestId: "req-1",
    });

    expect(result.text).toContain("Respuesta final sintetizada");
    expect(tool.execute).toHaveBeenCalledTimes(aiConfig.gemini.maxToolSteps);
    expect(mockedGeminiAdapter.generate).toHaveBeenCalledTimes(
      aiConfig.gemini.maxToolSteps + 1,
    );
  });
});
