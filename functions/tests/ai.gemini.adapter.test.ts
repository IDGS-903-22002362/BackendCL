const functionCallingModes = {
  AUTO: "AUTO",
  ANY: "ANY",
};

const thinkingLevels = {
  LOW: "LOW",
  MEDIUM: "MEDIUM",
  HIGH: "HIGH",
  MINIMAL: "MINIMAL",
};

const logCalls: unknown[][] = [];

const mockGoogleGenAi = (generateContent: jest.Mock) => {
  logCalls.length = 0;
  const GoogleGenAI = jest.fn().mockImplementation(() => ({
    models: {
      generateContent,
    },
  }));
  const childLogger = {
    info: (...args: unknown[]) => {
      logCalls.push(["info", ...args]);
    },
    warn: (...args: unknown[]) => {
      logCalls.push(["warn", ...args]);
    },
    error: (...args: unknown[]) => {
      logCalls.push(["error", ...args]);
    },
    debug: (...args: unknown[]) => {
      logCalls.push(["debug", ...args]);
    },
    child() {
      return childLogger;
    },
  };

  jest.doMock("@google/genai", () => ({
    GoogleGenAI,
    FunctionCallingConfigMode: functionCallingModes,
    ThinkingLevel: thinkingLevels,
  }));
  jest.doMock("../src/utils/logger", () => ({
    __esModule: true,
    default: childLogger,
    logger: childLogger,
  }));

  return GoogleGenAI;
};

describe("GeminiAdapter", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.resetModules();
    process.env = {
      ...originalEnv,
      AI_GEMINI_MODE: "apiKey",
      GEMINI_API_KEY: "test-gemini-key",
      AI_STORAGE_BUCKET: "bucket-test",
      GEMINI_MODEL_MAIN: "gemini-3.7-flash",
      GEMINI_MODEL_PRIMARY: "gemini-3.7-flash",
      GEMINI_MODEL_FAST: "gemini-3.7-flash",
      GEMINI_MODEL_SUMMARY: "gemini-3.5-flash-lite",
      GEMINI_THINKING_LEVEL_MAIN: "medium",
      GEMINI_THINKING_LEVEL_FAST: "low",
    };
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    delete process.env.GOOGLE_GENAI_USE_VERTEXAI;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("remapea 404 unsupported methods a AI_MODEL_UNSUPPORTED", async () => {
    const generateContent = jest.fn().mockRejectedValue(
      Object.assign(
        new Error("404 NOT_FOUND models/gemini-3.7-foo unsupported methods"),
        {
          status: 404,
        },
      ),
    );

    mockGoogleGenAi(generateContent);

    const {
      default: geminiAdapter,
    } = require("../src/services/ai/adapters/gemini.adapter");

    await expect(
      geminiAdapter.generate({
        prompt: "hola",
        purpose: "main",
      }),
    ).rejects.toMatchObject({
      code: "AI_MODEL_UNSUPPORTED",
      message:
        'El modelo "gemini-3.7-flash" no soporta generateContent con la configuracion actual (gemini-api). Configura GEMINI_MODEL_MAIN=gemini-3.7-flash.',
    });
  });

  it("usa thinking medium y no envia temperature en la ruta principal", async () => {
    const generateContent = jest.fn().mockResolvedValue({
      text: "ok",
      functionCalls: [],
    });

    mockGoogleGenAi(generateContent);

    const {
      default: geminiAdapter,
    } = require("../src/services/ai/adapters/gemini.adapter");

    await geminiAdapter.generate({
      prompt: "hola",
      purpose: "main",
    });

    expect(generateContent).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gemini-3.7-flash",
        config: expect.objectContaining({
          thinkingConfig: {
            thinkingLevel: "MEDIUM",
          },
        }),
      }),
    );
    expect(generateContent.mock.calls[0][0].config.temperature).toBeUndefined();
    expect(generateContent.mock.calls[0][0].config.topP).toBeUndefined();
    expect(generateContent.mock.calls[0][0].config.topK).toBeUndefined();
    expect(
      generateContent.mock.calls[0][0].config.thinkingConfig.thinkingBudget,
    ).toBeUndefined();
  });

  it("usa thinking low para planner/fast sin mezclarlo con medium", async () => {
    const generateContent = jest.fn().mockResolvedValue({
      text: "ok",
      functionCalls: [],
    });

    mockGoogleGenAi(generateContent);

    const {
      default: geminiAdapter,
    } = require("../src/services/ai/adapters/gemini.adapter");

    await geminiAdapter.generate({
      prompt: "hola",
      model: "gemini-3.7-flash",
      purpose: "fast",
    });

    expect(generateContent).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gemini-3.7-flash",
        config: expect.objectContaining({
          thinkingConfig: {
            thinkingLevel: "LOW",
          },
        }),
      }),
    );
  });

  it("no envia thinking_level en resúmenes con gemini-3.5-flash-lite", async () => {
    const generateContent = jest.fn().mockResolvedValue({
      text: '{"resumen":"ok"}',
      functionCalls: [],
    });

    mockGoogleGenAi(generateContent);

    const {
      default: geminiAdapter,
    } = require("../src/services/ai/adapters/gemini.adapter");

    await geminiAdapter.generate({
      prompt: "resumir texto largo",
      model: "gemini-3.5-flash-lite",
      purpose: "summary",
    });

    expect(generateContent.mock.calls[0][0].model).toBe(
      "gemini-3.5-flash-lite",
    );
    expect(
      generateContent.mock.calls[0][0].config.thinkingConfig,
    ).toBeUndefined();
    expect(generateContent.mock.calls[0][0].config.temperature).toBeUndefined();
  });

  it("envia function calling en modo AUTO cuando solo recibe tools declaradas", async () => {
    const generateContent = jest.fn().mockResolvedValue({
      text: "ok",
      functionCalls: [],
    });

    mockGoogleGenAi(generateContent);

    const {
      default: geminiAdapter,
    } = require("../src/services/ai/adapters/gemini.adapter");

    await geminiAdapter.generate({
      contents: [{ role: "user", parts: [{ text: "hola" }] }],
      purpose: "main",
      tools: [
        {
          name: "buscar_productos",
          description: "Buscar productos",
        },
      ],
    });

    expect(generateContent).toHaveBeenCalledWith(
      expect.objectContaining({
        contents: [{ role: "user", parts: [{ text: "hola" }] }],
        config: expect.objectContaining({
          toolConfig: {
            functionCallingConfig: {
              mode: "AUTO",
            },
          },
        }),
      }),
    );
  });

  it("envia function calling en modo ANY con allowedFunctionNames", async () => {
    const generateContent = jest.fn().mockResolvedValue({
      text: "ok",
      functionCalls: [],
    });

    mockGoogleGenAi(generateContent);

    const {
      default: geminiAdapter,
    } = require("../src/services/ai/adapters/gemini.adapter");

    await geminiAdapter.generate({
      prompt: "hola",
      purpose: "main",
      tools: [
        {
          name: "buscar_productos",
          description: "Buscar productos",
          parameters: {
            type: "object",
            properties: {},
          },
        },
      ],
      allowedFunctionNames: ["buscar_productos"],
    });

    expect(generateContent).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({
          toolConfig: {
            functionCallingConfig: {
              mode: "ANY",
              allowedFunctionNames: ["buscar_productos"],
            },
          },
        }),
      }),
    );
  });

  it("remapea INVALID_ARGUMENT por tool calling a AI_INVALID_CONFIGURATION", async () => {
    const generateContent = jest.fn().mockRejectedValue(
      Object.assign(
        new Error(
          "400 INVALID_ARGUMENT: allowedFunctionNames requires mode ANY",
        ),
        {
          status: 400,
        },
      ),
    );

    mockGoogleGenAi(generateContent);

    const {
      default: geminiAdapter,
    } = require("../src/services/ai/adapters/gemini.adapter");

    await expect(
      geminiAdapter.generate({
        prompt: "hola",
        purpose: "main",
        tools: [
          {
            name: "buscar_productos",
            description: "Buscar productos",
            parameters: {
              type: "object",
              properties: {},
            },
          },
        ],
        allowedFunctionNames: ["buscar_productos"],
      }),
    ).rejects.toMatchObject({
      code: "AI_INVALID_CONFIGURATION",
      statusCode: 400,
    });
  });

  it("remapea INVALID_ARGUMENT por schema de tools a AI_INVALID_CONFIGURATION", async () => {
    const generateContent = jest.fn().mockRejectedValue(
      Object.assign(
        new Error(
          "400 INVALID_ARGUMENT: reference to undefined schema at top-level",
        ),
        {
          status: 400,
        },
      ),
    );

    mockGoogleGenAi(generateContent);

    const {
      default: geminiAdapter,
    } = require("../src/services/ai/adapters/gemini.adapter");

    await expect(
      geminiAdapter.generate({
        prompt: "hola",
        purpose: "main",
        tools: [
          {
            name: "buscar_productos",
            description: "Buscar productos",
          },
        ],
        allowedFunctionNames: ["buscar_productos"],
      }),
    ).rejects.toMatchObject({
      code: "AI_INVALID_CONFIGURATION",
      statusCode: 400,
    });
  });

  it("sanea allowedFunctionNames y conserva solo tools declaradas", async () => {
    const generateContent = jest.fn().mockResolvedValue({
      text: "ok",
      functionCalls: [],
    });

    mockGoogleGenAi(generateContent);

    const {
      default: geminiAdapter,
    } = require("../src/services/ai/adapters/gemini.adapter");

    await geminiAdapter.generate({
      prompt: "hola",
      purpose: "main",
      tools: [
        {
          name: "buscar_productos",
          description: "Buscar productos",
          parameters: {
            type: "object",
            properties: {},
          },
        },
      ],
      allowedFunctionNames: ["buscar_productos", "tool_inexistente", ""],
    });

    expect(generateContent).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({
          toolConfig: {
            functionCallingConfig: {
              mode: "ANY",
              allowedFunctionNames: ["buscar_productos"],
            },
          },
        }),
      }),
    );
  });

  it("no remapea INVALID_ARGUMENT generico sin senales de tool-calling", async () => {
    const providerError = Object.assign(
      new Error("400 INVALID_ARGUMENT: request payload invalid"),
      {
        status: 400,
      },
    );
    const generateContent = jest.fn().mockRejectedValue(providerError);

    mockGoogleGenAi(generateContent);

    const {
      default: geminiAdapter,
    } = require("../src/services/ai/adapters/gemini.adapter");

    await expect(
      geminiAdapter.generate({
        prompt: "hola",
        purpose: "main",
      }),
    ).rejects.toBe(providerError);
  });

  it("reintenta 429 una vez y no reintenta 400", async () => {
    const rateLimited = Object.assign(new Error("429 RESOURCE_EXHAUSTED"), {
      status: 429,
    });
    const generateContent = jest
      .fn()
      .mockRejectedValueOnce(rateLimited)
      .mockResolvedValueOnce({
        text: "ok",
        functionCalls: [],
      });

    mockGoogleGenAi(generateContent);

    const {
      default: geminiAdapter,
    } = require("../src/services/ai/adapters/gemini.adapter");

    await geminiAdapter.generate({
      prompt: "hola",
      purpose: "main",
    });

    expect(generateContent).toHaveBeenCalledTimes(2);

    const permanent = Object.assign(new Error("400 INVALID_ARGUMENT"), {
      status: 400,
    });
    generateContent.mockReset();
    generateContent.mockRejectedValue(permanent);

    await expect(
      geminiAdapter.generate({
        prompt: "hola",
        purpose: "main",
      }),
    ).rejects.toBe(permanent);
    expect(generateContent).toHaveBeenCalledTimes(1);
  });

  it("inicializa Gemini Developer API con GEMINI_API_KEY y no Vertex ni ADC", async () => {
    process.env.AI_GEMINI_MODE = "vertexai";
    process.env.GOOGLE_GENAI_USE_VERTEXAI = "true";
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;

    const generateContent = jest.fn().mockResolvedValue({
      text: "ok",
      functionCalls: [],
    });
    const GoogleGenAI = mockGoogleGenAi(generateContent);

    const {
      default: geminiAdapter,
    } = require("../src/services/ai/adapters/gemini.adapter");

    await geminiAdapter.generate({
      prompt: "hola",
      purpose: "main",
    });

    expect(GoogleGenAI).toHaveBeenCalledTimes(1);
    expect(GoogleGenAI).toHaveBeenCalledWith({
      apiKey: "test-gemini-key",
      apiVersion: "v1beta",
    });
    expect(GoogleGenAI).not.toHaveBeenCalledWith(
      expect.objectContaining({ vertexai: true }),
    );
    expect(process.env.GOOGLE_APPLICATION_CREDENTIALS).toBeUndefined();
  });

  it("si Gemini API falla no intenta Vertex automaticamente", async () => {
    process.env.AI_GEMINI_MAX_RETRIES = "0";
    const generateContent = jest.fn().mockRejectedValue(
      Object.assign(new Error("503 UNAVAILABLE"), { status: 503 }),
    );
    const GoogleGenAI = mockGoogleGenAi(generateContent);

    const {
      default: geminiAdapter,
    } = require("../src/services/ai/adapters/gemini.adapter");

    await expect(
      geminiAdapter.generate({
        prompt: "hola",
        purpose: "main",
      }),
    ).rejects.toMatchObject({
      status: 503,
    });

    expect(GoogleGenAI).toHaveBeenCalledTimes(1);
    expect(GoogleGenAI).toHaveBeenCalledWith({
      apiKey: "test-gemini-key",
      apiVersion: "v1beta",
    });
    expect(GoogleGenAI).not.toHaveBeenCalledWith(
      expect.objectContaining({ vertexai: true }),
    );
    expect(JSON.stringify(logCalls)).not.toContain("vertexai");
    expect(JSON.stringify(logCalls)).not.toContain("gemini_client_fallback");
  });

  it("nunca registra GEMINI_API_KEY en logs", async () => {
    const generateContent = jest.fn().mockResolvedValue({
      text: "ok",
      functionCalls: [],
    });
    mockGoogleGenAi(generateContent);

    const {
      default: geminiAdapter,
    } = require("../src/services/ai/adapters/gemini.adapter");

    await geminiAdapter.generate({
      prompt: "hola",
      purpose: "main",
    });

    const serializedLogs = JSON.stringify(logCalls);
    expect(serializedLogs).not.toContain("test-gemini-key");
    expect(serializedLogs).not.toContain("GEMINI_API_KEY=");
    expect(serializedLogs).toContain("gemini-api");
  });
});
