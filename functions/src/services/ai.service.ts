import aiConfig from "../config/ai.config";
import geminiAdapter from "./ai/adapters/gemini.adapter";

class AIService {
  async generarContenidoIA(contenido: string): Promise<string> {
    if (!contenido || !contenido.trim()) {
      throw new Error("Contenido nulo");
    }

    try {
      const result = await geminiAdapter.generate({
        model: aiConfig.gemini.summaryModel,
        systemInstruction:
          "Eres un editor profesional de noticias. Resume con tono informativo, objetivo y sin inventar datos.",
        prompt: [
          "Resume el siguiente contenido en maximo 3 parrafos.",
          "Contenido:",
          contenido.trim(),
        ].join("\n\n"),
      });

      if (!result.text.trim()) {
        throw new Error("Respuesta vacia de Gemini");
      }

      return result.text.trim();
    } catch (error) {
      throw new Error("No se pudo generar el resumen con Inteligencia Artificial.");
    }
  }
}

export default new AIService();
