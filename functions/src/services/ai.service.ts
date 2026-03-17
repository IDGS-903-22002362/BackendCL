import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from "dotenv";

dotenv.config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

class AIService {

  //ia

  private model = genAI.getGenerativeModel({
    model: "gemini-pro-latest"
  });

  async generarContenidoIA(contenido: string): Promise<any> {
    if (!contenido) throw new Error("Contenido nulo");

    // 1. Pedimos explícitamente un JSON
    const prompt = `
Actúa como un editor profesional de noticias deportivas.
Analiza el siguiente contenido y devuelve EXCLUSIVAMENTE un objeto JSON con este formato exacto:

{
  "resumen": "Tu resumen aquí, máximo 200 caracteres, sin saltos de línea"
}

Contenido:
${contenido}
`;

    // 2. Usamos generationConfig para asegurar que sea JSON
    const result = await this.model.generateContent({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: "application/json" // Esto es clave
      }
    });

    const text = result.response.text();

    try {
      // 3. Ahora sí, esto funcionará porque la respuesta será un JSON real
      return JSON.parse(text);
    } catch (error) {
      console.error("Error parseando:", text);
      throw new Error("La IA no devolvió un JSON válido");
    }
  }
}

export default new AIService();