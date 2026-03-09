import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from "dotenv";

dotenv.config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

class AIService {

    private model = genAI.getGenerativeModel({
        model: "gemini-2.0-flash"
    });

    async generarContenidoIA(contenido: string): Promise<string> {

        try {

            if (!contenido) throw new Error("Contenido nulo");

            const prompt = `
Actúa como un editor profesional de noticias.

Resume el siguiente contenido en máximo 3 párrafos.

Contenido:
"""
${contenido}
"""

Resumen:
`;

            const result = await this.model.generateContent(prompt);

            const text = result.response.text();

            return text;

        } catch (error) {
            console.error("❌ Error en Gemini AI Service:", error);
            throw new Error("No se pudo generar el resumen con Inteligencia Artificial.");
        }
    }
}

export default new AIService();