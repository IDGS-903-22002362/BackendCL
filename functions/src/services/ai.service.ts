import aiConfig from "../config/ai.config";
import logger from "../utils/logger";
import geminiAdapter from "./ai/adapters/gemini.adapter";

class AIService {
  private readonly baseLogger = logger.child({ component: "news-ai-service" });

  async generarContenidoIA(contenido: string): Promise<{ resumen: string }> {
    if (!contenido) throw new Error("Contenido nulo");

    const result = await geminiAdapter.generateStructured<{ resumen: string }>({
      model: aiConfig.gemini.summaryModel,
      purpose: "summary",
      systemInstruction:
        "Actua como un editor profesional de noticias deportivas. Responde solo JSON valido.",
      prompt: `
Analiza el siguiente contenido y devuelve EXCLUSIVAMENTE un objeto JSON con este formato exacto:

{
  "resumen": "Tu resumen aqui, maximo 200 caracteres, sin saltos de linea"
}

Contenido:
${contenido}
`,
      responseJsonSchema: {
        type: "object",
        properties: {
          resumen: { type: "string" },
        },
        required: ["resumen"],
      },
    });

    if (!result?.resumen || typeof result.resumen !== "string") {
      this.baseLogger.warn("news_ai_invalid_payload", {
        provider: "gemini",
        model: aiConfig.gemini.summaryModel,
        purpose: "summary",
        success: false,
      });
      throw new Error("La IA no devolvió un JSON válido");
    }

    return {
      resumen: result.resumen.trim().slice(0, 200),
    };
  }
}

export default new AIService();
