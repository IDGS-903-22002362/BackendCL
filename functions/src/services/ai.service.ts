import OpenAI from "openai";
import { admin } from "../config/firebase.admin";

const openai = process.env.OPENAI_API_KEY
    ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
    : null;

export class IAService {
    async generarContenidoIA(contenido: string) {
        if (!openai) {
            console.warn("IA desactivada: falta OPENAI_API_KEY");
            return null;
        }

        const response = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            temperature: 0.4,
            messages: [
                {
                    role: "system",
                    content: `
Eres el editor oficial de noticias de un club profesional de fútbol.

Responde ÚNICAMENTE en JSON válido con esta estructura:

{
  "tituloIA": string,
  "resumenCorto": string,
  "resumenLargo": string
}
          `,
                },
                {
                    role: "user",
                    content: `Noticia:\n${contenido}`,
                },
            ],
        });

        const raw = response.choices[0].message.content;
        if (!raw) return null;

        let parsed;
        try {
            parsed = JSON.parse(raw);
        } catch {
            console.error("Respuesta IA inválida:", raw);
            return null;
        }

        return {
            ...parsed,
            generadoAt: admin.firestore.Timestamp.now(),
        };
    }
}

export default new IAService();
