jest.mock("../src/services/ai/adapters/gemini.adapter", () => ({
  __esModule: true,
  default: {
    generate: jest.fn(),
    generateStructured: jest.fn(),
  },
}));

import chatPlannerService from "../src/services/ai/planning/chat-planner.service";
import geminiAdapter from "../src/services/ai/adapters/gemini.adapter";
import { AiAgentType } from "../src/models/ai/ai.model";
import { RuntimeAiToolDefinition } from "../src/services/ai/tools/types";

const mockedGeminiAdapter = geminiAdapter as jest.Mocked<typeof geminiAdapter>;

const allowedTools = [
  {
    name: "buscar_productos",
    description: "Buscar productos",
  },
] as RuntimeAiToolDefinition[];

describe("chat planner fallback UX", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("conserva fallback local si Gemini falla y no intenta Vertex", async () => {
    mockedGeminiAdapter.generateStructured.mockRejectedValue(
      new Error("Gemini Developer API unavailable"),
    );

    const result = await chatPlannerService.plan({
      message: "hola",
      allowedTools,
      sessionMode: "guest",
      agentType: AiAgentType.SHOPPING,
      requestId: "req-planner-fallback",
    });

    expect(mockedGeminiAdapter.generateStructured).toHaveBeenCalledTimes(1);
    expect(mockedGeminiAdapter.generateStructured.mock.calls[0][0]).toMatchObject({
      purpose: "fast",
    });
    expect(result.plan.finalAnswer).toContain(
      "Voy a revisar informacion real de la tienda",
    );
    expect(JSON.stringify(mockedGeminiAdapter.generateStructured.mock.calls)).not.toContain(
      "vertexai",
    );
  });
});
