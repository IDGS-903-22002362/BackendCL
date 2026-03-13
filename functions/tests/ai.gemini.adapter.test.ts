describe("GeminiAdapter", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.resetModules();
    process.env = {
      ...originalEnv,
      AI_GEMINI_MODE: "vertexai",
      GCP_PROJECT_ID: "e-comerce-leon",
      GCP_REGION: "us-central1",
      AI_STORAGE_BUCKET: "bucket-test",
      GEMINI_MODEL_PRIMARY: "gemini-2.5-pro",
    };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("remapea 404 unsupported methods a AI_MODEL_UNSUPPORTED", async () => {
    const generateContent = jest.fn().mockRejectedValue(
      Object.assign(
        new Error("404 NOT_FOUND models/gemini-2.5-foo unsupported methods"),
        {
          status: 404,
        },
      ),
    );

    jest.doMock("@google/genai", () => ({
      GoogleGenAI: jest.fn().mockImplementation(() => ({
        models: {
          generateContent,
        },
      })),
      FunctionCallingConfigMode: {
        ANY: "ANY",
      },
    }));

    const {
      default: geminiAdapter,
    } = require("../src/services/ai/adapters/gemini.adapter");

    await expect(
      geminiAdapter.generate({
        prompt: "hola",
      }),
    ).rejects.toMatchObject({
      code: "AI_MODEL_UNSUPPORTED",
      message:
        'El modelo "gemini-2.5-pro" no soporta generateContent con la configuracion actual (vertexai). Configura GEMINI_MODEL_PRIMARY=gemini-2.5-pro.',
    });
  });

  it("envia function calling en modo ANY con allowedFunctionNames", async () => {
    const generateContent = jest.fn().mockResolvedValue({
      text: "ok",
      functionCalls: [],
    });

    jest.doMock("@google/genai", () => ({
      GoogleGenAI: jest.fn().mockImplementation(() => ({
        models: {
          generateContent,
        },
      })),
      FunctionCallingConfigMode: {
        ANY: "ANY",
      },
    }));

    const {
      default: geminiAdapter,
    } = require("../src/services/ai/adapters/gemini.adapter");

    await geminiAdapter.generate({
      prompt: "hola",
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

    jest.doMock("@google/genai", () => ({
      GoogleGenAI: jest.fn().mockImplementation(() => ({
        models: {
          generateContent,
        },
      })),
      FunctionCallingConfigMode: {
        ANY: "ANY",
      },
    }));

    const {
      default: geminiAdapter,
    } = require("../src/services/ai/adapters/gemini.adapter");

    await expect(
      geminiAdapter.generate({
        prompt: "hola",
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

  it("sanea allowedFunctionNames y conserva solo tools declaradas", async () => {
    const generateContent = jest.fn().mockResolvedValue({
      text: "ok",
      functionCalls: [],
    });

    jest.doMock("@google/genai", () => ({
      GoogleGenAI: jest.fn().mockImplementation(() => ({
        models: {
          generateContent,
        },
      })),
      FunctionCallingConfigMode: {
        ANY: "ANY",
      },
    }));

    const {
      default: geminiAdapter,
    } = require("../src/services/ai/adapters/gemini.adapter");

    await geminiAdapter.generate({
      prompt: "hola",
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

    jest.doMock("@google/genai", () => ({
      GoogleGenAI: jest.fn().mockImplementation(() => ({
        models: {
          generateContent,
        },
      })),
      FunctionCallingConfigMode: {
        ANY: "ANY",
      },
    }));

    const {
      default: geminiAdapter,
    } = require("../src/services/ai/adapters/gemini.adapter");

    await expect(
      geminiAdapter.generate({
        prompt: "hola",
      }),
    ).rejects.toBe(providerError);
  });
});
