import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from "dotenv";

dotenv.config();

// Accedemos a la API KEY desde las variables de entorno
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

class AIService {
    // Usamos el modelo flash que es más rápido y económico para resúmenes
    private model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    async generarContenidoIA(contenido: string): Promise<string> {
        try {
            const prompt = `
                Actúa como un editor de noticias profesional. 
                Tu tarea es leer el siguiente contenido y generar un resumen ejecutivo, 
                conciso y atractivo de máximo 3 párrafos. 
                
                Contenido a resumir:
                "${contenido}"
                
                Resumen:
            `;

            const result = await this.model.generateContent(prompt);
            const response = await result.response;
            const text = response.text();

            return text;
        } catch (error) {
            console.error("❌ Error en Gemini AI Service:", error);
            throw new Error("No se pudo generar el resumen con Inteligencia Artificial.");
        }
    }
}

export default new AIService();