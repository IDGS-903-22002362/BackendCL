import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from "dotenv";

dotenv.config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

class AIService {

    //ia

    private model = genAI.getGenerativeModel({
        model: "gemini-pro-latest"
    });

    async generarContenidoIA(contenido: string): Promise<string> {

        if (!contenido) throw new Error("Contenido nulo");

        try {

            const prompt = `
Actúa como un editor profesional de noticias.

Resume el siguiente contenido en máximo 3 párrafos.
Mantén un tono informativo y objetivo.

Contenido:
${contenido}

Resumen:
`;

            const result = await this.model.generateContent(prompt);

            if (!result.response) {
                throw new Error("Respuesta vacía de Gemini");
            }

            return result.response.text();

        } catch (error) {
            console.error("❌ Error en Gemini AI Service:", error);
            throw new Error("No se pudo generar el resumen con Inteligencia Artificial.");
        }
    }
}

export default new AIService();