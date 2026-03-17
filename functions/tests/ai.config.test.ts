describe("ai.config", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    process.env.AI_STORAGE_BUCKET = "bucket-test";
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("usa gemini-2.5-pro como default del modelo principal", () => {
    delete process.env.GEMINI_MODEL_PRIMARY;

    const { aiConfig } = require("../src/config/ai.config");

    expect(aiConfig.gemini.primaryModel).toBe("gemini-2.5-pro");
  });

  it("rechaza modelos preview/versionados en modo vertexai", () => {
    process.env.AI_GEMINI_MODE = "vertexai";
    process.env.GCP_PROJECT_ID = "e-comerce-leon";
    process.env.GCP_REGION = "us-central1";
    process.env.GEMINI_MODEL_PRIMARY = "gemini-2.5-pro-preview-05-06";

    const { assertAiConfig } = require("../src/config/ai.config");

    expect(() => assertAiConfig()).toThrow(
      'Configuracion AI invalida: el modelo "gemini-2.5-pro-preview-05-06" no es compatible con generateContent en modo vertexai. Ajusta AI_GEMINI_MODE=vertexai y GEMINI_MODEL_PRIMARY=gemini-2.5-pro.',
    );
  });
});
