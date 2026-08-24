describe("ai.config", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    process.env.AI_STORAGE_BUCKET = "bucket-test";
    process.env.GEMINI_API_KEY = "test-gemini-key";
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("usa gemini-3.7-flash como default del modelo principal", () => {
    delete process.env.GEMINI_MODEL_PRIMARY;
    delete process.env.GEMINI_MODEL_MAIN;
    delete process.env.AI_GEMINI_API_VERSION;
    process.env.AI_GEMINI_MODE = "apiKey";

    const { aiConfig } = require("../src/config/ai.config");

    expect(aiConfig.gemini.provider).toBe("gemini-api");
    expect(aiConfig.gemini.mode).toBe("apiKey");
    expect(aiConfig.gemini.primaryModel).toBe("gemini-3.7-flash");
    expect(aiConfig.gemini.fastModel).toBe("gemini-3.7-flash");
    expect(aiConfig.gemini.summaryModel).toBe("gemini-3.5-flash-lite");
    expect(aiConfig.gemini.imageModel).toBe("gemini-3.1-flash-image");
    expect(aiConfig.gemini.thinkingLevelMain).toBe("medium");
    expect(aiConfig.gemini.thinkingLevelFast).toBe("low");
    expect(aiConfig.gemini.apiVersion).toBe("v1beta");
  });

  it("usa v1beta porque thinking_level no esta en v1 de Gemini Developer API", () => {
    delete process.env.AI_GEMINI_API_VERSION;
    delete process.env.AI_GEMINI_MODE;
    delete process.env.GOOGLE_GENAI_USE_VERTEXAI;

    const { aiConfig } = require("../src/config/ai.config");

    expect(aiConfig.gemini.mode).toBe("apiKey");
    expect(aiConfig.gemini.apiVersion).toBe("v1beta");
  });

  it("ignora leftover AI_GEMINI_MODE=vertexai y GOOGLE_GENAI_USE_VERTEXAI=true", () => {
    process.env.AI_GEMINI_MODE = "vertexai";
    process.env.GOOGLE_GENAI_USE_VERTEXAI = "true";
    process.env.GCP_PROJECT_ID = "e-comerce-leon";
    process.env.GCP_REGION = "us-central1";

    const { aiConfig, getAiRuntimeSummary } = require("../src/config/ai.config");

    expect(aiConfig.gemini.mode).toBe("apiKey");
    expect(aiConfig.gemini.provider).toBe("gemini-api");
    expect(getAiRuntimeSummary()).toMatchObject({
      geminiProvider: "gemini-api",
      vertexGeminiRequested: true,
      vertexGeminiActive: false,
    });
  });

  it("exige GEMINI_API_KEY y no Application Default Credentials", () => {
    delete process.env.GEMINI_API_KEY;
    delete process.env.GOOGLE_API_KEY;
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;

    const { assertAiConfig } = require("../src/config/ai.config");

    expect(() => assertAiConfig()).toThrow(
      "GEMINI_API_KEY es requerido para Gemini Developer API",
    );
  });

  it("deshabilita chat guest por defecto y permite opt-in explicito", () => {
    delete process.env.AI_PUBLIC_CHAT_ENABLED;
    let config = require("../src/config/ai.config").aiConfig;
    expect(config.api.publicChatEnabled).toBe(false);

    jest.resetModules();
    process.env.AI_PUBLIC_CHAT_ENABLED = "true";
    config = require("../src/config/ai.config").aiConfig;
    expect(config.api.publicChatEnabled).toBe(true);
  });
});
