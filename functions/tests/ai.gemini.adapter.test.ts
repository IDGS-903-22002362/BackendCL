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
      Object.assign(new Error("404 NOT_FOUND models/gemini-2.5-foo unsupported methods"), {
        status: 404,
      }),
    );

    jest.doMock("@google/genai", () => ({
      GoogleGenAI: jest.fn().mockImplementation(() => ({
        models: {
          generateContent,
        },
      })),
      FunctionCallingConfigMode: {
        AUTO: "AUTO",
      },
    }));

    const { default: geminiAdapter } = require("../src/services/ai/adapters/gemini.adapter");

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
});
